import { Assessment } from '../domain/types';
import { AssessmentSchema } from '../validation/schemas';
import { assessmentStore } from '../store';
import { rasterStore } from '../raster';
import { extractQuestionsForAssessment, extractAnswersForAssessment } from '../extraction';
import { resolveAssessmentMappingsWithSemanticFallback } from '../mapping';
import { evaluateAssessment } from '../grading';
import { DocumentAIProvider } from '../ai';

export interface PipelineOptions {
  provider?: DocumentAIProvider;
  pdfBuffer?: Buffer;
}

/**
 * In-memory in-flight tracker to prevent concurrent duplicate runs on the same assessment.
 */
const inFlightAssessments = new Set<string>();

/**
 * Checks whether an assessment is currently running in the processing pipeline.
 */
export function isAssessmentProcessing(assessmentId: string): boolean {
  return inFlightAssessments.has(assessmentId);
}

/**
 * Clears in-flight tracking state (primarily for test isolation).
 */
export function clearInFlightAssessments(): void {
  inFlightAssessments.clear();
  globalPipelineQueue = Promise.resolve();
}

/**
 * Sanitizes error messages to prevent leaking API keys, secrets, or internal stack traces.
 */
function sanitizeErrorMessage(err: any): string {
  if (!err) return 'An unexpected error occurred during assessment processing';
  let message = typeof err === 'string' ? err : err.message || 'Processing error';

  // Redact potential API keys or authorization tokens
  message = message.replace(/AIza[0-9A-Za-z-_]+/g, '[REDACTED_API_KEY]');
  message = message.replace(/(?:Bearer|key=)\s*[A-Za-z0-9-_.]+/gi, '[REDACTED_TOKEN]');
  message = message.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]');

  return message.slice(0, 300);
}


/**
 * Derives a clean machine-readable error code.
 */
function deriveErrorCode(err: any, currentStage: string): string {
  if (err?.code && typeof err.code === 'string') {
    return err.code;
  }
  switch (currentStage) {
    case 'reading_question_paper':
    case 'extracting_questions':
      return 'QUESTION_EXTRACTION_FAILED';
    case 'reading_answer_sheet':
    case 'detecting_answers':
      return 'ANSWER_EXTRACTION_FAILED';
    case 'mapping_answers':
      return 'MAPPING_FAILED';
    case 'finalizing':
      return 'VALIDATION_FAILED';
    default:
      return 'PROCESSING_FAILED';
  }
}

/**
 * Validates the final processed assessment integrity before marking completed.
 */
function validateFinalAssessment(assessment: Assessment): void {
  if (!assessment) {
    throw new Error('Assessment object is missing');
  }

  if (!Array.isArray(assessment.questions)) {
    throw new Error('Assessment questions array is missing or invalid');
  }

  if (!Array.isArray(assessment.answers)) {
    throw new Error('Assessment answers array is missing or invalid');
  }

  if (!Array.isArray(assessment.mappings)) {
    throw new Error('Assessment mappings array is missing or invalid');
  }

  const questionIdSet = new Set(assessment.questions.map((q) => q.id));
  const answerIdSet = new Set(assessment.answers.map((a) => a.id));
  const mappedQuestionIds = new Set<string>();

  for (const m of assessment.mappings) {
    // 1. Referential integrity: questionId must exist in questions
    if (!questionIdSet.has(m.questionId)) {
      throw new Error(`Mapping contains unknown questionId: ${m.questionId}`);
    }

    // 2. Duplicate check: one mapping per question
    if (mappedQuestionIds.has(m.questionId)) {
      throw new Error(`Duplicate mapping found for questionId: ${m.questionId}`);
    }
    mappedQuestionIds.add(m.questionId);

    // 3. Referential integrity: answerId must exist in answers if present
    if (m.answerId) {
      if (!answerIdSet.has(m.answerId)) {
        throw new Error(`Mapping contains unknown answerId: ${m.answerId}`);
      }
    }

    // 4. Status consistency
    if (m.status === 'unanswered' && m.answerId !== undefined) {
      throw new Error(`Unanswered mapping for question ${m.questionId} has an answerId`);
    }
    if ((m.status === 'matched' || m.status === 'needs_review') && !m.answerId) {
      throw new Error(`Mapping with status "${m.status}" for question ${m.questionId} missing answerId`);
    }
  }

  // 5. All questions must have a mapping record
  for (const q of assessment.questions) {
    if (!mappedQuestionIds.has(q.id)) {
      throw new Error(`Question ${q.id} (label: ${q.number}) has no mapping record`);
    }
  }

  // 6. Enforce domain schema validation
  AssessmentSchema.parse({
    ...assessment,
    status: 'completed',
  });
}

/**
 * End-to-end processing pipeline orchestrator.
 * Connects upload rasterization -> question extraction -> answer extraction -> deterministic mapping -> semantic fallback -> finalization.
 *
 * Lifecycle:
 * queued -> reading_question_paper -> extracting_questions -> reading_answer_sheet -> detecting_answers -> mapping_answers -> finalizing -> completed
 */
let globalPipelineQueue: Promise<any> = Promise.resolve();

/**
 * Internal single-assessment pipeline runner.
 */
async function runPipeline(
  assessmentId: string,
  options?: PipelineOptions
): Promise<Assessment> {
  const initialAssessment = assessmentStore.get(assessmentId);
  if (!initialAssessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  if (initialAssessment.status === 'completed' || initialAssessment.status === 'failed') {
    return initialAssessment;
  }

  let currentStage = initialAssessment.status;

  try {
    // ------------------------------------------------------------------------
    // STAGE 1: reading_question_paper -> extracting_questions
    // ------------------------------------------------------------------------
    currentStage = 'reading_question_paper';
    assessmentStore.update(assessmentId, { status: 'reading_question_paper' });

    const qpPages = rasterStore.getPages(assessmentId, 'question_paper');
    if (!qpPages || qpPages.length === 0) {
      throw new Error('No question paper pages found in raster store');
    }

    currentStage = 'extracting_questions';
    assessmentStore.update(assessmentId, { status: 'extracting_questions' });

    await extractQuestionsForAssessment(assessmentId, {
      pdfBuffer: options?.pdfBuffer,
      provider: options?.provider,
    });

    // ------------------------------------------------------------------------
    // STAGE 2: reading_answer_sheet -> detecting_answers
    // ------------------------------------------------------------------------
    currentStage = 'reading_answer_sheet';
    assessmentStore.update(assessmentId, { status: 'reading_answer_sheet' });

    const asPages = rasterStore.getPages(assessmentId, 'answer_sheet');
    if (!asPages || asPages.length === 0) {
      throw new Error('No answer sheet pages found in raster store');
    }

    currentStage = 'detecting_answers';
    assessmentStore.update(assessmentId, { status: 'detecting_answers' });

    await extractAnswersForAssessment(assessmentId, {
      provider: options?.provider,
    });

    // ------------------------------------------------------------------------
    // STAGE 3: mapping_answers
    // ------------------------------------------------------------------------
    currentStage = 'mapping_answers';
    assessmentStore.update(assessmentId, { status: 'mapping_answers' });

    await resolveAssessmentMappingsWithSemanticFallback(assessmentId, {
      provider: options?.provider,
    });

    // ------------------------------------------------------------------------
    // STAGE 4: finalizing & grading evaluation
    // ------------------------------------------------------------------------
    currentStage = 'finalizing';
    assessmentStore.update(assessmentId, { status: 'finalizing' });

    const assessmentToFinalize = assessmentStore.get(assessmentId);
    if (!assessmentToFinalize) {
      throw new Error(`Assessment ${assessmentId} disappeared during processing`);
    }

    const gradingSummary = evaluateAssessment(assessmentToFinalize);
    const finalizedWithGrading = {
      ...assessmentToFinalize,
      gradingSummary,
    };

    validateFinalAssessment(finalizedWithGrading);

    // ------------------------------------------------------------------------
    // STAGE 5: completed
    // ------------------------------------------------------------------------
    const completedAssessment = assessmentStore.update(assessmentId, {
      status: 'completed',
      gradingSummary,
    });

    return completedAssessment;
  } catch (err: any) {
    const errorCode = deriveErrorCode(err, currentStage);
    const errorMessage = sanitizeErrorMessage(err);

    // Update assessment to status "failed" if it exists in store
    if (assessmentStore.get(assessmentId)) {
      return assessmentStore.update(assessmentId, {
        status: 'failed',
        errorCode,
        errorMessage,
      });
    }

    throw err;
  } finally {
    inFlightAssessments.delete(assessmentId);
  }
}

/**
 * End-to-end processing pipeline orchestrator.
 * Connects upload rasterization -> question extraction -> answer extraction -> deterministic mapping -> semantic fallback -> finalization.
 * Serializes heavy document processing queues in-memory to preserve 512MB RAM constraints on single-container hosting.
 *
 * Lifecycle:
 * queued -> reading_question_paper -> extracting_questions -> reading_answer_sheet -> detecting_answers -> mapping_answers -> finalizing -> completed
 */
export async function processAssessment(
  assessmentId: string,
  options?: PipelineOptions
): Promise<Assessment> {
  // 1. Duplicate check: if already in-flight for this assessment, return existing snapshot
  if (inFlightAssessments.has(assessmentId)) {
    const existing = assessmentStore.get(assessmentId);
    if (existing) {
      return existing;
    }
  }

  // 2. Fetch and validate assessment existence
  const initialAssessment = assessmentStore.get(assessmentId);
  if (!initialAssessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  // 3. Idempotency check: if already completed or failed, do not rerun
  if (initialAssessment.status === 'completed' || initialAssessment.status === 'failed') {
    return initialAssessment;
  }

  inFlightAssessments.add(assessmentId);

  // Enqueue execution behind active global lock so multiple simultaneous jobs run sequentially without overlapping peak memory
  const currentExecution = globalPipelineQueue.then(
    () => runPipeline(assessmentId, options),
    () => runPipeline(assessmentId, options)
  );

  globalPipelineQueue = currentExecution.catch(() => {});
  return currentExecution;
}
