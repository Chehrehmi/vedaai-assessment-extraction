import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { RasterResult, RasterizedPage } from './types';

export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
] as const;

export type SupportedMimeType = typeof SUPPORTED_MIME_TYPES[number];

/**
 * Resolves the directory paths for pdfjs-dist cmaps and standard_fonts in Node.js.
 */
function getPdfjsAssetPaths(): { cMapUrl: string; standardFontDataUrl: string } {
  try {
    const require = createRequire(import.meta.url);
    const pdfjsPkg = require.resolve('pdfjs-dist/package.json');
    const pdfjsDir = path.dirname(pdfjsPkg);
    const cMapUrl = path.join(pdfjsDir, 'cmaps') + path.sep;
    const standardFontDataUrl = path.join(pdfjsDir, 'standard_fonts') + path.sep;
    if (fs.existsSync(cMapUrl) && fs.existsSync(standardFontDataUrl)) {
      return { cMapUrl, standardFontDataUrl };
    }
  } catch {
    // Fall through to directory search
  }

  const fallbackDir = path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
  return {
    cMapUrl: path.join(fallbackDir, 'cmaps') + path.sep,
    standardFontDataUrl: path.join(fallbackDir, 'standard_fonts') + path.sep,
  };
}

/**
 * Checks if a given MIME type is supported for rasterization.
 */
export function isSupportedMimeType(mimeType: string): mimeType is SupportedMimeType {
  return SUPPORTED_MIME_TYPES.includes(mimeType as SupportedMimeType);
}

/**
 * Rasterizes an uploaded PDF or image file buffer into normalized PNG page buffers with dimensions.
 */
export async function rasterizeDocument(
  buffer: Buffer,
  mimeType: string
): Promise<RasterResult> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Cannot rasterize empty document buffer');
  }

  const normalizedMime = mimeType.toLowerCase().trim();

  if (normalizedMime === 'application/pdf') {
    return rasterizePdf(buffer);
  } else if (
    normalizedMime === 'image/jpeg' ||
    normalizedMime === 'image/png' ||
    normalizedMime === 'image/jpg'
  ) {
    return rasterizeImage(buffer);
  } else {
    throw new Error(`Unsupported document MIME type for rasterization: "${mimeType}"`);
  }
}

/**
 * Renders each page of a PDF document at 2.0 scale into PNG page images.
 */
async function rasterizePdf(buffer: Buffer): Promise<RasterResult> {
  try {
    const { cMapUrl, standardFontDataUrl } = getPdfjsAssetPaths();

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl,
      disableFontFace: true,
      useSystemFonts: true,
    });


    const pdfDoc = await loadingTask.promise;
    const pageCount = pdfDoc.numPages;

    if (pageCount <= 0) {
      throw new Error('PDF contains no pages');
    }

    const pages: RasterizedPage[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const context = canvas.getContext('2d');

      await page.render({
        canvasContext: context as any,
        viewport,
      }).promise;

      const imageBuffer = canvas.toBuffer('image/png');

      pages.push({
        pageNumber: pageNum,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        imageBuffer,
        mimeType: 'image/png',
      });
    }

    return { pageCount, pages };
  } catch (err: any) {
    throw new Error(`Failed to rasterize PDF: ${err?.message || String(err)}`);
  }
}

/**
 * Renders a single image file into a standardized PNG page buffer.
 */
async function rasterizeImage(buffer: Buffer): Promise<RasterResult> {
  try {
    const img = await loadImage(buffer);

    const canvas = createCanvas(img.width, img.height);
    const context = canvas.getContext('2d');
    context.drawImage(img, 0, 0);

    const imageBuffer = canvas.toBuffer('image/png');

    return {
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          width: img.width,
          height: img.height,
          imageBuffer,
          mimeType: 'image/png',
        },
      ],
    };
  } catch (err: any) {
    throw new Error(`Failed to rasterize image: ${err?.message || String(err)}`);
  }
}
