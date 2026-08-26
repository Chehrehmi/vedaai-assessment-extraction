import { randomUUID } from 'crypto';
import { Question } from '../domain/types';
import { QuestionSchema } from '../validation/schemas';
import { DocumentAIProvider, GeminiDocumentAIProvider, PageImageInput } from '../ai';
import { extractPdfText } from './text-extractor';
import { parseQuestionsFromLines, parseQuestionLabel } from './question-parser';

export interface ExtractQuestionsOptions {
  pdfBuffer?: Buffer;
  pageImages: PageImageInput[];
  provider?: DocumentAIProvider;
}

export interface ExtractionResult {
  questions: Question[];
  method: 'text_layer' | 'vision_fallback';
  questionCount: number;
}

/**
 * Hybrid question extractor:
 * 1. Attempts deterministic text-layer extraction for PDFs with text.
 * 2. Falls back to vision AI model only if text layer is unavailable/insufficient.
 */
export async function extractQuestions(
  options: ExtractQuestionsOptions
): Promise<ExtractionResult> {
  const { pdfBuffer, pageImages, provider } = options;

  // Path A: Deterministic Text Extraction
  if (pdfBuffer && pdfBuffer.length > 0) {
    const textDoc = await extractPdfText(pdfBuffer);

    if (textDoc.hasText) {
      const parsedQuestions = parseQuestionsFromLines(textDoc.pages);

      if (parsedQuestions.length > 0) {
        return {
          questions: parsedQuestions,
          method: 'text_layer',
          questionCount: parsedQuestions.length,
        };
      }
    }
  }

  // Path B: Vision AI Fallback
  if (!pageImages || pageImages.length === 0) {
    throw new Error(
      'Question extraction failed: no text layer found and no raster page images available for vision fallback'
    );
  }

  const aiProvider = provider || new GeminiDocumentAIProvider();
  const rawQuestions = await aiProvider.extractQuestionsFromImages(pageImages);

  if (!rawQuestions || rawQuestions.length === 0) {
    return {
      questions: [],
      method: 'vision_fallback',
      questionCount: 0,
    };
  }

  const questions: Question[] = rawQuestions.map((raw, idx) => {
    const labelInfo = parseQuestionLabel(raw.number);
    const q: Question = {
      id: randomUUID(),
      number: raw.number.trim(),
      text: raw.text.trim(),
      order: idx,
      parentNumber: raw.parentNumber || labelInfo.parentNumber,
      subPart: raw.subPart || labelInfo.subPart,
      alternativeText: raw.alternativeText,
      alternativeType: raw.alternativeType,
    };
    return QuestionSchema.parse(q);
  });

  return {
    questions,
    method: 'vision_fallback',
    questionCount: questions.length,
  };
}
