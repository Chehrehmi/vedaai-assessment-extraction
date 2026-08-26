import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ExtractedPageText {
  pageNumber: number;
  lines: string[];
  rawText: string;
}

export interface ExtractedDocumentText {
  hasText: boolean;
  pageCount: number;
  pages: ExtractedPageText[];
  fullText: string;
}

/**
 * Conservative threshold for considering a PDF document to have a usable text layer.
 * A document with fewer than 30 non-whitespace characters is treated as image-only/scanned.
 */
export const MIN_TEXT_LAYER_CHARACTERS = 30;

/**
 * Extracts structured text layer content from an uploaded PDF buffer.
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<ExtractedDocumentText> {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    return {
      hasText: false,
      pageCount: 0,
      pages: [],
      fullText: '',
    };
  }

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      disableFontFace: false,
    });

    const pdfDoc = await loadingTask.promise;
    const pageCount = pdfDoc.numPages;

    const pages: ExtractedPageText[] = [];
    let totalNonWhitespaceChars = 0;

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group text items by Y-coordinate line buckets (tolerance ~4pt)
      const lineMap = new Map<number, { x: number; str: string }[]>();

      for (const item of textContent.items) {
        if (!('str' in item) || !item.str) continue;

        const x = item.transform[4];
        const y = Math.round(item.transform[5]);

        // Find existing line bucket within 4 points
        let matchedBucket: number | null = null;
        for (const bucketY of lineMap.keys()) {
          if (Math.abs(bucketY - y) <= 4) {
            matchedBucket = bucketY;
            break;
          }
        }

        if (matchedBucket !== null) {
          lineMap.get(matchedBucket)!.push({ x, str: item.str });
        } else {
          lineMap.set(y, [{ x, str: item.str }]);
        }
      }

      // Sort lines top-to-bottom (higher Y to lower Y in PDF coordinates)
      const sortedYKeys = Array.from(lineMap.keys()).sort((a, b) => b - a);

      const lines: string[] = [];
      for (const y of sortedYKeys) {
        // Sort items left-to-right (lower X to higher X)
        const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
        const lineText = items
          .map((it) => it.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (lineText.length > 0) {
          lines.push(lineText);
          totalNonWhitespaceChars += lineText.replace(/\s/g, '').length;
        }
      }

      const rawText = lines.join('\n');
      pages.push({
        pageNumber: pageNum,
        lines,
        rawText,
      });
    }

    const fullText = pages.map((p) => p.rawText).join('\n\n');
    const hasText = totalNonWhitespaceChars >= MIN_TEXT_LAYER_CHARACTERS;

    return {
      hasText,
      pageCount,
      pages,
      fullText,
    };
  } catch {
    // If PDF text extraction throws, safely treat as no text layer
    return {
      hasText: false,
      pageCount: 0,
      pages: [],
      fullText: '',
    };
  }
}
