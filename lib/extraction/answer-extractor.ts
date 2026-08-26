import { randomUUID } from 'crypto';
import { Answer, AnswerRegion } from '../domain/types';
import { AnswerSchema, AnswerRegionSchema } from '../validation/schemas';
import { DocumentAIProvider, GeminiDocumentAIProvider, PageImageInput, RawAnswerBlock } from '../ai';
import { normalizeBox2d } from './coordinates';

export interface ExtractAnswersOptions {
  pageImages: PageImageInput[];
  provider?: DocumentAIProvider;
}

export interface ExtractAnswersResult {
  answers: Answer[];
  answerCount: number;
}

/**
 * Normalizes a raw answer block's bounding box into one or more valid AnswerRegion domain records.
 */
export function normalizeRawRegions(block: RawAnswerBlock): AnswerRegion[] {
  const regions: AnswerRegion[] = [];
  const confidence = typeof block.confidence === 'number' ? block.confidence : undefined;

  // 1. Check if block has direct box_2d
  if (block.box_2d && Array.isArray(block.box_2d) && block.box_2d.length === 4) {
    const norm = normalizeBox2d(block.box_2d);
    const region: AnswerRegion = {
      page: block.page,
      x: norm.x,
      y: norm.y,
      width: norm.width,
      height: norm.height,
      extractionConfidence: confidence,
    };
    regions.push(AnswerRegionSchema.parse(region));
  }

  // 2. Check if block has nested regions
  if (block.regions && Array.isArray(block.regions)) {
    for (const r of block.regions) {
      if (r.box_2d && Array.isArray(r.box_2d) && r.box_2d.length === 4) {
        const norm = normalizeBox2d(r.box_2d);
        const region: AnswerRegion = {
          page: block.page,
          x: norm.x,
          y: norm.y,
          width: norm.width,
          height: norm.height,
          extractionConfidence: r.extractionConfidence ?? confidence,
        };
        regions.push(AnswerRegionSchema.parse(region));
      } else if (
        typeof r.x === 'number' &&
        typeof r.y === 'number' &&
        typeof r.width === 'number' &&
        typeof r.height === 'number'
      ) {
        const region: AnswerRegion = {
          page: block.page,
          x: Number(r.x.toFixed(4)),
          y: Number(r.y.toFixed(4)),
          width: Number(r.width.toFixed(4)),
          height: Number(r.height.toFixed(4)),
          extractionConfidence: r.extractionConfidence ?? confidence,
        };
        regions.push(AnswerRegionSchema.parse(region));
      }
    }
  }

  return regions;
}

/**
 * Normalizes question references to handle common student notation variants.
 * e.g. "Q1" -> "1", "Ans 2" -> "2", "Question 11(a)" -> "11(a)"
 */
export function normalizeQuestionReference(ref?: string | null): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;

  // Strip leading prefixes like "Q.", "Q", "Question", "Ans", "Answer", "No."
  const clean = trimmed.replace(/^(?:q(?:uestion)?|ans(?:wer)?|no)\.?\s*[:\-]?\s*/i, '').trim();
  return clean || null;
}

/**
 * Extracts handwritten answer blocks from rasterized answer-sheet page images.
 * Groups multi-page answers and multi-region answers into canonical logical Answer records.
 */
export async function extractAnswers(
  options: ExtractAnswersOptions
): Promise<ExtractAnswersResult> {
  const { pageImages, provider } = options;

  if (!pageImages || pageImages.length === 0) {
    return {
      answers: [],
      answerCount: 0,
    };
  }

  const aiProvider = provider || new GeminiDocumentAIProvider();
  const rawBlocks = await aiProvider.extractAnswersFromImages(pageImages);

  if (!rawBlocks || rawBlocks.length === 0) {
    return {
      answers: [],
      answerCount: 0,
    };
  }

  // Builder accumulator for logical Answer records
  interface AnswerBuilder {
    id: string;
    detectedQuestionReference: string | null;
    rawTexts: string[];
    pages: number[];
    regions: AnswerRegion[];
  }

  const builders: AnswerBuilder[] = [];

  for (const block of rawBlocks) {
    let blockRegions: AnswerRegion[] = [];
    try {
      blockRegions = normalizeRawRegions(block);
    } catch {
      continue;
    }

    if (blockRegions.length === 0) {
      continue;
    }

    const text = block.transcription || block.text || '';
    const normRef = normalizeQuestionReference(block.detectedQuestionReference);
    const lastBuilder = builders.length > 0 ? builders[builders.length - 1] : null;

    // Determine if this block is a continuation of the currently active answer:
    // 1. Same explicit non-null reference on same or immediately contiguous page (p or p-1)
    const isExplicitContinuation =
      Boolean(normRef) &&
      Boolean(lastBuilder) &&
      lastBuilder?.detectedQuestionReference === normRef &&
      (lastBuilder.pages.includes(block.page) ||
        Math.max(...lastBuilder.pages) === block.page - 1);

    // 2. Unreferenced block on the immediately contiguous next page (p-1 -> p)
    const isUnreferencedContinuation =
      !normRef &&
      Boolean(lastBuilder) &&
      Math.max(...lastBuilder!.pages) === block.page - 1;

    if ((isExplicitContinuation || isUnreferencedContinuation) && lastBuilder) {
      if (text) lastBuilder.rawTexts.push(text);
      if (!lastBuilder.pages.includes(block.page)) {
        lastBuilder.pages.push(block.page);
        lastBuilder.pages.sort((a, b) => a - b);
      }
      lastBuilder.regions.push(...blockRegions);
    } else {
      // Start a new logical Answer
      builders.push({
        id: randomUUID(),
        detectedQuestionReference: normRef,
        rawTexts: text ? [text] : [],
        pages: [block.page],
        regions: [...blockRegions],
      });
    }
  }

  const answers: Answer[] = builders.map((b) => {
    const answer: Answer = {
      id: b.id,
      rawText: b.rawTexts.length > 0 ? b.rawTexts.join('\n\n') : undefined,
      pages: b.pages,
      regions: b.regions,
      detectedQuestionReference: b.detectedQuestionReference,
    };
    return AnswerSchema.parse(answer);
  });

  return {
    answers,
    answerCount: answers.length,
  };
}
