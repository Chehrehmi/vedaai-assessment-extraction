/**
 * Page image input for vision-based AI document analysis.
 */
export interface PageImageInput {
  pageNumber: number;
  imageBuffer: Buffer;
  mimeType: 'image/png';
}

/**
 * Raw structured question output from AI provider before domain mapping.
 */
export interface RawQuestionExtraction {
  number: string;
  text: string;
  parentNumber?: string;
  subPart?: string;
  alternativeText?: string;
  alternativeType?: 'visually_impaired';
}

/**
 * Agnostic Document AI provider interface.
 */
export interface DocumentAIProvider {
  /**
   * Extracts questions from question-paper page images using vision analysis.
   */
  extractQuestionsFromImages(pages: PageImageInput[]): Promise<RawQuestionExtraction[]>;
}
