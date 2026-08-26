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
 * Raw spatial region output from AI provider.
 */
export interface RawAnswerRegion {
  box_2d?: [number, number, number, number] | number[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  extractionConfidence?: number;
}

/**
 * Raw structured answer output from AI provider.
 */
export interface RawAnswerBlock {
  page: number;
  detectedQuestionReference?: string | null;
  text?: string;
  transcription?: string;
  confidence?: number;
  box_2d?: [number, number, number, number] | number[];
  regions?: RawAnswerRegion[];
}

/**
 * Candidate question structure for semantic AI mapping fallback.
 */
export interface SemanticQuestionCandidate {
  id: string;
  number: string;
  text: string;
  parentNumber?: string;
  subPart?: string;
  alternativeText?: string;
}

/**
 * Candidate answer structure for semantic AI mapping fallback.
 */
export interface SemanticAnswerCandidate {
  id: string;
  detectedQuestionReference?: string | null;
  rawText?: string;
  pages: number[];
}

/**
 * AI mapping decision output for a single answer candidate.
 */
export interface SemanticMappingDecision {
  answerId: string;
  questionId: string | null;
  confidence: number;
  reason?: string;
}

/**
 * Agnostic Document AI provider interface.
 */
export interface DocumentAIProvider {
  /**
   * Extracts questions from question-paper page images using vision analysis.
   */
  extractQuestionsFromImages(pages: PageImageInput[]): Promise<RawQuestionExtraction[]>;

  /**
   * Extracts handwritten answer blocks and bounding boxes from answer-sheet page images.
   */
  extractAnswersFromImages(pages: PageImageInput[]): Promise<RawAnswerBlock[]>;

  /**
   * Resolves semantic mappings between unresolved questions and candidate answers.
   */
  resolveSemanticMappings?(
    questions: SemanticQuestionCandidate[],
    answers: SemanticAnswerCandidate[]
  ): Promise<SemanticMappingDecision[]>;
}
