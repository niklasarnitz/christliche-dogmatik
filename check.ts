import {
  Type,
} from "@google/genai";
import * as fs from "fs/promises";
import * as path from "path";

// Helper imports
import { sendPushoverNotification } from "./src/helper/pushover.js";
import { fileToGenerativePart, getPageImageBuffer } from "./src/helper/pdf-converter.js";
import { readPageTexFile, getAvailablePages, setupDirectory } from "./src/helper/file-utils.js";
import { createGoogleAI, STANDARD_SAFETY_SETTINGS, validateGoogleAIKey } from "./src/helper/google-ai.js";

// --- Konfiguration ---
const OUTPUT_DIR = "./output";
const DIFF_DIR = "./output-diff";
const PDF_PATH = "./Pieper-Dogmatik1.pdf";
const MODEL_NAME = "gemini-2.5-pro";

/**
 * Setup the diff output directory
 */
async function setupDiffDirectory() {
  await setupDirectory(DIFF_DIR);
}

/**
 * Check a single page using Google AI with original PDF images
 * @param pageNumber The page number to check
 * @param previousPageContent Content of the previous page
 * @param currentPageContent Content of the current page
 * @param nextPageContent Content of the next page
 * @returns Diff content or null if no changes needed
 */
async function checkPageWithAI(
  pageNumber: number,
  previousPageContent: string,
  currentPageContent: string,
  nextPageContent: string
): Promise<string | null> {
  const apiKey = validateGoogleAIKey();
  const genAI = createGoogleAI(apiKey);

  // Get the original PDF page images for context
  const prevImageBuffer = await getPageImageBuffer(PDF_PATH, pageNumber - 1, OUTPUT_DIR);
  const currentImageBuffer = await getPageImageBuffer(PDF_PATH, pageNumber, OUTPUT_DIR);
  const nextImageBuffer = await getPageImageBuffer(PDF_PATH, pageNumber + 1, OUTPUT_DIR);

  if (!currentImageBuffer) {
    console.error(`Could not load image for page ${pageNumber}`);
    return null;
  }

  const prompt = `Du bist ein Experte für deutsche Sprache, LaTeX-Formatierung und OCR-Qualitätskontrolle. Du erhältst:

1. Die ursprünglichen PDF-Seiten als Bilder (vorherige, aktuelle, nächste Seite)
2. Den bereits durch OCR erkannten Text der aktuellen Seite

Deine Aufgabe: Vergleiche den OCR-Text mit dem ursprünglichen Bild der Seite ${pageNumber} und überprüfe auf:

AKTUELLE SEITE (${pageNumber}) - OCR-TEXT:
${currentPageContent}

KONTEXT DER VORHERIGEN SEITE (${pageNumber - 1}) - OCR-TEXT:
${previousPageContent || "Keine vorherige Seite verfügbar"}

KONTEXT DER NÄCHSTEN SEITE (${pageNumber + 1}) - OCR-TEXT:
${nextPageContent || "Keine nächste Seite verfügbar"}

Überprüfe besonders:
1. OCR-Fehler durch Vergleich des Texts mit dem ursprünglichen Bild
2. Falsch erkannte Zeichen (z.B. 'rn' statt 'm', 'cl' statt 'd')
3. Fehlende oder zusätzliche Buchstaben/Wörter
4. Falsche Zeilentrennung oder Absatzbildung
5. LaTeX-Formatierungsfehler
6. Inkonsistenzen mit dem Kontext der vorherigen/nächsten Seite
7. Rechtschreibfehler, die durch OCR entstanden sein könnten
8. Fehlende oder falsche Satzzeichen

Nutze die Bilder der vorherigen und nächsten Seite als zusätzlichen Kontext, um Wortübergänge und Satzanschlüsse zu verstehen.

Wenn du Korrekturen findest, gib sie im JSON-Format zurück. Wenn keine Korrekturen nötig sind, setze needsCorrection auf false.`;

  // Prepare image parts for the API call
  const imageParts = [];
  if (prevImageBuffer) {
    imageParts.push(fileToGenerativePart(prevImageBuffer, "image/png"));
  }
  imageParts.push(fileToGenerativePart(currentImageBuffer, "image/png"));
  if (nextImageBuffer) {
    imageParts.push(fileToGenerativePart(nextImageBuffer, "image/png"));
  }

  try {
    const result = await genAI.models.generateContent({
      model: MODEL_NAME,
      contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            needsCorrection: {
              type: Type.BOOLEAN,
              description: "Whether the current page content needs correction"
            },
            corrections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  lineNumber: {
                    type: Type.INTEGER,
                    description: "Line number with the issue"
                  },
                  original: {
                    type: Type.STRING,
                    description: "Original incorrect text"
                  },
                  corrected: {
                    type: Type.STRING,
                    description: "Corrected text"
                  },
                  reason: {
                    type: Type.STRING,
                    description: "Explanation for the correction"
                  }
                }
              }
            }
          }
        },
        safetySettings: STANDARD_SAFETY_SETTINGS,
      },
    });

    const responseText = result.text as string;

    try {
      if (typeof responseText !== "string") {
        console.info(result.data);
        throw new Error("Response was not a string.");
      }

      const parsedResponse = result
        ? (JSON.parse(responseText) as any)
        : null;
      
      if (parsedResponse?.needsCorrection && parsedResponse?.corrections && parsedResponse.corrections.length > 0) {
        return generateDiffOutput(parsedResponse.corrections, currentPageContent);
      }
      
      return null;
    } catch (error) {
      console.error("Error parsing response:", error);
      console.info("AI Response:", result?.text);
      throw new Error("Response could not be interpreted as JSON object.");
    }
  } catch (error) {
    console.error(`Error checking page ${pageNumber}:`, error);
    return null;
  }
}

/**
 * Generate diff output from corrections
 * @param corrections Array of corrections
 * @param originalContent Original page content
 * @returns Formatted diff string
 */
function generateDiffOutput(corrections: any[], originalContent: string): string {
  const lines = originalContent.split('\n');
  let diffOutput = "--- CORRECTIONS FOUND ---\n\n";
  
  corrections.forEach((correction, index) => {
    diffOutput += `Correction ${index + 1}:\n`;
    diffOutput += `Line ${correction.lineNumber || 'Unknown'}: ${correction.reason}\n`;
    diffOutput += `- Original: ${correction.original}\n`;
    diffOutput += `+ Corrected: ${correction.corrected}\n\n`;
  });
  
  diffOutput += "--- FULL CORRECTED CONTENT ---\n\n";
  
  // Apply corrections to generate full corrected content
  let correctedContent = originalContent;
  corrections.forEach((correction) => {
    correctedContent = correctedContent.replace(correction.original, correction.corrected);
  });
  
  diffOutput += correctedContent;
  
  return diffOutput;
}

/**
 * Save diff to file
 * @param pageNumber Page number
 * @param diffContent Diff content to save
 */
async function saveDiff(pageNumber: number, diffContent: string) {
  const diffFileName = `page${pageNumber}_corrections.diff`;
  const diffFilePath = path.join(DIFF_DIR, diffFileName);
  
  try {
    await fs.writeFile(diffFilePath, diffContent, "utf-8");
    console.log(`Diff saved to: ${diffFilePath}`);
  } catch (error) {
    console.error(`Failed to save diff for page ${pageNumber}:`, error);
  }
}

/**
 * Check a specific page or all pages
 * @param pageNumber Optional specific page to check, if not provided checks all pages
 */
async function checkPages(pageNumber?: number) {
  await setupDiffDirectory();
  
  const availablePages = await getAvailablePages(OUTPUT_DIR);
  
  if (availablePages.length === 0) {
    console.log("No pages found to check.");
    return;
  }
  
  const pagesToCheck = pageNumber ? [pageNumber] : availablePages;
  let totalCorrections = 0;
  
  for (const page of pagesToCheck) {
    if (!availablePages.includes(page)) {
      console.log(`Page ${page} not found, skipping.`);
      continue;
    }
    
    console.log(`Checking page ${page}...`);
    
    const previousPageContent = await readPageTexFile(OUTPUT_DIR, page - 1);
    const currentPageContent = await readPageTexFile(OUTPUT_DIR, page);
    const nextPageContent = await readPageTexFile(OUTPUT_DIR, page + 1);
    
    if (!currentPageContent) {
      console.log(`Page ${page} content is empty, skipping.`);
      continue;
    }
    
    const diffContent = await checkPageWithAI(
      page,
      previousPageContent,
      currentPageContent,
      nextPageContent
    );
    
    if (diffContent) {
      await saveDiff(page, diffContent);
      totalCorrections++;
      
      // Send Pushover notification for each page with corrections
      await sendPushoverNotification(
        `OCR Check: Corrections found for page ${page}. Check output-diff/page${page}_corrections.diff`
      );
      
      console.log(`✓ Corrections found and saved for page ${page}`);
    } else {
      console.log(`✓ No corrections needed for page ${page}`);
    }
  }
  
  if (totalCorrections > 0) {
    console.log(`\nTotal pages with corrections: ${totalCorrections}`);
    await sendPushoverNotification(
      `OCR Check completed: ${totalCorrections} pages needed corrections. Check output-diff/ folder.`
    );
  } else {
    console.log("\nAll checked pages are correct!");
  }
}

/**
 * Main function
 */
async function main() {
  const apiKey = validateGoogleAIKey();
  
  // Check if a specific page number was provided as command line argument
  const pageArg = process.argv[2];
  const pageNumber = pageArg ? parseInt(pageArg, 10) : undefined;
  
  if (pageArg && isNaN(pageNumber!)) {
    console.error("Invalid page number provided.");
    process.exit(1);
  }
  
  try {
    await checkPages(pageNumber);
  } catch (error) {
    console.error("Error during page checking:", error);
    await sendPushoverNotification(`OCR Check failed: ${error}`);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.main) {
  main();
}

export { checkPages, checkPageWithAI };
