#!/usr/bin/env bun

/**
 * Check OCR output script
 * 
 * Usage:
 * bun run check-ocr.ts           # Check all pages
 * bun run check-ocr.ts 42        # Check only page 42
 * bun run check-ocr.ts 10-20     # Check pages 10 to 20
 */

import { checkPages } from "./check.ts";

async function main() {
  const arg = process.argv[2];
  
  if (!arg) {
    // Check all pages
    console.log("Checking all pages...");
    await checkPages();
    return;
  }
  
  if (arg.includes("-")) {
    // Range of pages (e.g., "10-20")
    const parts = arg.split("-");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      console.error("Invalid page range format. Use format: start-end (e.g., 10-20)");
      process.exit(1);
    }
    
    const [startStr, endStr] = parts;
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    
    if (isNaN(start) || isNaN(end) || start > end) {
      console.error("Invalid page range. Use format: start-end (e.g., 10-20)");
      process.exit(1);
    }
    
    console.log(`Checking pages ${start} to ${end}...`);
    for (let page = start; page <= end; page++) {
      await checkPages(page);
    }
    return;
  }
  
  // Single page
  const pageNumber = parseInt(arg, 10);
  if (isNaN(pageNumber)) {
    console.error("Invalid page number. Use a number or range (e.g., 42 or 10-20)");
    process.exit(1);
  }
  
  console.log(`Checking page ${pageNumber}...`);
  await checkPages(pageNumber);
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
