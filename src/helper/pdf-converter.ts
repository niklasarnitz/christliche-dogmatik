import * as fs from "fs/promises";
import { fromPath } from "pdf2pic";

/**
 * Konvertiert einen Buffer in ein für die API passendes GenerativePart-Objekt.
 * @param imageBuffer Der Buffer des Seitenbildes.
 * @param mimeType Der Mime-Typ des Bildes (z.B. 'image/png').
 * @returns Ein Objekt, das die API für Bilddaten erwartet.
 */
export function fileToGenerativePart(imageBuffer: Buffer, mimeType: string) {
  return {
    inlineData: {
      data: imageBuffer.toString("base64"),
      mimeType,
    },
  };
}

/**
 * Get PDF page as image buffer
 * @param pdfPath Path to the PDF file
 * @param pageNumber The page number to convert
 * @param outputDir Directory to save temporary images
 * @returns Buffer of the page image or null if not found
 */
export async function getPageImageBuffer(
  pdfPath: string,
  pageNumber: number,
  outputDir: string
): Promise<Buffer | null> {
  try {
    // Skip invalid page numbers
    if (pageNumber <= 0) return null;
    
    const converter = fromPath(pdfPath, {
      density: 300,
      savePath: outputDir,
      format: "png",
      width: 2480, // A4 @ 300dpi
      height: 3508,
    });

    const result = await converter(pageNumber);
    const outputImagePath = result.path;
    
    if (outputImagePath) {
      const buf = await fs.readFile(outputImagePath);
      return buf.length > 0 ? buf : null;
    }
    return null;
  } catch (error) {
    console.error(`Error getting image for page ${pageNumber}:`, error);
    return null;
  }
}
