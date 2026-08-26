import { AnswerMapping } from '../domain/types';
import { assessmentStore } from '../store';
import { DocumentAIProvider } from '../ai';
import { mapAnswersDeterministically, DeterministicMappingResult } from './deterministic-mapper';
import {
  resolveMappingsWithSemanticFallback,
  SemanticMappingOptions,
} from './semantic-mapper';

export * from './deterministic-mapper';
export * from './semantic-mapper';

/**
 * Deterministically maps extracted answers to questions for an assessment and updates the store.
 */
export function mapAssessmentAnswersDeterministically(
  assessmentId: string
): AnswerMapping[] {
  const assessment = assessmentStore.get(assessmentId);
  if (!assessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  const result = mapAnswersDeterministically(
    assessment.questions || [],
    assessment.answers || []
  );

  assessmentStore.update(assessmentId, {
    mappings: result.mappings,
  });

  return result.mappings;
}

/**
 * Resolves assessment mappings using deterministic rules and applies semantic AI fallback for unresolved cases.
 */
export async function resolveAssessmentMappingsWithSemanticFallback(
  assessmentId: string,
  options?: SemanticMappingOptions
): Promise<AnswerMapping[]> {
  const assessment = assessmentStore.get(assessmentId);
  if (!assessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  const mappings = await resolveMappingsWithSemanticFallback(
    assessment.questions || [],
    assessment.answers || [],
    options
  );

  assessmentStore.update(assessmentId, {
    mappings,
  });

  return mappings;
}
