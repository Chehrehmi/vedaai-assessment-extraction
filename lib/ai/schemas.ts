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

/**
 * Validates raw spatial region extracted by AI provider.
 */
export const RawAnswerRegionSchema = z.object({
  box_2d: z.array(z.number()).length(4).optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  width: z.number().min(0).max(1).optional(),
  height: z.number().min(0).max(1).optional(),
  extractionConfidence: z.number().min(0).max(1).optional(),
});

/**
 * Validates raw answer block extracted from a page.
 */
export const RawAnswerBlockSchema = z
  .object({
    page: z.number().int().min(1, 'Page number must be >= 1'),
    detectedQuestionReference: z.string().nullable().optional(),
    text: z.string().optional(),
    transcription: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    box_2d: z.array(z.number()).length(4).optional(),
    regions: z.array(RawAnswerRegionSchema).optional(),
  })
  .refine((val) => val.box_2d || (val.regions && val.regions.length > 0), {
    message: 'Raw answer block must contain either box_2d or at least one region',
  });

/**
 * Validates array of raw answer blocks.
 */
export const RawAnswerBlockArraySchema = z.array(RawAnswerBlockSchema);

/**
 * Validates a single semantic mapping decision from AI provider.
 */
export const SemanticMappingDecisionSchema = z.object({
  answerId: z.string().min(1, 'answerId must not be empty'),
  questionId: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});

/**
 * Validates structured response of semantic mapping decisions.
 */
export const SemanticMappingResponseSchema = z.object({
  decisions: z.array(SemanticMappingDecisionSchema),
});
