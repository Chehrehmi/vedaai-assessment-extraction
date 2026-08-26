import { z } from 'zod';

/**
 * Validates individual question extracted by AI provider.
 */
export const RawQuestionExtractionSchema = z.object({
  number: z.string().min(1, 'Question number must not be empty'),
  text: z.string().min(1, 'Question text must not be empty'),
  parentNumber: z.string().optional(),
  subPart: z.string().optional(),
  alternativeText: z.string().optional(),
  alternativeType: z.literal('visually_impaired').optional(),
});

/**
 * Validates array of questions extracted by AI provider.
 */
export const RawQuestionExtractionArraySchema = z.array(RawQuestionExtractionSchema);
