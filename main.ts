import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  Type,
} from "@google/genai";
import { PDFDocument } from "pdf-lib";
import * as fs from "fs/promises";
import * as path from "path";
import { fromPath } from "pdf2pic";
import axios from "axios";
/**
 * Send a notification via Pushover API
 * @param message The message to send
 */
async function sendPushoverNotification(message: string) {
  const pushoverUserKey = process.env.PUSHOVER_USER_KEY;
  const pushoverApiToken = process.env.PUSHOVER_API_TOKEN;
  if (!pushoverUserKey || !pushoverApiToken) {
    console.warn("Pushover credentials not set in environment variables.");
    return;
  }
  try {
    await axios.post("https://api.pushover.net/1/messages.json", {
      token: pushoverApiToken,
      user: pushoverUserKey,
      message,
    });
    console.log("Pushover notification sent.");
  } catch (err) {
    console.error("Failed to send Pushover notification:", err);
  }
}

// --- Konfiguration ---
const PDF_PATH = "./Pieper-Dogmatik1.pdf"; // Ersetzen Sie dies durch den Pfad zu Ihrer PDF-Datei
const OUTPUT_DIR = "./output";
const MAIN_TEX_PATH = path.join(OUTPUT_DIR, "main.tex");
// Der Name des Modells. 'gemini-pro-vision' ist für Bild-Inputs optimiert.
// Passen Sie dies an, falls ein spezifischeres "2.5-pro-vision"-Modell verfügbar wird.
const MODEL_NAME = "gemini-2.5-flash";

// --- Typdefinition für die erwartete strukturierte Antwort ---
interface OcrResponse {
  content: string; // ocr content in latex formatting
}

/**
 * Konvertiert einen Buffer in ein für die API passendes GenerativePart-Objekt.
 * @param imageBuffer Der Buffer des Seitenbildes.
 * @param mimeType Der Mime-Typ des Bildes (z.B. 'image/png').
 * @returns Ein Objekt, das die API für Bilddaten erwartet.
 */
function fileToGenerativePart(imageBuffer: Buffer, mimeType: string) {
  return {
    inlineData: {
      data: imageBuffer.toString("base64"),
      mimeType,
    },
  };
}

/**
 * Erstellt das Ausgabeverzeichnis und initialisiert die main.tex-Datei, falls nötig.
 */
async function setupWorkspace() {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
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
 * Bestimmt die letzte verarbeitete Seite anhand der vorhandenen .tex-Dateien im OUTPUT_DIR.
 * Gibt die höchste gefundene Seitenzahl zurück.
 */
async function getLastProcessedPageByTex(): Promise<number> {
  const files = await fs.readdir(OUTPUT_DIR);
  const pageTexFiles = files.filter((f) => /^page\d+\.tex$/.test(f));
  if (pageTexFiles.length === 0) return 0;
  const pageNumbers = pageTexFiles.map((f) => parseInt(f.match(/\d+/)![0], 10));
  return Math.max(...pageNumbers);
}

/**
 * Verarbeitet eine Seite des PDFs mit Kontext (vorherige und nächste Seite) mit der Gemini API.
 * @param pageImageBuffers Array: [vorherige, aktuelle, nächste] Seite als Buffer (null, falls nicht vorhanden)
 * @returns Der OCR-Inhalt im LaTeX-Format.
 */
async function processPageWithGemini(
  pageImageBuffers: Array<Buffer | null>
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY Umgebungsvariable nicht gesetzt.");
  }

  const genAI = new GoogleGenAI({ apiKey });

  const prompt = `Du bist ein erfahrener wissenschaftlicher Editor und OCR-Experte für historische Dokumente in gotischer Schrift.

Deine Aufgabe:
- Extrahiere den Text aus dem mittleren Bild. Die vorherige und nächste Seite sind als Kontext beigefügt, damit Wortübergänge und Satzanschlüsse korrekt erkannt werden.
- Gib als Antwort ausschließlich einen wohlgeformten, semantisch sinnvollen LaTeX-AUSSCHNITT (kein komplettes Dokument, keine Präambel, kein \begin{document} oder \end{document}) zurück, der exakt die angefragte Seite abbildet.
- Achte auf korrekte LaTeX-Struktur, sinnvolle Absätze, Überschriften, Listen und Hervorhebungen. Nutze LaTeX-Umgebungen wie \section, \subsection, \textbf, \emph, \itemize, \enumerate, \quote, \footnote, wenn sie im Originaltext erkennbar sind.
- Korrigiere behutsam offensichtliche Rechtschreibfehler (z.B. 'daß' -> 'dass', 'Thun' -> 'tun', usw.), aber bewahre den historischen Charakter des Textes.
- Schreibe Umlaute immer als ä, ö, ü und nicht als 'a, 'o, 'u oder ae, oe, ue.
- Entferne Artefakte, Dopplungen, Zeilenumbrüche mitten im Wort und optische Fehler.
- Wenn du dir bei der Formatierung unsicher bist, füge einen LaTeX-TODO-Kommentar (z.B. % TODO: Formatierung prüfen) an die entsprechende Stelle ein.
- Füge keine eigenen Interpretationen, keine Meta-Kommentare und keine zusätzlichen Inhalte hinzu.
`;

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
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
        ],
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
  const lastProcessedPage = await getLastProcessedPageByTex();
  console.log(`Setze die Verarbeitung ab Seite ${lastProcessedPage + 1} fort.`);

  const pdfBytes = await fs.readFile(PDF_PATH);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();

  console.log(`Dokument geladen. Gesamtanzahl der Seiten: ${totalPages}`);

  const converter = fromPath(PDF_PATH, {
    density: 300,
    savePath: OUTPUT_DIR,
    format: "png",
    width: 2480, // A4 @ 300dpi
    height: 3508,
  });

  const MAX_RETRIES = 3;

  for (let i = lastProcessedPage; i < totalPages; i++) {
    const pageNum = i + 1;
    console.log(`Beginne Verarbeitung von Seite ${pageNum}/${totalPages}...`);

    let success = false;
    let lastError: any = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Kontext: vorherige, aktuelle, nächste Seite als Bild extrahieren
        const getImageBuffer = async (
          pageIdx: number
        ): Promise<Buffer | null> => {
          if (pageIdx < 1 || pageIdx > totalPages) return null;
          const result = await converter(pageIdx);
          const outputImagePath = result.path;
          if (outputImagePath) {
            const buf = await fs.readFile(outputImagePath);
            // PNG wird nicht mehr gelöscht
            return buf.length > 0 ? buf : null;
          }
          return null;
        };

        const prevBuffer = await getImageBuffer(pageNum - 1);
        const currBuffer = await getImageBuffer(pageNum);
        const nextBuffer = await getImageBuffer(pageNum + 1);
        if (!currBuffer) {
          console.warn(
            `WARNUNG: Seite ${pageNum} konnte nicht als Bild extrahiert werden.`
          );
          throw new Error("Seitenbild konnte nicht extrahiert werden.");
        }

        let ocrContent: string;
        try {
          ocrContent = await processPageWithGemini([
            prevBuffer,
            currBuffer,
            nextBuffer,
          ]);
        } catch (error: any) {
          // Handle Gemini API quota error (429)
          const errStr = error?.toString?.() || "";
          if (
            errStr.includes("ApiError") &&
            errStr.includes("RESOURCE_EXHAUSTED") &&
            errStr.includes("retryDelay")
          ) {
            // Try to extract retryDelay from error string
            const match = errStr.match(/"retryDelay":"(\d+)s"/);
            const seconds = match ? parseInt(match[1], 10) : 20;
            console.warn(
              `Gemini API quota exceeded. Warte ${seconds} Sekunden vor erneutem Versuch...`
            );
            await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
            throw error; // Let the outer catch retry
          } else {
            throw error;
          }
        }

        const pageTexPath = path.join(OUTPUT_DIR, `page${pageNum}.tex`);
        await fs.writeFile(pageTexPath, ocrContent);

        // Füge \include{page...} immer direkt vor \end{document} ein
        let mainTexContent = await fs.readFile(MAIN_TEX_PATH, "utf-8");
        const includeLine = `\n\\include{page${pageNum}}`;
        if (mainTexContent.includes("\\end{document}")) {
          const idx = mainTexContent.lastIndexOf("\\end{document}");
          mainTexContent =
            mainTexContent.slice(0, idx) +
            includeLine +
            "\n" +
            mainTexContent.slice(idx);
          await fs.writeFile(MAIN_TEX_PATH, mainTexContent);
        } else {
          await fs.appendFile(MAIN_TEX_PATH, includeLine);
        }

        console.log(
          `Seite ${pageNum} erfolgreich verarbeitet und in main.tex inkludiert.`
        );
        success = true;
        break;
      } catch (error) {
        lastError = error;
        // If quota error, don't count as a failed attempt, just retry after delay
        const errStr = error?.toString?.() || "";
        if (
          errStr.includes("ApiError") &&
          errStr.includes("RESOURCE_EXHAUSTED") &&
          errStr.includes("retryDelay")
        ) {
          // Already handled above, so don't increment attempt
          attempt--;
        } else {
          console.error(
            `Fehler bei der Verarbeitung von Seite ${pageNum}, Versuch ${attempt} von ${MAX_RETRIES}.`,
            error
          );
          if (attempt < MAX_RETRIES) {
            console.log("Erneuter Versuch...");
          }
        }
      }
    }
    if (!success) {
      await sendPushoverNotification(
        `Seite ${pageNum} konnte nach ${MAX_RETRIES} Versuchen nicht verarbeitet werden.`
      );
      console.error(
        `Seite ${pageNum} konnte nach ${MAX_RETRIES} Versuchen nicht verarbeitet werden. Das Skript wird angehalten.`,
        lastError
      );
      break;
    }
  }

  // Schließt das Dokument in der main.tex-Datei ab
  const finalContent = await fs.readFile(MAIN_TEX_PATH, "utf-8");
  if (!finalContent.includes("\\end{document}")) {
    await fs.appendFile(MAIN_TEX_PATH, "\n\n\\end{document}\n");
  }

  console.log("PDF-Verarbeitung abgeschlossen.");
}

// Skript starten
processPdfDocument().catch((error) => {
  console.error("Ein unerwarteter Fehler ist im Skript aufgetreten:", error);
});
