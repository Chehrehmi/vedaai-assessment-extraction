import { z } from 'zod';

export const RawGeminiAnswerBlockSchema = z.object({
  detectedQuestionReference: z.string().nullable().optional(),
  box_2d: z.array(z.number()).length(4), // [ymin, xmin, ymax, xmax] in 0..1000
  text: z.string(),
  confidence: z.number().min(0).max(1),
});

export const RawGeminiResponseSchema = z.array(RawGeminiAnswerBlockSchema);

export type RawGeminiAnswerBlock = z.infer<typeof RawGeminiAnswerBlockSchema>;
export type RawGeminiResponse = z.infer<typeof RawGeminiResponseSchema>;

export const NormalizedBoundingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

export const NormalizedAnswerBlockSchema = z.object({
  pageNumber: z.number().int().positive(),
  detectedQuestionReference: z.string().nullable().optional(),
  boundingBox: NormalizedBoundingBoxSchema,
  text: z.string(),
  confidence: z.number().min(0).max(1),
  originalBox2d: z.array(z.number()).length(4).optional(),
});

export const NormalizedPageExtractionSchema = z.object({
  pageNumber: z.number().int().positive(),
  pageWidth: z.number().positive(),
  pageHeight: z.number().positive(),
  blocks: z.array(NormalizedAnswerBlockSchema),
});

export type NormalizedBoundingBox = z.infer<typeof NormalizedBoundingBoxSchema>;
export type NormalizedAnswerBlock = z.infer<typeof NormalizedAnswerBlockSchema>;
export type NormalizedPageExtraction = z.infer<typeof NormalizedPageExtractionSchema>;
