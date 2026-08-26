import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Question, Answer, AnswerMapping } from '../lib/domain/types';
import { AnswerMappingSchema } from '../lib/validation/schemas';
import { getUnmatchedAnswers } from '../lib/domain';
import {
  mapAnswersDeterministically,
  normalizeLabelForMapping,
  mapAssessmentAnswersDeterministically,
} from '../lib/mapping';
import { assessmentStore } from '../lib/store';

function createMockQuestion(overrides: Partial<Question>): Question {
  return {
    id: overrides.id || `q-${Math.random().toString(36).substring(2, 9)}`,
    number: overrides.number || '1',
    text: overrides.text || 'Sample Question Text',
    order: overrides.order ?? 0,
    parentNumber: overrides.parentNumber,
    subPart: overrides.subPart,
    alternativeText: overrides.alternativeText,
    alternativeType: overrides.alternativeType,
  };
}

function createMockAnswer(overrides: Partial<Answer>): Answer {
  return {
    id: overrides.id || `ans-${Math.random().toString(36).substring(2, 9)}`,
    rawText: overrides.rawText || 'Sample Answer Text',
    pages: overrides.pages || [1],
    regions: overrides.regions || [
      {
        page: 1,
        x: 0.1,
        y: 0.2,
        width: 0.8,
        height: 0.6,
        extractionConfidence: 0.9,
      },
    ],
    detectedQuestionReference: overrides.detectedQuestionReference,
  };
}

describe('Phase 3C-A: Deterministic Answer Mapping Engine', () => {
  beforeEach(() => {
    assessmentStore.clear();
  });

  // --------------------------------------------------------------------------
  // 1. Label Normalization Unit Tests
  // --------------------------------------------------------------------------
  describe('normalizeLabelForMapping', () => {
    it('normalizes standard number prefixes: Q1, q1, Q 1, 1, 01 to "1"', () => {
      assert.equal(normalizeLabelForMapping('Q1'), '1');
      assert.equal(normalizeLabelForMapping('q1'), '1');
      assert.equal(normalizeLabelForMapping('Q 1'), '1');
      assert.equal(normalizeLabelForMapping('Q. 1'), '1');
      assert.equal(normalizeLabelForMapping('Question 1'), '1');
      assert.equal(normalizeLabelForMapping('Ans 1'), '1');
      assert.equal(normalizeLabelForMapping('Answer 1'), '1');
      assert.equal(normalizeLabelForMapping('1'), '1');
      assert.equal(normalizeLabelForMapping('01'), '1');
      assert.equal(normalizeLabelForMapping('1.'), '1');
    });

    it('normalizes subquestion formatting variants to canonical "11(a)"', () => {
      assert.equal(normalizeLabelForMapping('11(a)'), '11(a)');
      assert.equal(normalizeLabelForMapping('Q11(a)'), '11(a)');
      assert.equal(normalizeLabelForMapping('11 (a)'), '11(a)');
      assert.equal(normalizeLabelForMapping('11. (a)'), '11(a)');
      assert.equal(normalizeLabelForMapping('11(a).'), '11(a)');
      assert.equal(normalizeLabelForMapping('11.a'), '11(a)');
      assert.equal(normalizeLabelForMapping('11-a'), '11(a)');
      assert.equal(normalizeLabelForMapping('11 a'), '11(a)');
      assert.equal(normalizeLabelForMapping('11(A)'), '11(a)');
    });

    it('normalizes alphanumeric compound labels like 21A, 21-A to canonical "21(a)"', () => {
      assert.equal(normalizeLabelForMapping('21A'), '21(a)');
      assert.equal(normalizeLabelForMapping('21-A'), '21(a)');
      assert.equal(normalizeLabelForMapping('21(a)'), '21(a)');
      assert.equal(normalizeLabelForMapping('21B'), '21(b)');
      assert.notEqual(normalizeLabelForMapping('21A'), normalizeLabelForMapping('21B'));
    });

    it('preserves distinction between different logical questions: 1 vs 11, 11(a) vs 11(b)', () => {
      assert.notEqual(normalizeLabelForMapping('1'), normalizeLabelForMapping('11'));
      assert.notEqual(normalizeLabelForMapping('11(a)'), normalizeLabelForMapping('11(b)'));
      assert.notEqual(normalizeLabelForMapping('1'), normalizeLabelForMapping('1(a)'));
    });

    it('normalizes roman numeral subparts: 36(I), 36(III A)', () => {
      assert.equal(normalizeLabelForMapping('36(I)'), '36(i)');
      assert.equal(normalizeLabelForMapping('36 (i)'), '36(i)');
      assert.equal(normalizeLabelForMapping('36(III A)'), '36(iii a)');
      assert.equal(normalizeLabelForMapping('36(III B)'), '36(iii b)');
    });

    it('returns null on empty or whitespace strings', () => {
      assert.equal(normalizeLabelForMapping(''), null);
      assert.equal(normalizeLabelForMapping('   '), null);
      assert.equal(normalizeLabelForMapping(null), null);
      assert.equal(normalizeLabelForMapping(undefined), null);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Explicit Reference Mapping (Tier 1)
  // --------------------------------------------------------------------------
  describe('Tier 1: Explicit Reference Mapping', () => {
    it('1. exact explicit reference maps with matched status and high confidence (0.95)', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: '1' });

      const result = mapAnswersDeterministically([q1], [a1]);

      assert.equal(result.mappings.length, 1);
      assert.deepEqual(result.mappings[0], {
        questionId: 'q1',
        answerId: 'a1',
        confidence: 0.95,
        status: 'matched',
        method: 'explicit_reference',
      });
      assert.deepEqual(result.unmatchedAnswerIds, []);
    });

    it('2. Q-prefix normalization matches correctly (Q1, q1, Q 1 -> Question 1)', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q 1' });

      const result = mapAnswersDeterministically([q1], [a1]);

      assert.equal(result.mappings.length, 1);
      assert.equal(result.mappings[0].questionId, 'q1');
      assert.equal(result.mappings[0].answerId, 'a1');
      assert.equal(result.mappings[0].status, 'matched');
      assert.equal(result.mappings[0].method, 'explicit_reference');
    });

    it('3. whitespace and punctuation variants normalize and map correctly', () => {
      const q11a = createMockQuestion({ id: 'q11a', number: '11(a)', order: 0 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: '11. (a).' });

      const result = mapAnswersDeterministically([q11a], [a1]);

      assert.equal(result.mappings.length, 1);
      assert.equal(result.mappings[0].questionId, 'q11a');
      assert.equal(result.mappings[0].answerId, 'a1');
      assert.equal(result.mappings[0].status, 'matched');
    });

    it('4. sub-questions 11(a) and 11(b) resolve independently', () => {
      const q11a = createMockQuestion({ id: 'q11a', number: '11(a)', order: 0 });
      const q11b = createMockQuestion({ id: 'q11b', number: '11(b)', order: 1 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: '11(a)' });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: '11(b)' });

      const result = mapAnswersDeterministically([q11a, q11b], [a1, a2]);

      assert.equal(result.mappings.length, 2);
      assert.equal(result.mappings[0].questionId, 'q11a');
      assert.equal(result.mappings[0].answerId, 'a1');
      assert.equal(result.mappings[1].questionId, 'q11b');
      assert.equal(result.mappings[1].answerId, 'a2');
    });

    it('4b. partial sub-question answering: only 11(b) answered -> 11(a) is unanswered, 11(b) is matched', () => {
      const q11a = createMockQuestion({ id: 'q11a', number: '11(a)', order: 0 });
      const q11b = createMockQuestion({ id: 'q11b', number: '11(b)', order: 1 });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: '11(b)' });

      const result = mapAnswersDeterministically([q11a, q11b], [a2]);

      assert.equal(result.mappings.length, 2);
      // 11(a) is unanswered without answerId
      assert.equal(result.mappings[0].questionId, 'q11a');
      assert.equal(result.mappings[0].status, 'unanswered');
      assert.equal(result.mappings[0].confidence, 0);
      assert.equal(result.mappings[0].answerId, undefined);

      // 11(b) is matched to a2
      assert.equal(result.mappings[1].questionId, 'q11b');
      assert.equal(result.mappings[1].status, 'matched');
      assert.equal(result.mappings[1].answerId, 'a2');
    });

    it('5. out-of-order explicit answers map to correct questions regardless of array position', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });

      // Student wrote Q1, then Q3, then Q2
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
      const a3 = createMockAnswer({ id: 'a3', detectedQuestionReference: 'Q3' });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: 'Q2' });

      const result = mapAnswersDeterministically([q1, q2, q3], [a1, a3, a2]);

      assert.equal(result.mappings.length, 3);
      assert.equal(result.mappings[0].questionId, 'q1');
      assert.equal(result.mappings[0].answerId, 'a1');

      assert.equal(result.mappings[1].questionId, 'q2');
      assert.equal(result.mappings[1].answerId, 'a2');

      assert.equal(result.mappings[2].questionId, 'q3');
      assert.equal(result.mappings[2].answerId, 'a3');
    });

    it('5b. explicit references always override positional order (e.g. Q3 A? Q1)', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });

      // Answers: Q3 (a3), A? (a2), Q1 (a1)
      const a3 = createMockAnswer({ id: 'a3', detectedQuestionReference: 'Q3' });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });

      const result = mapAnswersDeterministically([q1, q2, q3], [a3, a2, a1]);

      assert.equal(result.mappings.length, 3);
      assert.equal(result.mappings[0].questionId, 'q1');
      assert.equal(result.mappings[0].answerId, 'a1');
      assert.equal(result.mappings[0].method, 'explicit_reference');

      assert.equal(result.mappings[2].questionId, 'q3');
      assert.equal(result.mappings[2].answerId, 'a3');
      assert.equal(result.mappings[2].method, 'explicit_reference');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Multi-page and Missing/Extra Answer Tests
  // --------------------------------------------------------------------------
  describe('Multi-page, Missing, and Extra Answer Situations', () => {
    it('6. missing answer creates status "unanswered" with confidence 0 and no answerId', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });

      const result = mapAnswersDeterministically([q1, q2], [a1]);

      assert.equal(result.mappings.length, 2);
      assert.equal(result.mappings[0].questionId, 'q1');
      assert.equal(result.mappings[0].status, 'matched');
      assert.equal(result.mappings[0].answerId, 'a1');

      assert.equal(result.mappings[1].questionId, 'q2');
      assert.equal(result.mappings[1].status, 'unanswered');
      assert.equal(result.mappings[1].confidence, 0);
      assert.equal(result.mappings[1].answerId, undefined);
    });

    it('7. extra answer with unresolvable reference remains in unmatchedAnswerIds and getUnmatchedAnswers', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
      const a99 = createMockAnswer({ id: 'a99', detectedQuestionReference: 'Q99' });

      const result = mapAnswersDeterministically([q1], [a1, a99]);

      assert.equal(result.mappings.length, 1);
      assert.equal(result.mappings[0].questionId, 'q1');
      assert.equal(result.mappings[0].answerId, 'a1');

      assert.deepEqual(result.unmatchedAnswerIds, ['a99']);
      const unmatched = getUnmatchedAnswers([a1, a99], result.mappings);
      assert.equal(unmatched.length, 1);
      assert.equal(unmatched[0].id, 'a99');
    });

    it('10. multi-page Answer maps to single Question record once', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const multiPageAnswer = createMockAnswer({
        id: 'multi-a1',
        pages: [1, 2, 3],
        regions: [
          { page: 1, x: 0, y: 0.15, width: 0.98, height: 0.82 },
          { page: 2, x: 0.05, y: 0.02, width: 0.9, height: 0.95 },
          { page: 3, x: 0.02, y: 0.01, width: 0.92, height: 0.95 },
        ],
        detectedQuestionReference: 'Q1',
      });

      const result = mapAnswersDeterministically([q1], [multiPageAnswer]);

      assert.equal(result.mappings.length, 1);
      assert.deepEqual(result.mappings[0], {
        questionId: 'q1',
        answerId: 'multi-a1',
        confidence: 0.95,
        status: 'matched',
        method: 'explicit_reference',
      });
      assert.deepEqual(result.unmatchedAnswerIds, []);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Duplicate / Ambiguous Reference Handling
  // --------------------------------------------------------------------------
  describe('Ambiguity and Duplicate Reference Handling', () => {
    it('8. duplicate question label in question paper marks mapping as needs_review', () => {
      // Two distinct question entities sharing the same printed label "11(a)"
      const q11a_first = createMockQuestion({ id: 'q11a-1', number: '11(a)', order: 0 });
      const q11a_second = createMockQuestion({ id: 'q11a-2', number: '11(a)', order: 1 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: '11(a)' });

      const result = mapAnswersDeterministically([q11a_first, q11a_second], [a1]);

      assert.equal(result.mappings.length, 2);
      assert.equal(result.mappings[0].questionId, 'q11a-1');
      assert.equal(result.mappings[0].status, 'needs_review');
      assert.equal(result.mappings[0].confidence, 0.5);
      assert.equal(result.mappings[0].method, 'explicit_reference');

      assert.equal(result.mappings[1].questionId, 'q11a-2');
      assert.equal(result.mappings[1].status, 'needs_review');
      assert.equal(result.mappings[1].confidence, 0.5);
      assert.equal(result.mappings[1].method, 'explicit_reference');
    });

    it('9. duplicate answer reference (two answers claiming same Q3) produces needs_review and keeps second answer unmatched', () => {
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 0 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q3' });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: 'Q3' });

      const result = mapAnswersDeterministically([q3], [a1, a2]);

      assert.equal(result.mappings.length, 1);
      assert.equal(result.mappings[0].questionId, 'q3');
      assert.equal(result.mappings[0].status, 'needs_review');
      assert.equal(result.mappings[0].confidence, 0.5);
      assert.equal(result.mappings[0].method, 'explicit_reference');

      // a2 is preserved in unmatchedAnswerIds
      assert.deepEqual(result.unmatchedAnswerIds, ['a2']);
      const unmatched = getUnmatchedAnswers([a1, a2], result.mappings);
      assert.equal(unmatched.length, 1);
      assert.equal(unmatched[0].id, 'a2');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Tier 2: Structural Safety Audit Cases (Cases A through F)
  // --------------------------------------------------------------------------
  describe('Tier 2: Structural Safety Audit (Cases A through F)', () => {
    it('CASE A: Strong 1:1 gap (Q1 A? Q3 -> Q2 matched with confidence 0.80)', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });

      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });
      const a3 = createMockAnswer({ id: 'a3', detectedQuestionReference: 'Q3' });

      const result = mapAnswersDeterministically([q1, q2, q3], [a1, a2, a3]);

      assert.equal(result.mappings.length, 3);
      assert.equal(result.mappings[0].questionId, 'q1');
      assert.equal(result.mappings[0].status, 'matched');

      // Q2 strong structural match
      assert.equal(result.mappings[1].questionId, 'q2');
      assert.equal(result.mappings[1].answerId, 'a2');
      assert.equal(result.mappings[1].status, 'matched');
      assert.equal(result.mappings[1].method, 'structural');
      assert.equal(result.mappings[1].confidence, 0.8);

      assert.equal(result.mappings[2].questionId, 'q3');
      assert.equal(result.mappings[2].status, 'matched');
      assert.deepEqual(result.unmatchedAnswerIds, []);
    });

    it('CASE B: Multiple questions, equal number of answers (Q1 A? A? Q4 -> Q2, Q3 needs_review)', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });
      const q4 = createMockQuestion({ id: 'q4', number: '4', order: 3 });

      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });
      const a3 = createMockAnswer({ id: 'a3', detectedQuestionReference: null });
      const a4 = createMockAnswer({ id: 'a4', detectedQuestionReference: 'Q4' });

      const result = mapAnswersDeterministically([q1, q2, q3, q4], [a1, a2, a3, a4]);

      assert.equal(result.mappings.length, 4);
      assert.equal(result.mappings[0].status, 'matched');

      // Q2 and Q3 must NOT receive confident structural matches
      assert.equal(result.mappings[1].questionId, 'q2');
      assert.equal(result.mappings[1].answerId, 'a2');
      assert.equal(result.mappings[1].status, 'needs_review');
      assert.equal(result.mappings[1].confidence, 0.5);
      assert.equal(result.mappings[1].method, 'structural');

      assert.equal(result.mappings[2].questionId, 'q3');
      assert.equal(result.mappings[2].answerId, 'a3');
      assert.equal(result.mappings[2].status, 'needs_review');
      assert.equal(result.mappings[2].confidence, 0.5);
      assert.equal(result.mappings[2].method, 'structural');

      assert.equal(result.mappings[3].status, 'matched');
    });

    it('CASE C: More questions than answers (Q1 A? Q4 Q5 -> Q2, Q3 needs_review, Q4, Q5 matched)', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });
      const q4 = createMockQuestion({ id: 'q4', number: '4', order: 3 });
      const q5 = createMockQuestion({ id: 'q5', number: '5', order: 4 });

      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });
      const a4 = createMockAnswer({ id: 'a4', detectedQuestionReference: 'Q4' });
      const a5 = createMockAnswer({ id: 'a5', detectedQuestionReference: 'Q5' });

      const result = mapAnswersDeterministically([q1, q2, q3, q4, q5], [a1, a2, a4, a5]);

      assert.equal(result.mappings.length, 5);
      assert.equal(result.mappings[0].questionId, 'q1');
      assert.equal(result.mappings[0].status, 'matched');

      // Q2 and Q3 are both needs_review with candidate a2
      assert.equal(result.mappings[1].questionId, 'q2');
      assert.equal(result.mappings[1].status, 'needs_review');
      assert.equal(result.mappings[1].confidence, 0.5);

      assert.equal(result.mappings[2].questionId, 'q3');
      assert.equal(result.mappings[2].status, 'needs_review');
      assert.equal(result.mappings[2].confidence, 0.5);

      // Q4 and Q5 remain explicitly matched
      assert.equal(result.mappings[3].questionId, 'q4');
      assert.equal(result.mappings[3].status, 'matched');
      assert.equal(result.mappings[4].questionId, 'q5');
      assert.equal(result.mappings[4].status, 'matched');
    });

    it('CASE D: More answers than questions (Q1 A? A? Q3 -> Q2 needs_review, extra answer unmatched)', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });

      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
      const a2_1 = createMockAnswer({ id: 'a2-1', detectedQuestionReference: null });
      const a2_2 = createMockAnswer({ id: 'a2-2', detectedQuestionReference: null });
      const a3 = createMockAnswer({ id: 'a3', detectedQuestionReference: 'Q3' });

      const result = mapAnswersDeterministically([q1, q2, q3], [a1, a2_1, a2_2, a3]);

      assert.equal(result.mappings.length, 3);
      assert.equal(result.mappings[0].questionId, 'q1');
      assert.equal(result.mappings[0].status, 'matched');

      // Q2 is needs_review
      assert.equal(result.mappings[1].questionId, 'q2');
      assert.equal(result.mappings[1].status, 'needs_review');
      assert.equal(result.mappings[1].confidence, 0.5);

      assert.equal(result.mappings[2].questionId, 'q3');
      assert.equal(result.mappings[2].status, 'matched');

      // Extra unreferenced answer remains in unmatchedAnswerIds
      assert.deepEqual(result.unmatchedAnswerIds, ['a2-2']);
      const unmatched = getUnmatchedAnswers([a1, a2_1, a2_2, a3], result.mappings);
      assert.equal(unmatched.length, 1);
      assert.equal(unmatched[0].id, 'a2-2');
    });

    it('CASE E: No anchors, equal counts (Q1 Q2 Q3 vs A1 A2 A3 -> all needs_review, NEVER "matched")', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });

      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });
      const a3 = createMockAnswer({ id: 'a3', detectedQuestionReference: null });

      const result = mapAnswersDeterministically([q1, q2, q3], [a1, a2, a3]);

      assert.equal(result.mappings.length, 3);
      for (const m of result.mappings) {
        assert.equal(m.status, 'needs_review');
        assert.equal(m.confidence, 0.5);
        assert.equal(m.method, 'structural');
      }
    });

    it('CASE F: No anchors, unequal counts (Q1 Q2 Q3 Q4 vs A1 A2 A3 -> sequential candidates needs_review, Q4 unanswered)', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });
      const q4 = createMockQuestion({ id: 'q4', number: '4', order: 3 });

      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });
      const a3 = createMockAnswer({ id: 'a3', detectedQuestionReference: null });

      const result = mapAnswersDeterministically([q1, q2, q3, q4], [a1, a2, a3]);

      assert.equal(result.mappings.length, 4);

      // Q1, Q2, Q3 have sequential candidate answers with status needs_review
      assert.equal(result.mappings[0].questionId, 'q1');
      assert.equal(result.mappings[0].status, 'needs_review');
      assert.equal(result.mappings[0].confidence, 0.5);

      assert.equal(result.mappings[1].questionId, 'q2');
      assert.equal(result.mappings[1].status, 'needs_review');
      assert.equal(result.mappings[1].confidence, 0.5);

      assert.equal(result.mappings[2].questionId, 'q3');
      assert.equal(result.mappings[2].status, 'needs_review');
      assert.equal(result.mappings[2].confidence, 0.5);

      // Q4 is unanswered
      assert.equal(result.mappings[3].questionId, 'q4');
      assert.equal(result.mappings[3].status, 'unanswered');
      assert.equal(result.mappings[3].confidence, 0);
      assert.equal(result.mappings[3].answerId, undefined);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Contract, Schema, and Store Integration Tests
  // --------------------------------------------------------------------------
  describe('Contract and Assessment Store Integration', () => {
    it('13. no semantic method or AI calls emitted by deterministic mapper', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: '1' });

      const result = mapAnswersDeterministically([q1], [a1]);

      for (const m of result.mappings) {
        assert.notEqual(m.method, 'semantic');
      }
    });

    it('14. every generated AnswerMapping strictly passes AnswerMappingSchema validation', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: '1' });
      const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });

      const result = mapAnswersDeterministically([q1, q2, q3], [a1, a2]);

      for (const m of result.mappings) {
        assert.doesNotThrow(() => AnswerMappingSchema.parse(m));
      }
    });

    it('15. mapAssessmentAnswersDeterministically updates Assessment.mappings in assessmentStore', () => {
      const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
      const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
      const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });

      const assessment = assessmentStore.create({
        status: 'queued',
        questionPaper: {
          id: 'qp-1',
          filename: 'qp.pdf',
          mimeType: 'application/pdf',
          pageCount: 1,
        },
        answerSheet: {
          id: 'as-1',
          filename: 'as.pdf',
          mimeType: 'application/pdf',
          pageCount: 1,
        },
        questions: [q1, q2],
        answers: [a1],
        mappings: [],
      });

      const mappings = mapAssessmentAnswersDeterministically(assessment.id);

      assert.equal(mappings.length, 2);
      assert.equal(mappings[0].questionId, 'q1');
      assert.equal(mappings[0].status, 'matched');
      assert.equal(mappings[0].answerId, 'a1');

      assert.equal(mappings[1].questionId, 'q2');
      assert.equal(mappings[1].status, 'unanswered');

      // Verify stored assessment has updated mappings
      const stored = assessmentStore.get(assessment.id);
      assert.ok(stored);
      assert.deepEqual(stored.mappings, mappings);
    });

    it('16. mapAssessmentAnswersDeterministically throws descriptive error for unknown assessmentId', () => {
      assert.throws(
        () => mapAssessmentAnswersDeterministically('non-existent-id'),
        /Assessment not found/
      );
    });
  });
});
