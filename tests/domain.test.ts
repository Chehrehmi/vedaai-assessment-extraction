import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnswerRegionSchema,
  AnswerSchema,
  QuestionSchema,
  AnswerMappingSchema,
  ProcessingStageSchema,
  AssessmentSchema,
} from '../lib/validation/index.js';
import {
  sortQuestionsByOrder,
  isMultiPageAnswer,
  getAnswerRegionsForPage,
  getUnmatchedAnswers,
} from '../lib/domain/index.js';

test('1. valid AnswerRegion with normalized coordinates passes', () => {
  const validRegion = {
    page: 1,
    x: 0.1,
    y: 0.2,
    width: 0.6,
    height: 0.5,
    extractionConfidence: 0.95,
  };

  const parsed = AnswerRegionSchema.safeParse(validRegion);
  assert.ok(parsed.success);
  if (parsed.success) {
    assert.equal(parsed.data.page, 1);
    assert.equal(parsed.data.x, 0.1);
  }
});

test('2. AnswerRegion with x < 0 fails', () => {
  const invalid = { page: 1, x: -0.05, y: 0.1, width: 0.5, height: 0.5 };
  const parsed = AnswerRegionSchema.safeParse(invalid);
  assert.ok(!parsed.success);
});

test('3. AnswerRegion with y < 0 fails', () => {
  const invalid = { page: 1, x: 0.1, y: -0.1, width: 0.5, height: 0.5 };
  const parsed = AnswerRegionSchema.safeParse(invalid);
  assert.ok(!parsed.success);
});

test('4. AnswerRegion whose right edge is exactly 1 passes', () => {
  const exactRightEdge = { page: 1, x: 0.4, y: 0.1, width: 0.6, height: 0.5 }; // x + width = 1.0
  const parsed = AnswerRegionSchema.safeParse(exactRightEdge);
  assert.ok(parsed.success);
});

test('5. AnswerRegion whose bottom edge is exactly 1 passes', () => {
  const exactBottomEdge = { page: 1, x: 0.1, y: 0.3, width: 0.5, height: 0.7 }; // y + height = 1.0
  const parsed = AnswerRegionSchema.safeParse(exactBottomEdge);
  assert.ok(parsed.success);
});

test('6. AnswerRegion whose right edge is 1.000001 fails (strict boundary)', () => {
  const invalid = { page: 1, x: 0.5, y: 0.1, width: 0.500001, height: 0.5 }; // x + width = 1.000001 > 1
  const parsed = AnswerRegionSchema.safeParse(invalid);
  assert.ok(!parsed.success);
  if (!parsed.success) {
    assert.ok(parsed.error.issues.some((i) => i.message.includes('right edge exceeds page boundary')));
  }
});

test('7. AnswerRegion whose bottom edge is 1.000001 fails (strict boundary)', () => {
  const invalid = { page: 1, x: 0.1, y: 0.5, width: 0.5, height: 0.500001 }; // y + height = 1.000001 > 1
  const parsed = AnswerRegionSchema.safeParse(invalid);
  assert.ok(!parsed.success);
  if (!parsed.success) {
    assert.ok(parsed.error.issues.some((i) => i.message.includes('bottom edge exceeds page boundary')));
  }
});

test('8. AnswerRegion with invalid confidence fails', () => {
  const invalidHigh = { page: 1, x: 0, y: 0, width: 0.5, height: 0.5, extractionConfidence: 1.2 };
  const invalidLow = { page: 1, x: 0, y: 0, width: 0.5, height: 0.5, extractionConfidence: -0.1 };

  assert.ok(!AnswerRegionSchema.safeParse(invalidHigh).success);
  assert.ok(!AnswerRegionSchema.safeParse(invalidLow).success);
});

test('9. valid multi-page Answer passes', () => {
  const multiPageAnswer = {
    id: 'ans-1',
    rawText: 'Full explanation spanning two pages',
    pages: [1, 2],
    regions: [
      { page: 1, x: 0.05, y: 0.15, width: 0.9, height: 0.8 },
      { page: 2, x: 0.05, y: 0.05, width: 0.9, height: 0.5 },
    ],
    detectedQuestionReference: 'Q1',
  };

  const parsed = AnswerSchema.safeParse(multiPageAnswer);
  assert.ok(parsed.success);
  assert.ok(isMultiPageAnswer(multiPageAnswer));
  assert.equal(getAnswerRegionsForPage(multiPageAnswer, 1).length, 1);
  assert.equal(getAnswerRegionsForPage(multiPageAnswer, 2).length, 1);
});

test('10. pages must be valid and sorted in ascending order', () => {
  const unsortedPages = {
    id: 'ans-2',
    pages: [3, 1], // Unsorted!
    regions: [
      { page: 3, x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      { page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    ],
  };

  const parsed = AnswerSchema.safeParse(unsortedPages);
  assert.ok(!parsed.success);
  if (!parsed.success) {
    assert.ok(parsed.error.issues.some((i) => i.message.includes('sorted in ascending order')));
  }
});

test('11. valid Question including sub-question metadata passes', () => {
  const q1 = {
    id: 'q-1',
    number: '11 (a)',
    text: 'Explain quicksort algorithm.',
    order: 1,
    parentNumber: '11',
    subPart: 'a',
  };
  const q2 = {
    id: 'q-2',
    number: '11 (b)',
    text: 'Derive average case time complexity.',
    order: 2,
    parentNumber: '11',
    subPart: 'b',
  };

  assert.ok(QuestionSchema.safeParse(q1).success);
  assert.ok(QuestionSchema.safeParse(q2).success);

  const sorted = sortQuestionsByOrder([q2, q1]);
  assert.equal(sorted[0].id, 'q-1');
  assert.equal(sorted[1].id, 'q-2');
});

test('12. valid matched AnswerMapping passes', () => {
  const mapping = {
    questionId: 'q-1',
    answerId: 'ans-1',
    confidence: 0.95,
    status: 'matched',
    method: 'explicit_reference',
  };

  const parsed = AnswerMappingSchema.safeParse(mapping);
  assert.ok(parsed.success);
});

test('13. unanswered mapping without answerId passes', () => {
  const mapping = {
    questionId: 'q-2',
    confidence: 0.0,
    status: 'unanswered',
  };

  const parsed = AnswerMappingSchema.safeParse(mapping);
  assert.ok(parsed.success);
});

test('14. unanswered mapping with answerId is rejected', () => {
  const invalid = {
    questionId: 'q-2',
    answerId: 'ans-2', // Conflict with unanswered
    confidence: 0.5,
    status: 'unanswered',
  };

  const parsed = AnswerMappingSchema.safeParse(invalid);
  assert.ok(!parsed.success);
  if (!parsed.success) {
    assert.ok(parsed.error.issues.some((i) => i.message.includes('Unanswered mapping must not have an answerId')));
  }
});

test('15. confidence outside 0..1 is rejected', () => {
  const invalidConfidence = {
    questionId: 'q-1',
    answerId: 'ans-1',
    confidence: 1.5,
    status: 'matched',
  };

  assert.ok(!AnswerMappingSchema.safeParse(invalidConfidence).success);
});

test('16. detecting_answers passes as a ProcessingStage', () => {
  assert.ok(ProcessingStageSchema.safeParse('queued').success);
  assert.ok(ProcessingStageSchema.safeParse('uploading').success);
  assert.ok(ProcessingStageSchema.safeParse('reading_question_paper').success);
  assert.ok(ProcessingStageSchema.safeParse('extracting_questions').success);
  assert.ok(ProcessingStageSchema.safeParse('reading_answer_sheet').success);
  assert.ok(ProcessingStageSchema.safeParse('detecting_answers').success);
  assert.ok(ProcessingStageSchema.safeParse('mapping_answers').success);
  assert.ok(ProcessingStageSchema.safeParse('finalizing').success);
  assert.ok(ProcessingStageSchema.safeParse('completed').success);
  assert.ok(ProcessingStageSchema.safeParse('failed').success);
});

test('17. detecting_answer_regions fails as a ProcessingStage', () => {
  const result = ProcessingStageSchema.safeParse('detecting_answer_regions');
  assert.ok(!result.success);
});

test('18. getUnmatchedAnswers correctly identifies unmapped answers', () => {
  const answers = [
    { id: 'ans-1', pages: [1], regions: [{ page: 1, x: 0, y: 0, width: 0.5, height: 0.5 }] },
    { id: 'ans-2', pages: [2], regions: [{ page: 2, x: 0, y: 0, width: 0.5, height: 0.5 }] },
    { id: 'ans-3', pages: [3], regions: [{ page: 3, x: 0, y: 0, width: 0.5, height: 0.5 }] },
  ];

  const mappings = [
    { questionId: 'q-1', answerId: 'ans-1', confidence: 0.9, status: 'matched' as const },
    { questionId: 'q-2', confidence: 0, status: 'unanswered' as const },
  ];

  const unmatched = getUnmatchedAnswers(answers, mappings);
  assert.equal(unmatched.length, 2);
  assert.equal(unmatched[0].id, 'ans-2');
  assert.equal(unmatched[1].id, 'ans-3');
});
