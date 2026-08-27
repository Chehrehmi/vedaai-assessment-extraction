import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
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

let standardFontsRegistered = false;

/**
 * Registers standard 14 PDF fonts with @napi-rs/canvas GlobalFonts so standard fonts
 * like Helvetica, Times, and Courier render accurately via ctx.fillText.
 */
function ensureStandardFontsRegistered(standardFontDir: string): void {
  if (standardFontsRegistered || !GlobalFonts) return;

  const stdFontMappings = [
    { file: 'LiberationSans-Regular.ttf', names: ['Helvetica', 'Arial', 'Liberation Sans', 'sans-serif'] },
    { file: 'LiberationSans-Bold.ttf', names: ['Helvetica-Bold', 'Arial-Bold', 'Helvetica Bold', 'Arial Bold'] },
    { file: 'LiberationSans-Italic.ttf', names: ['Helvetica-Oblique', 'Arial-Italic', 'Helvetica Italic'] },
    { file: 'LiberationSans-BoldItalic.ttf', names: ['Helvetica-BoldOblique', 'Arial-BoldItalic'] },
    { file: 'FoxitSerif.pfb', names: ['Times', 'Times-Roman', 'serif'] },
    { file: 'FoxitSerifBold.pfb', names: ['Times-Bold'] },
    { file: 'FoxitSerifItalic.pfb', names: ['Times-Italic'] },
    { file: 'FoxitSerifBoldItalic.pfb', names: ['Times-BoldItalic'] },
    { file: 'FoxitFixed.pfb', names: ['Courier', 'monospace'] },
    { file: 'FoxitFixedBold.pfb', names: ['Courier-Bold'] },
    { file: 'FoxitSymbol.pfb', names: ['Symbol'] },
    { file: 'FoxitDingbats.pfb', names: ['ZapfDingbats'] },
  ];

  for (const mapping of stdFontMappings) {
    const fontPath = path.join(standardFontDir, mapping.file);
    if (fs.existsSync(fontPath)) {
      try {
        const fontBuf = fs.readFileSync(fontPath);
        for (const name of mapping.names) {
          GlobalFonts.register(fontBuf, name);
        }
      } catch {
        // Ignore font format registration errors
      }
    }
  }

  standardFontsRegistered = true;
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
    ensureStandardFontsRegistered(standardFontDataUrl);

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl,
      disableFontFace: true,
      useSystemFonts: true,
    });

    const pdfDoc = await loadingTask.promise;

    // Standard 14 PDF fonts (Helvetica, Times, Courier) are not embedded in the PDF and
    // do not have vector glyph paths in pdfjs-dist. For standard fonts (font.missingFile === true),
    // disableFontFace must be false so CanvasGraphics renders them cleanly via ctx.fillText using
    // our registered GlobalFonts. Embedded fonts (font.missingFile === false) continue using
    // disableFontFace = true to render exact vector path curves.
    const commonObjs = (pdfDoc as any)._transport?.commonObjs;
    if (commonObjs && typeof commonObjs.resolve === 'function') {
      const originalResolve = commonObjs.resolve.bind(commonObjs);
      commonObjs.resolve = function (id: string, font: any) {
        if (font && typeof font === 'object' && 'disableFontFace' in font) {
          if (font.missingFile) {
            font.disableFontFace = false;
          } else {
            font.disableFontFace = true;
          }
        }
        return originalResolve(id, font);
      };
    }

    const pageCount = pdfDoc.numPages;

    if (pageCount <= 0) {
      throw new Error('PDF contains no pages');
    }

    const pages: RasterizedPage[] = [];

    try {
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

        // Explicitly release page-level operator lists and resources
        try {
          page.cleanup();
        } catch {
          // Ignore cleanup errors
        }

        pages.push({
          pageNumber: pageNum,
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
          imageBuffer,
          mimeType: 'image/png',
        });
      }

      return { pageCount, pages };
    } finally {
      // Explicitly cleanup and destroy pdf.js document parser to release memory
      try {
        pdfDoc.cleanup();
        pdfDoc.destroy();
      } catch {
        // Ignore destruction errors
      }
    }
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
