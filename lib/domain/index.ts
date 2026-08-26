export * from './types';

import { Question, Answer, AnswerMapping, AnswerRegion } from './types';

/**
 * Pure helper: Deterministically sorts questions by printed order.
 */
export function sortQuestionsByOrder(questions: Question[]): Question[] {
  return [...questions].sort((a, b) => a.order - b.order);
}

/**
 * Pure helper: Checks if an answer spans more than one page.
 */
export function isMultiPageAnswer(answer: Answer): boolean {
  return answer.pages.length > 1;
}

/**
 * Pure helper: Filters regions belonging to a specific page.
 */
export function getAnswerRegionsForPage(answer: Answer, pageNumber: number): AnswerRegion[] {
  return answer.regions.filter((r) => r.page === pageNumber);
}

/**
 * Pure helper: Derives unmatched answers (answers not associated with any question mapping).
 */
export function getUnmatchedAnswers(answers: Answer[], mappings: AnswerMapping[]): Answer[] {
  const mappedAnswerIds = new Set(
    mappings
      .map((m) => m.answerId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );
  return answers.filter((a) => !mappedAnswerIds.has(a.id));
}
