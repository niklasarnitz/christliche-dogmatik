import {
  Type,
} from "@google/genai";
import { PDFDocument } from "pdf-lib";
import * as fs from "fs/promises";
import * as path from "path";

// Helper imports
import { sendPushoverNotification } from "./src/helper/pushover.js";
import { fileToGenerativePart, getPageImageBuffer } from "./src/helper/pdf-converter.js";
import { getLastProcessedPageByTex, setupDirectory } from "./src/helper/file-utils.js";
import { createGoogleAI, STANDARD_SAFETY_SETTINGS, validateGoogleAIKey } from "./src/helper/google-ai.js";

// --- Konfiguration ---
const PDF_PATH = "./Pieper-Dogmatik1.pdf";
const OUTPUT_DIR = "./output";
const MAIN_TEX_PATH = path.join(OUTPUT_DIR, "main.tex");
const MODEL_NAME = "gemini-2.5";

// --- Typdefinition für die erwartete strukturierte Antwort ---
interface OcrResponse {
  content: string; // ocr content in latex formatting
}

/**
 * Erstellt das Ausgabeverzeichnis und initialisiert die main.tex-Datei, falls nötig.
 */
async function setupWorkspace() {
  await setupDirectory(OUTPUT_DIR);
  
  try {
    await fs.access(MAIN_TEX_PATH);
  } catch {
    console.log("main.tex nicht gefunden. Erstelle neue Datei.");
    const initialContent = `\\documentclass[12pt, a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{fontspec} % Für die Verwendung gotischer Schriftarten (falls nötig)
\\usepackage{geometry}
\\geometry{a4paper, margin=1in}

\\title{Christliche Dogmatik - Band 1}
\\author{Francis Pieper}
\\date{}

\\begin{document}
\\maketitle

% Die einzelnen Seiten werden hier inkludiert
`;
    await fs.writeFile(MAIN_TEX_PATH, initialContent);
  }
}

/**
 * Verarbeitet eine Seite des PDFs mit Kontext (vorherige und nächste Seite) mit der Gemini API.
 * @param pageImageBuffers Array: [vorherige, aktuelle, nächste] Seite als Buffer (null, falls nicht vorhanden)
 * @returns Der OCR-Inhalt im LaTeX-Format.
 */
async function processPageWithGemini(
  pageImageBuffers: Array<Buffer | null>
): Promise<string> {
  const apiKey = validateGoogleAIKey();
  const genAI = createGoogleAI(apiKey);

  const prompt = `Du bist ein erfahrener wissenschaftlicher Editor und OCR-Experte für historische Dokumente in gotischer Schrift.

**Deine Hauptaufgabe ist es, den Text aus dem MITTLEREN Bild zu extrahieren und diesen als wohlgeformten LaTeX-Ausschnitt bereitzustellen.** Die vorherige und nächste Seite sind als Kontextbilder beigefügt, um die Genauigkeit bei Wortübergängen und Satzanschlüssen zu maximieren.

---
**AUSGABE-ANWEISUNGEN (Zwingend einzuhalten):**

1.  **FORMAT:** Deine gesamte Antwort MUSS ein JSON-Objekt sein, das exakt dem Schema \`{"content": string}\` entspricht.
2.  **INHALT DES 'content'-FELDES:** Der Wert des \`content\`-Feldes MUSS AUSSCHLIESSLICH den LaTeX-Ausschnitt der angefragten Seite (aus dem mittleren Bild) enthalten. Es dürfen KEINE anderen Texte, Erklärungen, Kommentare, Interpretationen oder Metadaten *innerhalb* dieses Feldes oder *außerhalb* des JSON-Objekts existieren.
3.  **SEITENFOKUS:** Das \`content\`-Feld MUSS AUSSCHLIESSLICH den extrahierten Text des MITTLEREN Bildes abbilden. KEINE Inhalte der Kontextbilder (vorherige/nächste Seite) dürfen enthalten sein.
4.  **LaTeX-STRUKTUR:**
    *   Der LaTeX-Ausschnitt darf KEIN vollständiges Dokument, KEINE Präambel, KEIN \`\begin{document}\` oder \`\end{document}\` enthalten. Es ist ein *Ausschnitt*.
    *   Achte auf korrekte LaTeX-Struktur, sinnvolle Absätze, Überschriften, Listen und Hervorhebungen. Nutze LaTeX-Umgebungen wie \`\section\`, \`\subsection\`, \`\textbf\`, \`\emph\`, \`\itemize\`, \`\enumerate\`, \`\quote\`, \`\footnote\`, wenn sie im Originaltext erkennbar sind.
    *   Korrigiere behutsam offensichtliche Rechtschreibfehler (z.B. 'daß' -> 'dass', 'Thun' -> 'tun'), aber bewahre den historischen Charakter des Textes.
    *   Schreibe Umlaute IMMER als ä, ö, ü (nicht 'a, 'o, 'u oder ae, oe, ue).
    *   Entferne Artefakte, Dopplungen, Zeilenumbrüche mitten im Wort und optische Fehler, die nicht Teil des eigentlichen Textes sind.
    *   Füge bei Unsicherheit bezüglich der korrekten LaTeX-Formatierung einen LaTeX-TODO-Kommentar (z.B. \`% TODO: Formatierung prüfen\`) an der entsprechenden Stelle *innerhalb des LaTeX-Textes* ein.

---
**ZUSAMMENFASSUNG UND KRITISCHE REGELN:**
*   **Immer JSON:** Deine Ausgabe ist *immer* ein valides JSON-Objekt \`{"content": "..."}\`.
*   **Nur LaTeX im 'content':** Das \`content\`-Feld enthält *ausschließlich* den LaTeX-Text des mittleren Bildes.
*   **Keine Umschweife:** Gib *keine* zusätzlichen Erklärungen oder Kommentare außerhalb des JSON-Objekts aus.`;

  // Erzeuge die parts: [vorherige Seite (falls vorhanden), aktuelle Seite, nächste Seite (falls vorhanden)]
  const imageParts = pageImageBuffers
    .map((buf) => (buf ? fileToGenerativePart(buf, "image/png") : null))
    .filter(Boolean) as {
    inlineData: {
      data: string;
      mimeType: string;
    };
  }[];

  try {
    const result = await genAI.models.generateContent({
      model: MODEL_NAME,
      contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            content: {
              type: Type.STRING,
            },
          },
        },
        safetySettings: STANDARD_SAFETY_SETTINGS,
      },
    });

    const responseText = result.text as string;

    try {
      if (typeof responseText !== "string") {
        console.info(result.data);
        throw new Error("Antwort war kein String.");
      }

      const parsedJson = result
        ? (JSON.parse(responseText) as OcrResponse)
        : null;
      return parsedJson?.content ?? "";
    } catch (error) {
      console.error("Fehler beim Parsen der Antwort:", error);
      console.info("AI-Antwort:", result?.text);
      throw new Error(
        "Antwort konnte nicht als JSON-Objekt interpretiert werden."
      );
    }
  } catch (error) {
    console.error("Fehler bei der API-Anfrage an Gemini:", error);
    throw new Error("API-Anfrage fehlgeschlagen.");
  }
}

/**
 * Hauptfunktion zur Steuerung des gesamten OCR-Prozesses.
 */
async function processPdfDocument() {
  await setupWorkspace();

  // Bestimme die letzte verarbeitete Seite anhand der .tex-Dateien
  const lastProcessedPage = await getLastProcessedPageByTex(OUTPUT_DIR);
  console.log(`Setze die Verarbeitung ab Seite ${lastProcessedPage + 1} fort.`);

  const pdfBytes = await fs.readFile(PDF_PATH);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();

  console.log(`Dokument geladen. Gesamtanzahl der Seiten: ${totalPages}`);

  const MAX_RETRIES = 3;

  for (let i = lastProcessedPage; i < totalPages; i++) {
    const pageNum = i + 1;
    console.log(`Beginne Verarbeitung von Seite ${pageNum}/${totalPages}...`);

    let success = false;
    let lastError: any = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Kontext: vorherige, aktuelle, nächste Seite als Bild extrahieren
        const prevBuffer = await getPageImageBuffer(PDF_PATH, pageNum - 1, OUTPUT_DIR);
        const currBuffer = await getPageImageBuffer(PDF_PATH, pageNum, OUTPUT_DIR);
        const nextBuffer = await getPageImageBuffer(PDF_PATH, pageNum + 1, OUTPUT_DIR);

        if (!currBuffer) {
          throw new Error(`Konnte Seite ${pageNum} nicht als Bild laden.`);
        }

        // OCR mit API
        console.log(`Sende Seite ${pageNum} an Gemini API...`);
        const ocrText = await processPageWithGemini([prevBuffer, currBuffer, nextBuffer]);

        if (!ocrText || ocrText.trim().length === 0) {
          throw new Error(`Leere Antwort von der API für Seite ${pageNum}.`);
        }

        // Speichere die extrahierte LaTeX-Seite
        const pageTexPath = path.join(OUTPUT_DIR, `page${pageNum}.tex`);
        await fs.writeFile(pageTexPath, ocrText);
        console.log(`✓ Seite ${pageNum} erfolgreich verarbeitet und gespeichert.`);

        // Füge die Seite zur main.tex hinzu
        const includeStatement = `\\input{page${pageNum}}\n`;
        await fs.appendFile(MAIN_TEX_PATH, includeStatement);

        success = true;
        break;
      } catch (error) {
        lastError = error;
        console.error(`Versuch ${attempt} für Seite ${pageNum} fehlgeschlagen:`, error);
        if (attempt < MAX_RETRIES) {
          console.log(`Warte 2 Sekunden vor dem nächsten Versuch...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    if (!success) {
      const errorMessage = `Seite ${pageNum} konnte nach ${MAX_RETRIES} Versuchen nicht verarbeitet werden. Letzter Fehler: ${lastError}`;
      console.error(errorMessage);
      await sendPushoverNotification(`OCR-Verarbeitung fehlgeschlagen: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    // Kurze Pause zwischen den Seiten
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Schließe die main.tex-Datei ab
  await fs.appendFile(MAIN_TEX_PATH, "\n\\end{document}\n");

  console.log("🎉 Alle Seiten erfolgreich verarbeitet!");
  await sendPushoverNotification(`OCR-Verarbeitung abgeschlossen! ${totalPages} Seiten verarbeitet.`);
}

/**
 * Hauptfunktion des Programms.
 */
async function main() {
  try {
    await processPdfDocument();
  } catch (error) {
    console.error("Allgemeiner Fehler:", error);
    await sendPushoverNotification(`OCR-Verarbeitung fehlgeschlagen: ${error}`);
    process.exit(1);
  }
}

// Führe das Programm aus
if (import.meta.main) {
  main();
}
