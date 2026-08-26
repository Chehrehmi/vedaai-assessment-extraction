import { AnswerMapping } from '../domain/types';
import { assessmentStore } from '../store';
import { mapAnswersDeterministically, DeterministicMappingResult } from './deterministic-mapper';

export * from './deterministic-mapper';

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
