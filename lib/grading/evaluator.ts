import {
  Assessment,
  Question,
  Answer,
  AnswerMapping,
  QuestionEvaluation,
  AssessmentGradingSummary,
} from '../domain/types';
import { AssessmentGradingSummarySchema } from '../validation/schemas';

export interface EvaluateAssessmentOptions {
  defaultMarksPerQuestion?: number;
}

/**
 * Pure deterministic assessment grading and feedback evaluator.
 * - Truthfully computes question scores & pedagogical feedback from mapping status and answer presence.
 * - Unanswered questions: awarded 0 marks with "Question was not attempted."
 * - Mapped answers without ground-truth teacher rubric: assigned 'needs_review' with '— / maxMarks'
 *   and clear location feedback, ensuring no hallucinated or fabricated scores.
 * - Needs-review mappings: flagged as 'needs_review' for teacher verification.
 */
export function evaluateAssessment(
  assessment: {
    questions: Question[];
    answers: Answer[];
    mappings: AnswerMapping[];
  },
  options: EvaluateAssessmentOptions = {}
): AssessmentGradingSummary {
  const defaultMarks = options.defaultMarksPerQuestion ?? 1;
  const evaluations: QuestionEvaluation[] = [];

  let answeredCount = 0;
  let unansweredCount = 0;
  let needsReviewCount = 0;
  let evaluatedCount = 0;
  let totalMaxMarks = 0;
  let totalAwardedMarks: number | null = null;
  let hasUnevaluatedAnswers = false;

  const answerMap = new Map<string, Answer>();
  for (const ans of assessment.answers) {
    answerMap.set(ans.id, ans);
  }

  const mappingMap = new Map<string, AnswerMapping>();
  for (const m of assessment.mappings) {
    mappingMap.set(m.questionId, m);
  }

  for (const q of assessment.questions) {
    const maxMarks = q.maxMarks ?? defaultMarks;
    totalMaxMarks += maxMarks;

    const mapping = mappingMap.get(q.id);
    const mappingStatus = mapping?.status ?? 'unanswered';

    if (mappingStatus === 'unanswered' || !mapping?.answerId) {
      unansweredCount++;
      evaluations.push({
        questionId: q.id,
        status: 'unanswered',
        maxMarks,
        awardedMarks: 0,
        feedback: 'Question was not attempted.',
      });
    } else if (mappingStatus === 'matched') {
      answeredCount++;
      needsReviewCount++;
      hasUnevaluatedAnswers = true;

      const answer = answerMap.get(mapping.answerId);
      const pageStr = answer?.pages?.length ? `Page(s) ${answer.pages.join(', ')}` : 'Answer Sheet';
      const refStr = answer?.detectedQuestionReference ? ` (Ref: "${answer.detectedQuestionReference}")` : '';

      evaluations.push({
        questionId: q.id,
        status: 'needs_review',
        maxMarks,
        awardedMarks: null,
        feedback: `Student response identified on ${pageStr}${refStr}. Awaiting teacher scoring.`,
      });
    } else {
      // needs_review or ambiguous mapping
      needsReviewCount++;
      hasUnevaluatedAnswers = true;
      evaluations.push({
        questionId: q.id,
        status: 'needs_review',
        maxMarks,
        awardedMarks: null,
        feedback: 'Mapping requires teacher verification before evaluation.',
      });
    }
  }

  // If all questions were unattempted, totalAwardedMarks is 0; otherwise null (pending review)
  if (!hasUnevaluatedAnswers && unansweredCount === assessment.questions.length) {
    totalAwardedMarks = 0;
  }

  const summary: AssessmentGradingSummary = {
    totalQuestions: assessment.questions.length,
    answeredCount,
    unansweredCount,
    needsReviewCount,
    evaluatedCount,
    totalMaxMarks,
    totalAwardedMarks,
    evaluations,
  };

  return AssessmentGradingSummarySchema.parse(summary);
}
