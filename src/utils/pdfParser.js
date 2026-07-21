import * as pdf from "pdf-parse";

/**
 * Extract text from a PDF buffer, tolerant of both pdf-parse APIs:
 *   - v2.x: named `PDFParse` class → new PDFParse({ data }).getText() → { text }
 *   - v1.x: default-export function → pdfParse(buffer) → { text }
 * A namespace import avoids the import-time crash on v2 (which has no default export).
 */
export const extractTextFromPDF = async (fileBuffer) => {
  // v2.x class API
  if (typeof pdf.PDFParse === "function") {
    const parser = new pdf.PDFParse({ data: fileBuffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  // v1.x function API (default export, or the namespace itself in CJS interop)
  const pdfParse = pdf.default ?? pdf;
  const result = await pdfParse(fileBuffer);
  return result.text;
};
