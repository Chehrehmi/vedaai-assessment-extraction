import { z } from 'zod';
import {
  ProcessingStageSchema,
  AnswerRegionSchema,
  AnswerSchema,
  QuestionSchema,
  MappingStatusSchema,
  MappingMethodSchema,
  AnswerMappingSchema,
  DocumentPageMetadataSchema,
  DocumentMetadataSchema,
  AssessmentSchema,
} from '../validation/schemas';

export type ProcessingStage = z.infer<typeof ProcessingStageSchema>;
export type AnswerRegion = z.infer<typeof AnswerRegionSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type MappingStatus = z.infer<typeof MappingStatusSchema>;
export type MappingMethod = z.infer<typeof MappingMethodSchema>;
export type AnswerMapping = z.infer<typeof AnswerMappingSchema>;
export type DocumentPageMetadata = z.infer<typeof DocumentPageMetadataSchema>;
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;
