import { Question, Answer, AnswerMapping } from '../domain/types';
import { AnswerMappingSchema } from '../validation/schemas';
import { sortQuestionsByOrder } from '../domain';

export interface DeterministicMappingResult {
  mappings: AnswerMapping[];
  unmatchedAnswerIds: string[];
}

/**
 * Normalizes question labels and student answer references to a canonical form for matching.
 * Examples:
 *   "Q1", "q1", "Q 1", "1", "01" -> "1"
 *   "Q11(a)", "11(a)", "11 (a)", "11. (a)", "11(a).", "11.a", "11-a", "11(A)", "21A", "21-A" -> "11(a)" / "21(a)"
 *   "36(I)", "36 (i)", "36(III A)" -> "36(i)", "36(iii a)"
 */
export function normalizeLabelForMapping(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Strip leading prefixes like "Q.", "Q", "Question", "Ans.", "Ans", "Answer", "No.", "No", "Problem"
  let clean = trimmed.replace(/^(?:q(?:uestion)?|ans(?:wer)?|no|problem)\.?\s*[:\-]?\s*/i, '').trim();
  if (!clean) return null;

  // 2. Remove trailing punctuation
  clean = clean.replace(/[.:;,\-_]+$/, '').trim();

  // 3. Match compound alphanumeric / subquestions:
  // e.g. "11(a)", "11 (a)", "11. (a)", "11(a).", "11.a", "11-a", "11 a", "11(A)", "21A", "21-A", "21 B"
  const compoundMatch = clean.match(/^(\d+)\s*[.:\-_]?\s*\(?([a-zA-Z]|[ivxlcdm]+(?:\s+[a-zA-Z])?)\)?$/i);
  if (compoundMatch) {
    const parent = compoundMatch[1];
    const subRaw = compoundMatch[2].trim().toLowerCase();
    return `${parent}(${subRaw})`;
  }

  // 4. Standalone top-level number: "1", "01" -> "1"
  const numMatch = clean.match(/^0*(\d+)$/);
  if (numMatch) {
    return numMatch[1];
  }

  // 5. Standalone subpart only: "(a)", "a", "(i)"
  const subOnlyMatch = clean.match(/^\(?([a-zA-Z]|[ivxlcdm]+(?:\s+[a-zA-Z])?)\)?$/i);
  if (subOnlyMatch && !/^\d+$/.test(clean)) {
    return `(${subOnlyMatch[1].toLowerCase()})`;
  }

  // 6. Generic fallback: lowercase and collapse whitespace
  return clean.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Pure deterministic answer-mapping engine.
 * Implements Tier 1 (Explicit Question References) and Tier 2 (Conservative Structural Alignment).
 * Does NOT perform semantic matching or invoke AI providers.
 */
export function mapAnswersDeterministically(
  questions: Question[],
  answers: Answer[]
): DeterministicMappingResult {
  if (!questions || questions.length === 0) {
    return {
      mappings: [],
      unmatchedAnswerIds: (answers || []).map((a) => a.id),
    };
  }

  const sortedQuestions = sortQuestionsByOrder(questions);
  const mappings: AnswerMapping[] = [];
  const usedAnswerIds = new Set<string>();
  const resolvedQuestionIds = new Set<string>();

  // Map to store question index in sorted order for fast lookup
  const questionIndexMap = new Map(sortedQuestions.map((q, idx) => [q.id, idx]));

  // Index questions by normalized label
  const questionsByNorm = new Map<string, Question[]>();
  for (const q of sortedQuestions) {
    const norm = normalizeLabelForMapping(q.number);
    if (!norm) continue;
    if (!questionsByNorm.has(norm)) {
      questionsByNorm.set(norm, []);
    }
    questionsByNorm.get(norm)!.push(q);
  }

  // --------------------------------------------------------------------------
  // TIER 1: Explicit Reference Resolution
  // --------------------------------------------------------------------------
  // Group answers by normalized detectedQuestionReference
  const answersByNormRef = new Map<string, Answer[]>();
  for (const a of answers) {
    const normRef = normalizeLabelForMapping(a.detectedQuestionReference);
    if (!normRef) continue;
    if (!answersByNormRef.has(normRef)) {
      answersByNormRef.set(normRef, []);
    }
    answersByNormRef.get(normRef)!.push(a);
  }

  for (const [normRef, candidateAnswers] of answersByNormRef.entries()) {
    const matchingQuestions = questionsByNorm.get(normRef);
    if (!matchingQuestions || matchingQuestions.length === 0) {
      // Answer references a label not found in questions (e.g. Q99) -> stays unmatched
      continue;
    }

    if (matchingQuestions.length === 1 && candidateAnswers.length === 1) {
      // Unambiguous 1-to-1 explicit match
      const q = matchingQuestions[0];
      const a = candidateAnswers[0];
      mappings.push(
        AnswerMappingSchema.parse({
          questionId: q.id,
          answerId: a.id,
          confidence: 0.95,
          status: 'matched',
          method: 'explicit_reference',
        })
      );
      usedAnswerIds.add(a.id);
      resolvedQuestionIds.add(q.id);
    } else if (matchingQuestions.length > 1) {
      // Duplicate question records with the exact same label in question paper
      for (const q of matchingQuestions) {
        mappings.push(
          AnswerMappingSchema.parse({
            questionId: q.id,
            answerId: candidateAnswers[0].id,
            confidence: 0.5,
            status: 'needs_review',
            method: 'explicit_reference',
          })
        );
        resolvedQuestionIds.add(q.id);
      }
      for (const a of candidateAnswers) {
        usedAnswerIds.add(a.id);
      }
    } else if (candidateAnswers.length > 1) {
      // Multiple answers claim the same question reference (e.g. two Q3 answers)
      const q = matchingQuestions[0];
      mappings.push(
        AnswerMappingSchema.parse({
          questionId: q.id,
          answerId: candidateAnswers[0].id,
          confidence: 0.5,
          status: 'needs_review',
          method: 'explicit_reference',
        })
      );
      resolvedQuestionIds.add(q.id);
      for (const a of candidateAnswers) {
        usedAnswerIds.add(a.id);
      }
    }
  }

  // --------------------------------------------------------------------------
  // TIER 2: Conservative Structural Sequential Mapping
  // --------------------------------------------------------------------------
  // Anchors are cleanly matched 1-to-1 explicit reference pairs in order of appearance
  interface Anchor {
    qIdx: number;
    aIdx: number;
  }

  const anchors: Anchor[] = [];
  for (let aIdx = 0; aIdx < answers.length; aIdx++) {
    const a = answers[aIdx];
    const mapping = mappings.find((m) => m.answerId === a.id && m.status === 'matched');
    if (mapping) {
      const qIdx = questionIndexMap.get(mapping.questionId);
      if (qIdx !== undefined) {
        anchors.push({ qIdx, aIdx });
      }
    }
  }

  // Sort anchors by question index
  anchors.sort((a, b) => a.qIdx - b.qIdx);

  // Helper to map intervals between anchors
  const mapInterval = (
    startQIdx: number,
    endQIdx: number,
    startAIdx: number,
    endAIdx: number
  ) => {
    const k = endQIdx - startQIdx + 1; // number of unresolved questions in interval
    const m = endAIdx - startAIdx + 1; // number of unassigned answers in interval

    if (k <= 0 || m <= 0) return;

    if (k === 1 && m === 1) {
      // CASE A: Exactly 1 unresolved question and 1 unassigned answer -> strong 1:1 structural match
      const q = sortedQuestions[startQIdx];
      const a = answers[startAIdx];
      if (!resolvedQuestionIds.has(q.id) && !usedAnswerIds.has(a.id)) {
        mappings.push(
          AnswerMappingSchema.parse({
            questionId: q.id,
            answerId: a.id,
            confidence: 0.8,
            status: 'matched',
            method: 'structural',
          })
        );
        usedAnswerIds.add(a.id);
        resolvedQuestionIds.add(q.id);
      }
    } else if (k > 1 && m === k) {
      // CASE B: Multiple questions, equal count of answers -> conservative needs_review
      for (let offset = 0; offset < k; offset++) {
        const q = sortedQuestions[startQIdx + offset];
        const a = answers[startAIdx + offset];
        if (!resolvedQuestionIds.has(q.id) && !usedAnswerIds.has(a.id)) {
          mappings.push(
            AnswerMappingSchema.parse({
              questionId: q.id,
              answerId: a.id,
              confidence: 0.5,
              status: 'needs_review',
              method: 'structural',
            })
          );
          usedAnswerIds.add(a.id);
          resolvedQuestionIds.add(q.id);
        }
      }
    } else if (k > m) {
      // CASE C: More questions than answers (e.g. 2 questions Q2, Q3 and 1 answer A?)
      // All questions in interval receive candidate as needs_review without false certainty
      for (let offset = 0; offset < k; offset++) {
        const q = sortedQuestions[startQIdx + offset];
        const candidateAnswer = answers[startAIdx + Math.min(offset, m - 1)];
        if (!resolvedQuestionIds.has(q.id)) {
          mappings.push(
            AnswerMappingSchema.parse({
              questionId: q.id,
              answerId: candidateAnswer.id,
              confidence: 0.5,
              status: 'needs_review',
              method: 'structural',
            })
          );
          resolvedQuestionIds.add(q.id);
        }
      }
      for (let aOffset = 0; aOffset < m; aOffset++) {
        usedAnswerIds.add(answers[startAIdx + aOffset].id);
      }
    } else if (m > k) {
      // CASE D: More answers than questions (e.g. 1 question Q2 and 2 answers A?1, A?2)
      // Map candidate answer to question as needs_review; remaining answers stay in unmatchedAnswerIds
      for (let offset = 0; offset < k; offset++) {
        const q = sortedQuestions[startQIdx + offset];
        const candidateAnswer = answers[startAIdx + offset];
        if (!resolvedQuestionIds.has(q.id)) {
          mappings.push(
            AnswerMappingSchema.parse({
              questionId: q.id,
              answerId: candidateAnswer.id,
              confidence: 0.5,
              status: 'needs_review',
              method: 'structural',
            })
          );
          resolvedQuestionIds.add(q.id);
          usedAnswerIds.add(candidateAnswer.id);
        }
      }
      for (let aOffset = 0; aOffset < m; aOffset++) {
        usedAnswerIds.add(answers[startAIdx + aOffset].id);
      }
    }
  };

  if (anchors.length > 0) {
    // 1. Prefix interval (before first anchor)
    if (anchors[0].qIdx > 0 && anchors[0].aIdx > 0) {
      mapInterval(0, anchors[0].qIdx - 1, 0, anchors[0].aIdx - 1);
    }

    // 2. Middle intervals (between consecutive anchors)
    for (let i = 0; i < anchors.length - 1; i++) {
      const a1 = anchors[i];
      const a2 = anchors[i + 1];
      if (a2.qIdx > a1.qIdx + 1 && a2.aIdx > a1.aIdx + 1) {
        mapInterval(a1.qIdx + 1, a2.qIdx - 1, a1.aIdx + 1, a2.aIdx - 1);
      }
    }

    // 3. Suffix interval (after last anchor)
    const lastAnchor = anchors[anchors.length - 1];
    if (lastAnchor.qIdx < sortedQuestions.length - 1 && lastAnchor.aIdx < answers.length - 1) {
      mapInterval(
        lastAnchor.qIdx + 1,
        sortedQuestions.length - 1,
        lastAnchor.aIdx + 1,
        answers.length - 1
      );
    }
  } else if (answers.length > 0) {
    // No explicit anchors at all
    if (sortedQuestions.length === 1 && answers.length === 1) {
      // Exactly 1 question and 1 answer in single-question assessment
      const q = sortedQuestions[0];
      const a = answers[0];
      if (!resolvedQuestionIds.has(q.id) && !usedAnswerIds.has(a.id)) {
        mappings.push(
          AnswerMappingSchema.parse({
            questionId: q.id,
            answerId: a.id,
            confidence: 0.8,
            status: 'matched',
            method: 'structural',
          })
        );
        usedAnswerIds.add(a.id);
        resolvedQuestionIds.add(q.id);
      }
    } else if (sortedQuestions.length === answers.length && sortedQuestions.length > 1) {
      // CASE E: Equal counts of unreferenced questions and answers -> needs_review (NEVER "matched")
      for (let idx = 0; idx < sortedQuestions.length; idx++) {
        const q = sortedQuestions[idx];
        const a = answers[idx];
        if (!resolvedQuestionIds.has(q.id) && !usedAnswerIds.has(a.id)) {
          mappings.push(
            AnswerMappingSchema.parse({
              questionId: q.id,
              answerId: a.id,
              confidence: 0.5,
              status: 'needs_review',
              method: 'structural',
            })
          );
          usedAnswerIds.add(a.id);
          resolvedQuestionIds.add(q.id);
        }
      }
    } else if (sortedQuestions.length !== answers.length && sortedQuestions.length > 0 && answers.length > 0) {
      // CASE F: Unequal counts with no anchors -> expose sequential candidates as needs_review
      const minCount = Math.min(sortedQuestions.length, answers.length);
      for (let idx = 0; idx < minCount; idx++) {
        const q = sortedQuestions[idx];
        const a = answers[idx];
        if (!resolvedQuestionIds.has(q.id) && !usedAnswerIds.has(a.id)) {
          mappings.push(
            AnswerMappingSchema.parse({
              questionId: q.id,
              answerId: a.id,
              confidence: 0.5,
              status: 'needs_review',
              method: 'structural',
            })
          );
          usedAnswerIds.add(a.id);
          resolvedQuestionIds.add(q.id);
        }
      }
      for (const a of answers) {
        usedAnswerIds.add(a.id);
      }
    }
  }

  // --------------------------------------------------------------------------
  // TIER 4: Unanswered Questions Resolution
  // --------------------------------------------------------------------------
  for (const q of sortedQuestions) {
    if (!resolvedQuestionIds.has(q.id)) {
      mappings.push(
        AnswerMappingSchema.parse({
          questionId: q.id,
          confidence: 0,
          status: 'unanswered',
        })
      );
      resolvedQuestionIds.add(q.id);
    }
  }

  // --------------------------------------------------------------------------
  // Unmatched Answers Calculation
  // --------------------------------------------------------------------------
  const mappedAnswerIds = new Set(
    mappings
      .map((m) => m.answerId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );
  const unmatchedAnswerIds = answers
    .filter((a) => !mappedAnswerIds.has(a.id))
    .map((a) => a.id);

  // Sort mappings by original question sequence
  mappings.sort((a, b) => {
    const idxA = questionIndexMap.get(a.questionId) ?? 0;
    const idxB = questionIndexMap.get(b.questionId) ?? 0;
    return idxA - idxB;
  });

  return {
    mappings,
    unmatchedAnswerIds,
  };
}
