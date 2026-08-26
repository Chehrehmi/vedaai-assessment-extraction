import { Question, Answer, AnswerMapping } from '../domain/types';
import { AnswerMappingSchema } from '../validation/schemas';
import { sortQuestionsByOrder } from '../domain';
import {
  DocumentAIProvider,
  GeminiDocumentAIProvider,
  SemanticQuestionCandidate,
  SemanticAnswerCandidate,
  SemanticMappingDecision,
} from '../ai';
import { mapAnswersDeterministically, DeterministicMappingResult } from './deterministic-mapper';

export interface SemanticMappingOptions {
  provider?: DocumentAIProvider;
}

/**
 * Resolves question-to-answer mappings using deterministic rules (Tier 1 & Tier 2)
 * and falls back to semantic AI analysis (Tier 3) ONLY for unresolved candidates.
 *
 * Invariants:
 * 1. Deterministic matches are immutable and cannot be overridden by semantic AI.
 * 2. Semantic AI only receives bounded candidate sets and cannot invent IDs.
 * 3. Confidence >= 0.85 with no conflict becomes status: 'matched', method: 'semantic'.
 * 4. Confidence < 0.85 or competing decisions become status: 'needs_review', method: 'semantic'.
 * 5. If semantic resolution fails or returns null, deterministic results degrade gracefully.
 */
export async function resolveMappingsWithSemanticFallback(
  questions: Question[],
  answers: Answer[],
  options?: SemanticMappingOptions
): Promise<AnswerMapping[]> {
  if (!questions || questions.length === 0) {
    return [];
  }

  // 1. Run deterministic mapping foundation (Tier 1 & Tier 2)
  const deterministicResult: DeterministicMappingResult = mapAnswersDeterministically(
    questions,
    answers
  );

  const sortedQuestions = sortQuestionsByOrder(questions);
  const finalMappingsMap = new Map<string, AnswerMapping>();
  const usedAnswerIds = new Set<string>();

  // 2. Lock in immutable confident deterministic matches (explicit_reference or strong structural)
  for (const m of deterministicResult.mappings) {
    if (m.status === 'matched') {
      finalMappingsMap.set(m.questionId, m);
      if (m.answerId) {
        usedAnswerIds.add(m.answerId);
      }
    }
  }

  // 3. Identify unresolved questions (needs_review or unanswered in deterministic pass)
  const unresolvedQuestions = sortedQuestions.filter((q) => !finalMappingsMap.has(q.id));

  // 4. Identify candidate answers that are not yet locked into confident matches
  const candidateAnswers = answers.filter((a) => !usedAnswerIds.has(a.id));

  // 5. If no unresolved questions or no candidate answers, return deterministic mappings directly
  if (unresolvedQuestions.length === 0 || candidateAnswers.length === 0) {
    return deterministicResult.mappings;
  }

  // 6. Invoke AI Provider for semantic resolution of bounded candidates
  const provider = options?.provider || new GeminiDocumentAIProvider();
  if (!provider.resolveSemanticMappings) {
    return deterministicResult.mappings;
  }

  const questionCandidates: SemanticQuestionCandidate[] = unresolvedQuestions.map((q) => ({
    id: q.id,
    number: q.number,
    text: q.text,
    parentNumber: q.parentNumber,
    subPart: q.subPart,
    alternativeText: q.alternativeText,
  }));

  const answerCandidates: SemanticAnswerCandidate[] = candidateAnswers.map((a) => ({
    id: a.id,
    detectedQuestionReference: a.detectedQuestionReference,
    rawText: a.rawText,
    pages: a.pages,
  }));

  let semanticDecisions: SemanticMappingDecision[] = [];
  try {
    semanticDecisions = await provider.resolveSemanticMappings(
      questionCandidates,
      answerCandidates
    );
  } catch (err) {
    // Graceful degradation: AI failure preserves deterministic mappings intact
    return deterministicResult.mappings;
  }

  if (!semanticDecisions || semanticDecisions.length === 0) {
    return deterministicResult.mappings;
  }

  // 7. Candidate Bounding Verification: Discard any decision with non-candidate IDs
  const allowedQuestionIds = new Set(unresolvedQuestions.map((q) => q.id));
  const allowedAnswerIds = new Set(candidateAnswers.map((a) => a.id));

  const validDecisions: SemanticMappingDecision[] = [];
  for (const d of semanticDecisions) {
    // Must refer to a valid candidate answer
    if (!allowedAnswerIds.has(d.answerId)) {
      continue;
    }
    // If questionId is provided, it must refer to a valid unresolved question
    if (d.questionId !== null && !allowedQuestionIds.has(d.questionId)) {
      continue;
    }
    validDecisions.push(d);
  }

  // 8. Analyze conflict and assignment counts
  const decisionsByQuestion = new Map<string, SemanticMappingDecision[]>();
  const decisionsByAnswer = new Map<string, SemanticMappingDecision[]>();

  for (const d of validDecisions) {
    if (d.questionId !== null) {
      if (!decisionsByQuestion.has(d.questionId)) {
        decisionsByQuestion.set(d.questionId, []);
      }
      decisionsByQuestion.get(d.questionId)!.push(d);

      if (!decisionsByAnswer.has(d.answerId)) {
        decisionsByAnswer.set(d.answerId, []);
      }
      decisionsByAnswer.get(d.answerId)!.push(d);
    }
  }

  // 9. Merge semantic decisions for unresolved questions
  for (const q of unresolvedQuestions) {
    const qDecisions = decisionsByQuestion.get(q.id) || [];

    if (qDecisions.length === 1) {
      const decision = qDecisions[0];
      const answerConflict = (decisionsByAnswer.get(decision.answerId)?.length || 0) > 1;

      if (decision.confidence >= 0.85 && !answerConflict) {
        // High confidence, unambiguous semantic match
        finalMappingsMap.set(
          q.id,
          AnswerMappingSchema.parse({
            questionId: q.id,
            answerId: decision.answerId,
            confidence: Number(decision.confidence.toFixed(2)),
            status: 'matched',
            method: 'semantic',
          })
        );
        usedAnswerIds.add(decision.answerId);
      } else {
        // Moderate confidence or conflicting candidate -> needs_review
        finalMappingsMap.set(
          q.id,
          AnswerMappingSchema.parse({
            questionId: q.id,
            answerId: decision.answerId,
            confidence: Number(decision.confidence.toFixed(2)),
            status: 'needs_review',
            method: 'semantic',
          })
        );
        usedAnswerIds.add(decision.answerId);
      }
    } else if (qDecisions.length > 1) {
      // Multiple answers mapped to this single question -> ambiguity needs_review
      const bestDecision = qDecisions.reduce((prev, curr) =>
        curr.confidence > prev.confidence ? curr : prev
      );
      finalMappingsMap.set(
        q.id,
        AnswerMappingSchema.parse({
          questionId: q.id,
          answerId: bestDecision.answerId,
          confidence: 0.5,
          status: 'needs_review',
          method: 'semantic',
        })
      );
      for (const d of qDecisions) {
        usedAnswerIds.add(d.answerId);
      }
    } else {
      // AI evaluated candidates and produced no match for question q -> mark unanswered
      finalMappingsMap.set(
        q.id,
        AnswerMappingSchema.parse({
          questionId: q.id,
          confidence: 0,
          status: 'unanswered',
        })
      );
    }
  }

  // 10. Assemble and sort mappings in original question order
  const questionOrderMap = new Map(sortedQuestions.map((q, idx) => [q.id, idx]));
  const finalMappings = Array.from(finalMappingsMap.values());
  finalMappings.sort((a, b) => (questionOrderMap.get(a.questionId) ?? 0) - (questionOrderMap.get(b.questionId) ?? 0));

  return finalMappings;
}
