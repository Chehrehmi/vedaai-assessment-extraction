import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentStore } from '../lib/store';
import { rasterStore } from '../lib/raster';
import { processAssessment } from '../lib/pipeline';
import { mapAnswersDeterministically } from '../lib/mapping/deterministic-mapper';
import { resolveMappingsWithSemanticFallback } from '../lib/mapping/semantic-mapper';
import { Assessment, Question, Answer, AnswerMapping } from '../lib/domain/types';

describe('Phase 4: Eight Canonical QA Journeys Audit', () => {
  beforeEach(() => {
    assessmentStore.clear();
    rasterStore.clear();
  });

  // Journey 1: Sequential answers
  it('Journey 1: Sequential answers map deterministically with high confidence', async () => {
    const questions: Question[] = [
      { id: 'q1', number: '1', text: 'Define scalar matrix.', order: 0 },
      { id: 'q2', number: '2', text: 'State Rolle theorem.', order: 1 },
      { id: 'q3', number: '3', text: 'Evaluate integral.', order: 2 },
    ];
    const answers: Answer[] = [
      {
        id: 'a1',
        rawText: 'A diagonal matrix whose elements are equal.',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.2, extractionConfidence: 0.95 }],
        detectedQuestionReference: '1',
      },
      {
        id: 'a2',
        rawText: 'Let f be continuous on [a,b] and differentiable on (a,b)...',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.35, width: 0.8, height: 0.25, extractionConfidence: 0.95 }],
        detectedQuestionReference: '2',
      },
      {
        id: 'a3',
        rawText: 'Integral equals sin(x) + C.',
        pages: [2],
        regions: [{ page: 2, x: 0.1, y: 0.1, width: 0.8, height: 0.2, extractionConfidence: 0.95 }],
        detectedQuestionReference: '3',
      },
    ];

    const { mappings } = mapAnswersDeterministically(questions, answers);
    assert.strictEqual(mappings.length, 3);
    assert.strictEqual(mappings[0].status, 'matched');
    assert.strictEqual(mappings[0].answerId, 'a1');
    assert.strictEqual(mappings[1].status, 'matched');
    assert.strictEqual(mappings[1].answerId, 'a2');
    assert.strictEqual(mappings[2].status, 'matched');
    assert.strictEqual(mappings[2].answerId, 'a3');
  });

  // Journey 2: Out-of-order answers
  it('Journey 2: Out-of-order answers correctly map to questions in printed order', async () => {
    const questions: Question[] = [
      { id: 'q1', number: '1', text: 'Question 1 text', order: 0 },
      { id: 'q2', number: '2', text: 'Question 2 text', order: 1 },
      { id: 'q3', number: '3', text: 'Question 3 text', order: 2 },
    ];
    // Student answered Q3 first, then Q1, then Q2
    const answers: Answer[] = [
      {
        id: 'a3',
        rawText: 'Ans 3 text',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.25, extractionConfidence: 0.95 }],
        detectedQuestionReference: '3',
      },
      {
        id: 'a1',
        rawText: 'Ans 1 text',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.4, width: 0.8, height: 0.25, extractionConfidence: 0.95 }],
        detectedQuestionReference: '1',
      },
      {
        id: 'a2',
        rawText: 'Ans 2 text',
        pages: [2],
        regions: [{ page: 2, x: 0.1, y: 0.1, width: 0.8, height: 0.3, extractionConfidence: 0.95 }],
        detectedQuestionReference: '2',
      },
    ];

    const { mappings } = mapAnswersDeterministically(questions, answers);
    assert.strictEqual(mappings.length, 3);
    assert.strictEqual(mappings.find((m) => m.questionId === 'q1')?.answerId, 'a1');
    assert.strictEqual(mappings.find((m) => m.questionId === 'q2')?.answerId, 'a2');
    assert.strictEqual(mappings.find((m) => m.questionId === 'q3')?.answerId, 'a3');
    assert.ok(mappings.every((m) => m.status === 'matched'));
  });

  // Journey 3: 11(a) / 11(b) sub-questions
  it('Journey 3: Labelled sub-parts 11(a) and 11(b) are independent and map individually', async () => {
    const questions: Question[] = [
      { id: 'q11a', number: '11(a)', text: 'Derive kinetic energy.', parentNumber: '11', subPart: 'a', order: 0 },
      { id: 'q11b', number: '11(b)', text: 'Calculate work done.', parentNumber: '11', subPart: 'b', order: 1 },
    ];
    const answers: Answer[] = [
      {
        id: 'a11a',
        rawText: 'KE = 1/2 m v^2',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.3, extractionConfidence: 0.95 }],
        detectedQuestionReference: '11(a)',
      },
      {
        id: 'a11b',
        rawText: 'W = F * d = 50 J',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.45, width: 0.8, height: 0.3, extractionConfidence: 0.95 }],
        detectedQuestionReference: '11(b)',
      },
    ];

    const { mappings } = mapAnswersDeterministically(questions, answers);
    assert.strictEqual(mappings.length, 2);
    assert.strictEqual(mappings.find((m) => m.questionId === 'q11a')?.answerId, 'a11a');
    assert.strictEqual(mappings.find((m) => m.questionId === 'q11b')?.answerId, 'a11b');
  });

  // Journey 4: Unanswered question
  it('Journey 4: Skipped/unanswered question is classified as status "unanswered"', async () => {
    const questions: Question[] = [
      { id: 'q1', number: '1', text: 'Answered question', order: 0 },
      { id: 'q2', number: '2', text: 'Skipped question', order: 1 },
    ];
    const answers: Answer[] = [
      {
        id: 'a1',
        rawText: 'Answer to Q1 only',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.4, extractionConfidence: 0.95 }],
        detectedQuestionReference: '1',
      },
    ];

    const { mappings } = mapAnswersDeterministically(questions, answers);
    const q1Map = mappings.find((m) => m.questionId === 'q1');
    const q2Map = mappings.find((m) => m.questionId === 'q2');

    assert.strictEqual(q1Map?.status, 'matched');
    assert.strictEqual(q1Map?.answerId, 'a1');

    assert.strictEqual(q2Map?.status, 'unanswered');
    assert.strictEqual(q2Map?.answerId, undefined);
    assert.strictEqual(q2Map?.confidence, 0);
  });

  // Journey 5: Unmatched answer
  it('Journey 5: Extraneous or unrecognized answer is preserved as unmatched and does not corrupt question mapping', async () => {
    const questions: Question[] = [
      { id: 'q1', number: '1', text: 'Only question on paper', order: 0 },
    ];
    const answers: Answer[] = [
      {
        id: 'a1',
        rawText: 'Valid answer to Q1',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.3, extractionConfidence: 0.95 }],
        detectedQuestionReference: '1',
      },
      {
        id: 'a-extra',
        rawText: 'Extra handwritten work labeled Q99',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.5, width: 0.8, height: 0.3, extractionConfidence: 0.9 }],
        detectedQuestionReference: '99',
      },
    ];

    const { mappings, unmatchedAnswerIds } = mapAnswersDeterministically(questions, answers);
    assert.strictEqual(mappings.length, 1);
    assert.strictEqual(mappings[0].questionId, 'q1');
    assert.strictEqual(mappings[0].answerId, 'a1');
    assert.strictEqual(unmatchedAnswerIds.length, 1);
    assert.strictEqual(unmatchedAnswerIds[0], 'a-extra');
  });

  // Journey 6: Multi-page answer
  it('Journey 6: Multi-page answer maintains multiple spatial regions and correct page list', async () => {
    const questions: Question[] = [
      { id: 'q1', number: '1', text: 'Long proof question', order: 0 },
    ];
    const answers: Answer[] = [
      {
        id: 'a-multipage',
        rawText: 'Step 1 proof on page 1 ... Step 2 conclusion on page 2',
        pages: [1, 2],
        regions: [
          { page: 1, x: 0.05, y: 0.2, width: 0.9, height: 0.75, extractionConfidence: 0.96 },
          { page: 2, x: 0.05, y: 0.05, width: 0.9, height: 0.45, extractionConfidence: 0.94 },
        ],
        detectedQuestionReference: '1',
      },
    ];

    const { mappings } = mapAnswersDeterministically(questions, answers);
    assert.strictEqual(mappings.length, 1);
    assert.strictEqual(mappings[0].status, 'matched');
    assert.strictEqual(mappings[0].answerId, 'a-multipage');

    const mappedAnswer = answers.find((a) => a.id === mappings[0].answerId);
    assert.ok(mappedAnswer);
    assert.strictEqual(mappedAnswer.pages.length, 2);
    assert.deepStrictEqual(mappedAnswer.pages, [1, 2]);
    assert.strictEqual(mappedAnswer.regions.length, 2);
    assert.strictEqual(mappedAnswer.regions[0].page, 1);
    assert.strictEqual(mappedAnswer.regions[1].page, 2);
  });

  // Journey 7: Low-confidence / Ambiguous match
  it('Journey 7: Low-confidence or ambiguous match produces status "needs_review"', async () => {
    const questions: Question[] = [
      { id: 'q1', number: '1', text: 'Question about thermodynamics', order: 0 },
      { id: 'q2', number: '2', text: 'Question about kinetics', order: 1 },
      { id: 'q3', number: '3', text: 'Question about equilibrium', order: 2 },
    ];
    const answers: Answer[] = [
      {
        id: 'a-explicit',
        rawText: 'Equilibrium constant expression...',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.3, extractionConfidence: 0.95 }],
        detectedQuestionReference: '3',
      },
      {
        id: 'a-ambiguous',
        rawText: 'Heat and work are forms of energy...',
        pages: [1],
        regions: [{ page: 1, x: 0.1, y: 0.45, width: 0.8, height: 0.3, extractionConfidence: 0.8 }],
      },
    ];

    const mockAiProvider = {
      resolveSemanticMappings: async () => [
        {
          questionId: 'q1',
          answerId: 'a-ambiguous',
          confidence: 0.65, // Below high-confidence threshold
          reasoning: 'Mentions thermodynamics keywords but lacks explicit reference.',
        },
      ],
    };

    const finalMappings = await resolveMappingsWithSemanticFallback(questions, answers, {
      provider: mockAiProvider as any,
    });
    const q1Map = finalMappings.find((m) => m.questionId === 'q1');

    assert.strictEqual(q1Map?.status, 'needs_review');
    assert.strictEqual(q1Map?.method, 'semantic');
    assert.strictEqual(q1Map?.confidence, 0.65);
    assert.strictEqual(q1Map?.answerId, 'a-ambiguous');
  });

  // Journey 8: Processing failure & recovery
  it('Journey 8: Processing failure transitions gracefully to status "failed" with sanitized error message', async () => {
    const assessment = assessmentStore.create({
      questionPaper: {
        id: 'qp-1',
        filename: 'corrupt.pdf',
        mimeType: 'application/pdf',
        pageCount: 1,
      },
      answerSheet: {
        id: 'as-1',
        filename: 'as.pdf',
        mimeType: 'application/pdf',
        pageCount: 1,
      },
    });

    // Run pipeline with missing raster pages (simulating corruption)
    const result = await processAssessment(assessment.id);
    assert.strictEqual(result.status, 'failed');
    assert.ok(result.errorCode);
    assert.ok(result.errorMessage);

    const stored = assessmentStore.get(assessment.id);
    assert.strictEqual(stored?.status, 'failed');
    assert.strictEqual(stored?.errorCode, result.errorCode);
    assert.strictEqual(stored?.errorMessage, result.errorMessage);
  });
});
