import { Question } from '../domain/types';
import { assessmentStore } from '../store';
import { rasterStore } from '../raster';
import { DocumentAIProvider, PageImageInput } from '../ai';
import { extractQuestions } from './question-extractor';

export * from './text-extractor';
export * from './question-parser';
export * from './question-extractor';

export interface ExtractAssessmentQuestionsOptions {
  pdfBuffer?: Buffer;
  provider?: DocumentAIProvider;
}

/**
 * Extracts questions from an assessment's question paper and updates the in-memory Assessment record.
 */
export async function extractQuestionsForAssessment(
  assessmentId: string,
  options?: ExtractAssessmentQuestionsOptions
): Promise<Question[]> {
  const assessment = assessmentStore.get(assessmentId);
  if (!assessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  // Retrieve rasterized question paper pages from store
  const rasterPages = rasterStore.getPages(assessmentId, 'question_paper');
  const pageImages: PageImageInput[] = rasterPages.map((rp) => ({
    pageNumber: rp.pageNumber,
    imageBuffer: rp.imageBuffer,
    mimeType: 'image/png',
  }));

  const result = await extractQuestions({
    pdfBuffer: options?.pdfBuffer,
    pageImages,
    provider: options?.provider,
  });

  // Update assessment with extracted questions while preserving all other fields
  assessmentStore.update(assessmentId, {
    questions: result.questions,
  });

  return result.questions;
}
