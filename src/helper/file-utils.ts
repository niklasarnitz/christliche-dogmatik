import * as fs from "fs/promises";
import * as path from "path";

/**
 * Read a page tex file if it exists
 * @param outputDir The output directory containing tex files
 * @param pageNumber The page number to read
 * @returns The content of the tex file or empty string if not found
 */
export async function readPageTexFile(outputDir: string, pageNumber: number): Promise<string> {
  const filePath = path.join(outputDir, `page${pageNumber}.tex`);
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Get all available page numbers from the output directory
 * @param outputDir The output directory to scan
 * @returns Array of page numbers sorted in ascending order
 */
export async function getAvailablePages(outputDir: string): Promise<number[]> {
  try {
    const files = await fs.readdir(outputDir);
    const pageTexFiles = files.filter((f) => /^page\d+\.tex$/.test(f));
    const pageNumbers = pageTexFiles.map((f) => parseInt(f.match(/\d+/)![0], 10));
    return pageNumbers.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Bestimmt die letzte verarbeitete Seite anhand der vorhandenen .tex-Dateien im OUTPUT_DIR.
 * Gibt die höchste gefundene Seitenzahl zurück.
 */
export async function getLastProcessedPageByTex(outputDir: string): Promise<number> {
  const files = await fs.readdir(outputDir);
  const pageTexFiles = files.filter((f) => /^page\d+\.tex$/.test(f));
  if (pageTexFiles.length === 0) return 0;
  const pageNumbers = pageTexFiles.map((f) => parseInt(f.match(/\d+/)![0], 10));
  return Math.max(...pageNumbers);
}

/**
 * Setup a directory, creating it if it doesn't exist
 * @param dirPath The directory path to create
 */
export async function setupDirectory(dirPath: string) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    console.error(`Failed to create directory ${dirPath}:`, err);
  }
}
