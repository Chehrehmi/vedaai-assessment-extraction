import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { GoogleGenAI, Type } from '@google/genai';

import {
  RawGeminiResponseSchema,
  RawGeminiResponse,
  NormalizedAnswerBlock,
  NormalizedPageExtraction,
} from '../src/types/extraction.js';
import { normalizeBox2d } from '../src/utils/coordinates.js';
import { createAnnotatedPageImage } from '../src/utils/annotator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT = `
You are an expert document analysis vision AI specialized in handwritten exam answer sheets.
Analyze this single page image from a student's handwritten answer sheet.

Task:
Identify all distinct handwritten answer blocks visible on this page.

Instructions:
1. Inspect ONLY the current page image.
2. Identify distinct handwritten answer blocks. If multiple separate questions are answered on this single page, return a separate block for each question.
3. Detect explicit question references if visibly present (e.g. "Q1", "Q2", "Q3", "1", "2", "11(a)", "11(b)", "Ans 1", "Question 1").
   - If an explicit reference is written, record it exactly.
   - If NO question reference is written (e.g., it is a continuation of an answer from a previous page or unlabeled handwriting), set detectedQuestionReference to null.
   - NEVER invent or guess a question reference that is not visibly written on the page.
4. Distinguish student answer content from header metadata (such as Student Name, Registration Number, Subject Code, Exam Title at the top). Do NOT include header metadata in answer bounding boxes.
5. Include handwritten explanations, algorithms, pseudocode, equations, formulas, calculations, derivations, and diagrams that belong to the answer.
6. Provide spatial bounding boxes for each block using [ymin, xmin, ymax, xmax] integers scaled 0 to 1000 (where 0,0 is the top-left corner and 1000,1000 is the bottom-right corner).
   - The bounding box must reasonably enclose the complete handwritten content of that answer block (including any question label, prose, equations, and code).
7. Provide a best-effort transcription of the handwritten text in the block.
8. Provide a confidence score between 0.0 and 1.0 indicating your confidence in the detection and spatial boundary.
9. Return ONLY the requested JSON array matching the schema.
`;

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      detectedQuestionReference: {
        type: Type.STRING,
        description: 'Question reference like Q1, Q2, 1, 11(a) or null if absent/continuation',
        nullable: true,
      },
      box_2d: {
        type: Type.ARRAY,
        items: { type: Type.INTEGER },
        description: '[ymin, xmin, ymax, xmax] integer bounding box on a 0 to 1000 coordinate scale',
      },
      text: {
        type: Type.STRING,
        description: 'Best-effort transcription of handwritten text in this answer block',
      },
      confidence: {
        type: Type.NUMBER,
        description: 'Confidence score between 0.0 and 1.0',
      },
    },
    required: ['box_2d', 'text', 'confidence'],
  },
};

interface SpikeResult {
  modelName: string;
  totalPages: number;
  totalCalls: number;
  totalRetries: number;
  pages: NormalizedPageExtraction[];
  rawResponses: Record<number, RawGeminiResponse>;
}

async function runSpike(): Promise<void> {
  console.log('====================================================');
  console.log('   VedaAI Phase 0: Gemini Spatial Grounding Spike   ');
  console.log('====================================================\n');

  const apiKey = process.env.LLM_API_KEY;
  const modelName = process.env.LLM_MODEL_NAME;

  if (!apiKey) {
    throw new Error('Missing process.env.LLM_API_KEY');
  }
  if (!modelName) {
    throw new Error('Missing process.env.LLM_MODEL_NAME');
  }

  console.log(`[Config] Model: ${modelName}`);
  console.log(`[Config] API Key: Configured (length: ${apiKey.length})\n`);

  const defaultPdfPath = path.resolve(
    __dirname,
    '../../reference/2240208_CSC631_CIA1_ComponentA_2.pdf'
  );
  const pdfPath = process.env.SAMPLE_PDF_PATH
    ? path.resolve(process.env.SAMPLE_PDF_PATH)
    : defaultPdfPath;

  if (!fs.existsSync(pdfPath)) {
    throw new Error(
      `PDF sample not found at: "${pdfPath}".\n` +
      `Please provide a valid path using the SAMPLE_PDF_PATH environment variable (e.g. SAMPLE_PDF_PATH=/path/to/answer-sheet.pdf npm run spike).`
    );
  }

  console.log(`[Input] Loading PDF: ${pdfPath}`);
  const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));
  const fontPath = path.resolve('node_modules/pdfjs-dist/standard_fonts/') + '/';

  const doc = await pdfjsLib.getDocument({
    data: pdfBytes,
    standardFontDataUrl: fontPath,
  }).promise;

  const totalPages = doc.numPages;
  console.log(`[Input] PDF loaded successfully. Total pages: ${totalPages}\n`);

  // Ensure output directories exist
  const outputBase = path.resolve(__dirname, '../phase0-output');
  const rawDir = path.join(outputBase, 'raw');
  const normDir = path.join(outputBase, 'normalized');
  const annotDir = path.join(outputBase, 'annotated');

  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(normDir, { recursive: true });
  fs.mkdirSync(annotDir, { recursive: true });

  const ai = new GoogleGenAI({ apiKey });

  let totalCalls = 0;
  let totalRetries = 0;
  const pageExtractions: NormalizedPageExtraction[] = [];
  const rawResponses: Record<number, RawGeminiResponse> = {};

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    console.log(`--- [Processing Page ${pageNum}/${totalPages}] ---`);
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    await page.render({ canvasContext: context as any, viewport }).promise;
    const pageImageBuffer = canvas.toBuffer('image/png');
    const imageBase64 = pageImageBuffer.toString('base64');

    console.log(`  Page rasterized: ${Math.round(viewport.width)}x${Math.round(viewport.height)}px (${Math.round(pageImageBuffer.length / 1024)} KB)`);

    // Call Gemini with retry logic
    let rawBlocks: RawGeminiResponse | null = null;
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts && !rawBlocks) {
      attempt++;
      totalCalls++;

      try {
        console.log(`  Sending request to Gemini (${modelName}) [Attempt ${attempt}]...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: 'image/png', data: imageBase64 } },
                { text: PROMPT },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        });

        const rawText = response.text || '[]';
        const parsedJson = JSON.parse(rawText);
        const validated = RawGeminiResponseSchema.safeParse(parsedJson);

        if (!validated.success) {
          console.warn(`  [Validation Warning] Model output failed Zod schema:`, validated.error.issues);
          if (attempt < maxAttempts) {
            totalRetries++;
            console.log(`  Retrying Page ${pageNum}...`);
            continue;
          } else {
            throw new Error(`Validation failed after ${maxAttempts} attempts for Page ${pageNum}: ${validated.error.message}`);
          }
        }

        rawBlocks = validated.data;
      } catch (err: any) {
        console.error(`  [API Error on Page ${pageNum}]`, err.message);
        if (attempt < maxAttempts) {
          totalRetries++;
          console.log(`  Retrying Page ${pageNum}...`);
        } else {
          throw err;
        }
      }
    }

    if (!rawBlocks) {
      throw new Error(`Failed to extract answers for Page ${pageNum}`);
    }

    rawResponses[pageNum] = rawBlocks;
    fs.writeFileSync(
      path.join(rawDir, `page-${pageNum}.json`),
      JSON.stringify(rawBlocks, null, 2)
    );

    // Normalize coordinates to VedaAI contract
    const normalizedBlocks: NormalizedAnswerBlock[] = rawBlocks.map((raw) => {
      const normalizedBox = normalizeBox2d(raw.box_2d);
      return {
        pageNumber: pageNum,
        detectedQuestionReference: raw.detectedQuestionReference || null,
        boundingBox: normalizedBox,
        text: raw.text,
        confidence: raw.confidence,
        originalBox2d: raw.box_2d,
      };
    });

    const pageExtraction: NormalizedPageExtraction = {
      pageNumber: pageNum,
      pageWidth: Math.round(viewport.width),
      pageHeight: Math.round(viewport.height),
      blocks: normalizedBlocks,
    };

    pageExtractions.push(pageExtraction);

    fs.writeFileSync(
      path.join(normDir, `page-${pageNum}.json`),
      JSON.stringify(pageExtraction, null, 2)
    );

    // Render annotated visual image
    const annotatedBuffer = await createAnnotatedPageImage(
      pageImageBuffer,
      pageNum,
      normalizedBlocks
    );

    fs.writeFileSync(path.join(annotDir, `page-${pageNum}.png`), annotatedBuffer);

    console.log(`  Extracted ${normalizedBlocks.length} block(s):`);
    normalizedBlocks.forEach((b, i) => {
      const q = b.detectedQuestionReference ? `QRef: "${b.detectedQuestionReference}"` : 'Continuation/Unlabeled';
      const box = `bbox: [x:${b.boundingBox.x}, y:${b.boundingBox.y}, w:${b.boundingBox.width}, h:${b.boundingBox.height}]`;
      console.log(`    #${i + 1}: ${q} | ${box} | conf: ${Math.round(b.confidence * 100)}%`);
    });
    console.log(`  Annotated image saved: phase0-output/annotated/page-${pageNum}.png\n`);
  }

  // Summary statistics
  const totalBlocks = pageExtractions.reduce((acc, p) => acc + p.blocks.length, 0);
  const blocksWithExplicitQ = pageExtractions.reduce(
    (acc, p) => acc + p.blocks.filter((b) => b.detectedQuestionReference !== null).length,
    0
  );
  const blocksWithoutExplicitQ = totalBlocks - blocksWithExplicitQ;
  const pagesWithMultipleBlocks = pageExtractions.filter((p) => p.blocks.length > 1).length;

  console.log('====================================================');
  console.log('                 SPIKE SUMMARY                      ');
  console.log('====================================================');
  console.log(`Total Pages Processed: ${totalPages}`);
  console.log(`Total Gemini API Calls: ${totalCalls}`);
  console.log(`Total Retries: ${totalRetries}`);
  console.log(`Total Answer Blocks Detected: ${totalBlocks}`);
  console.log(`Blocks with Explicit Reference: ${blocksWithExplicitQ}`);
  console.log(`Blocks without Explicit Reference (Continuations): ${blocksWithoutExplicitQ}`);
  console.log(`Pages with Multiple Blocks: ${pagesWithMultipleBlocks}`);
  console.log('====================================================\n');
}

runSpike().catch((err) => {
  console.error('[Spike Fatal Error]', err);
  process.exit(1);
});
