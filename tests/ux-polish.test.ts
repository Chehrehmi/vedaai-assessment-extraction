import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureDemoAssessmentLoaded } from '../lib/demo';
import { mapAnswersDeterministically } from '../lib/mapping/deterministic-mapper';
import { Question, Answer } from '../lib/domain/types';
import { assessmentStore } from '../lib/store';
import { rasterStore } from '../lib/raster';

describe('UX Polish: Processing Time & Mapping Method Labels', () => {
  beforeEach(() => {
    assessmentStore.clear();
    rasterStore.clear();
  });

  const mockQuestions: Question[] = [
    { id: 'q1', number: '1', text: 'Evaluate the integral', order: 0 },
    { id: 'q2', number: '2', text: 'Find the derivative', order: 1 },
    { id: 'q3', number: '3', text: 'Solve the system', order: 2 },
  ];

  it('1. Explicit reference mapping assigns method "explicit_reference"', () => {
    const answers: Answer[] = [
      {
        id: 'a1',
        rawText: 'Answer 1 work',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.3 }],
        detectedQuestionReference: '1',
      },
    ];

    const result = mapAnswersDeterministically(mockQuestions, answers);
    const q1Mapping = result.mappings.find((m) => m.questionId === 'q1');

    assert.ok(q1Mapping);
    assert.strictEqual(q1Mapping.status, 'matched');
    assert.strictEqual(q1Mapping.method, 'explicit_reference');
  });

  it('2. Structural 1:1 sequence mapping assigns method "structural"', () => {
    const singleQ: Question[] = [
      { id: 'q1', number: '1', text: 'Question 1', order: 0 },
    ];
    const answers: Answer[] = [
      {
        id: 'a1',
        rawText: 'Unlabeled answer body',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.3 }],
        // No explicit question reference
      },
    ];

    const result = mapAnswersDeterministically(singleQ, answers);
    const q1Mapping = result.mappings.find((m) => m.questionId === 'q1');

    assert.ok(q1Mapping);
    assert.strictEqual(q1Mapping.status, 'matched');
    assert.strictEqual(q1Mapping.method, 'structural');
  });

  it('3. Unanswered questions do not receive a mapping method or answerId', () => {
    const answers: Answer[] = [
      {
        id: 'a1',
        rawText: 'Answer 1',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.3 }],
        detectedQuestionReference: '1',
      },
    ];

    const result = mapAnswersDeterministically(mockQuestions, answers);
    const q2Mapping = result.mappings.find((m) => m.questionId === 'q2');
    const q3Mapping = result.mappings.find((m) => m.questionId === 'q3');

    assert.ok(q2Mapping);
    assert.strictEqual(q2Mapping.status, 'unanswered');
    assert.strictEqual(q2Mapping.method, undefined);
    assert.strictEqual(q2Mapping.answerId, undefined);

    assert.ok(q3Mapping);
    assert.strictEqual(q3Mapping.status, 'unanswered');
    assert.strictEqual(q3Mapping.method, undefined);
    assert.strictEqual(q3Mapping.answerId, undefined);
  });

  it('4. Demo assessment preserves truthful explicit_reference methods for Q1 and Q2', async () => {
    const demo = await ensureDemoAssessmentLoaded();

    const q1Mapping = demo.mappings.find((m) => m.questionId === demo.questions[0].id);
    assert.ok(q1Mapping);
    assert.strictEqual(q1Mapping.status, 'matched');
    assert.strictEqual(q1Mapping.method, 'explicit_reference');

    const q2Mapping = demo.mappings.find((m) => m.questionId === demo.questions[1].id);
    assert.ok(q2Mapping);
    assert.strictEqual(q2Mapping.status, 'matched');
    assert.strictEqual(q2Mapping.method, 'explicit_reference');

    // Questions 3 through 16 must have no method assigned
    for (let i = 2; i < 16; i++) {
      const qMapping = demo.mappings.find((m) => m.questionId === demo.questions[i].id);
      assert.ok(qMapping);
      assert.strictEqual(qMapping.status, 'unanswered');
      assert.strictEqual(qMapping.method, undefined);
    }
  });
});
