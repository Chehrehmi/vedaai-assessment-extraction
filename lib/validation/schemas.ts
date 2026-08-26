import { z } from 'zod';

/**
 * Processing stage lifecycle enum
 */
export const ProcessingStageSchema = z.enum([
  'queued',
  'uploading',
  'reading_question_paper',
  'extracting_questions',
  'reading_answer_sheet',
  'detecting_answers',
  'mapping_answers',
  'finalizing',
  'completed',
  'failed',
]);

/**
 * Normalized spatial answer region contract [0, 1] fractions
 */
export const AnswerRegionSchema = z
  .object({
    page: z.number().int().min(1, 'Page number must be >= 1'),
    x: z.number().min(0, 'x must be >= 0').max(1, 'x must be <= 1'),
    y: z.number().min(0, 'y must be >= 0').max(1, 'y must be <= 1'),
    width: z.number().min(0, 'width must be >= 0').max(1, 'width must be <= 1'),
    height: z.number().min(0, 'height must be >= 0').max(1, 'height must be <= 1'),
    extractionConfidence: z.number().min(0, 'Confidence must be >= 0').max(1, 'Confidence must be <= 1').optional(),
  })
  .superRefine((val, ctx) => {
    if (val.x + val.width > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `AnswerRegion right edge exceeds page boundary (x + width = ${val.x + val.width} > 1)`,
        path: ['width'],
      });
    }
    if (val.y + val.height > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `AnswerRegion bottom edge exceeds page boundary (y + height = ${val.y + val.height} > 1)`,
        path: ['height'],
      });
    }
  });

/**
 * Answer entity spanning one or more pages/regions
 */
export const AnswerSchema = z
  .object({
    id: z.string().min(1, 'Answer id must not be empty'),
    rawText: z.string().optional(),
    pages: z.array(z.number().int().min(1, 'Page must be >= 1')).min(1, 'pages must contain at least one page number'),
    regions: z.array(AnswerRegionSchema).min(1, 'regions must contain at least one region'),
    detectedQuestionReference: z.string().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    for (let i = 0; i < val.pages.length - 1; i++) {
      if (val.pages[i] > val.pages[i + 1]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Answer pages array must be sorted in ascending order (found ${val.pages[i]} before ${val.pages[i + 1]})`,
          path: ['pages', i + 1],
        });
        break;
      }
    }
  });

/**
 * Question entity with deterministic ordering, sub-question, and accessible alternative support
 */
export const QuestionSchema = z.object({
  id: z.string().min(1, 'Question id must not be empty'),
  number: z.string().min(1, 'Question number must not be empty'),
  text: z.string(),
  order: z.number().int().min(0, 'Question order must be >= 0'),
  parentNumber: z.string().optional(),
  subPart: z.string().optional(),
  alternativeText: z.string().optional(),
  alternativeType: z.literal('visually_impaired').optional(),
});

/**
 * Answer mapping status and method enums
 */
export const MappingStatusSchema = z.enum([
  'matched',
  'needs_review',
  'unanswered',
  'unmatched',
]);

export const MappingMethodSchema = z.enum([
  'explicit_reference',
  'structural',
  'semantic',
]);

/**
 * Answer mapping linking a Question to an Answer with confidence and method
 */
export const AnswerMappingSchema = z
  .object({
    questionId: z.string().min(1, 'questionId must not be empty'),
    answerId: z.string().min(1, 'answerId must not be empty').optional(),
    confidence: z.number().min(0, 'confidence must be >= 0').max(1, 'confidence must be <= 1'),
    status: MappingStatusSchema,
    method: MappingMethodSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.status === 'unanswered' && val.answerId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unanswered mapping must not have an answerId',
        path: ['answerId'],
      });
    }
    if ((val.status === 'matched' || val.status === 'needs_review') && !val.answerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Mapping with status "${val.status}" must include an answerId`,
        path: ['answerId'],
      });
    }
  });

/**
 * Document page metadata
 */
export const DocumentPageMetadataSchema = z.object({
  pageNumber: z.number().int().min(1, 'pageNumber must be >= 1'),
  width: z.number().positive('width must be positive'),
  height: z.number().positive('height must be positive'),
  imageUrl: z.string().optional(),
});

/**
 * Document metadata for question paper and answer sheet
 */
export const DocumentMetadataSchema = z.object({
  id: z.string().min(1, 'Document id must not be empty'),
  filename: z.string().min(1, 'filename must not be empty'),
  mimeType: z.string().min(1, 'mimeType must not be empty'),
  pageCount: z.number().int().min(0, 'pageCount must be >= 0'),
  pages: z.array(DocumentPageMetadataSchema).optional(),
});

/**
 * Top-level Assessment entity
 */
export const AssessmentSchema = z.object({
  id: z.string().min(1, 'Assessment id must not be empty'),
  status: ProcessingStageSchema,
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  questionPaper: DocumentMetadataSchema,
  answerSheet: DocumentMetadataSchema,
  questions: z.array(QuestionSchema),
  answers: z.array(AnswerSchema),
  mappings: z.array(AnswerMappingSchema),
  createdAt: z.string().min(1, 'createdAt must not be empty'),
});
