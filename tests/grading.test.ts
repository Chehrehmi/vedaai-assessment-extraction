import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAssessment,
} from '../lib/grading';
import {
  Question,
  Answer,
  AnswerMapping,
  AssessmentGradingSummary,
} from '../lib/domain/types';
import {
  AssessmentGradingSummarySchema,
  QuestionEvaluationSchema,
} from '../lib/validation/schemas';
import { ensureDemoAssessmentLoaded, DEMO_ASSESSMENT_ID } from '../lib/demo';
import { assessmentStore } from '../lib/store';
import { rasterStore } from '../lib/raster';

describe('Grading & Evaluation Layer Suite', () => {
  beforeEach(() => {
    assessmentStore.clear();
    rasterStore.clear();
  });

  const mockQuestions: Question[] = [
    { id: 'q1', number: '1', text: 'Question 1 text', order: 0, maxMarks: 1 },
    { id: 'q2', number: '2', text: 'Question 2 text', order: 1, maxMarks: 2 },
    { id: 'q3', number: '3', text: 'Question 3 text', order: 2 }, // default maxMarks = 1
  ];

  const mockAnswers: Answer[] = [
    {
      id: 'ans1',
      rawText: 'Student work for Q1',
      pages: [1, 2],
      regions: [
        { page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.8, extractionConfidence: 0.95 },
        { page: 2, x: 0.1, y: 0.1, width: 0.8, height: 0.4, extractionConfidence: 0.95 },
      ],
      detectedQuestionReference: '1',
    },
  ];

  it('1. Marks are represented correctly and respect question-level maxMarks', () => {
    const mappings: AnswerMapping[] = [
      { questionId: 'q1', answerId: 'ans1', confidence: 0.95, status: 'matched', method: 'explicit_reference' },
      { questionId: 'q2', confidence: 0, status: 'unanswered' },
      { questionId: 'q3', confidence: 0, status: 'unanswered' },
    ];

    const summary = evaluateAssessment({
      questions: mockQuestions,
      answers: mockAnswers,
      mappings,
    });

    assert.strictEqual(summary.totalQuestions, 3);
    assert.strictEqual(summary.totalMaxMarks, 4); // 1 + 2 + 1 = 4
    assert.strictEqual(summary.evaluations[0].maxMarks, 1);
    assert.strictEqual(summary.evaluations[1].maxMarks, 2);
    assert.strictEqual(summary.evaluations[2].maxMarks, 1);
  });

  it('2. Unanswered questions receive status "unanswered", 0 awarded marks, and clear feedback', () => {
    const mappings: AnswerMapping[] = [
      { questionId: 'q1', answerId: 'ans1', confidence: 0.95, status: 'matched', method: 'explicit_reference' },
      { questionId: 'q2', confidence: 0, status: 'unanswered' },
      { questionId: 'q3', confidence: 0, status: 'unanswered' },
    ];

    const summary = evaluateAssessment({
      questions: mockQuestions,
      answers: mockAnswers,
      mappings,
    });

    const q2Eval = summary.evaluations.find((e) => e.questionId === 'q2');
    assert.ok(q2Eval);
    assert.strictEqual(q2Eval.status, 'unanswered');
    assert.strictEqual(q2Eval.awardedMarks, 0);
    assert.strictEqual(q2Eval.feedback, 'Question was not attempted.');

    const q3Eval = summary.evaluations.find((e) => e.questionId === 'q3');
    assert.ok(q3Eval);
    assert.strictEqual(q3Eval.status, 'unanswered');
    assert.strictEqual(q3Eval.awardedMarks, 0);
  });

  it('3. Questions requiring human review are not falsely marked correct/incorrect', () => {
    const mappings: AnswerMapping[] = [
      { questionId: 'q1', answerId: 'ans1', confidence: 0.95, status: 'matched', method: 'explicit_reference' },
      { questionId: 'q2', confidence: 0, status: 'unanswered' },
      { questionId: 'q3', confidence: 0, status: 'unanswered' },
    ];

    const summary = evaluateAssessment({
      questions: mockQuestions,
      answers: mockAnswers,
      mappings,
    });

    const q1Eval = summary.evaluations.find((e) => e.questionId === 'q1');
    assert.ok(q1Eval);
    assert.strictEqual(q1Eval.status, 'needs_review');
    assert.strictEqual(q1Eval.awardedMarks, null); // Must not be 0 or fake score
    assert.ok(q1Eval.feedback?.includes('Page(s) 1, 2'));
    assert.ok(q1Eval.feedback?.includes('Ref: "1"'));
  });

  it('4. Overall summary totals are accurately aggregated across questions', () => {
    const mappings: AnswerMapping[] = [
      { questionId: 'q1', answerId: 'ans1', confidence: 0.95, status: 'matched', method: 'explicit_reference' },
      { questionId: 'q2', confidence: 0, status: 'unanswered' },
      { questionId: 'q3', confidence: 0, status: 'unanswered' },
    ];

    const summary = evaluateAssessment({
      questions: mockQuestions,
      answers: mockAnswers,
      mappings,
    });

    assert.strictEqual(summary.totalQuestions, 3);
    assert.strictEqual(summary.answeredCount, 1);
    assert.strictEqual(summary.unansweredCount, 2);
    assert.strictEqual(summary.needsReviewCount, 1);
    assert.strictEqual(summary.evaluatedCount, 0);
    assert.strictEqual(summary.totalMaxMarks, 4);
    assert.strictEqual(summary.totalAwardedMarks, null); // Pending human review

    // Strict schema parse verification
    const parsed = AssessmentGradingSummarySchema.parse(summary);
    assert.strictEqual(parsed.totalQuestions, 3);
  });

  it('5. When 100% of questions are unanswered, totalAwardedMarks is 0 rather than null', () => {
    const mappings: AnswerMapping[] = [
      { questionId: 'q1', confidence: 0, status: 'unanswered' },
      { questionId: 'q2', confidence: 0, status: 'unanswered' },
      { questionId: 'q3', confidence: 0, status: 'unanswered' },
    ];

    const summary = evaluateAssessment({
      questions: mockQuestions,
      answers: [],
      mappings,
    });

    assert.strictEqual(summary.answeredCount, 0);
    assert.strictEqual(summary.unansweredCount, 3);
    assert.strictEqual(summary.needsReviewCount, 0);
    assert.strictEqual(summary.totalAwardedMarks, 0);
  });

  it('6. Demo assessment includes deterministic grading summary matching 16 questions and 2 mapped answers', async () => {
    const demo = await ensureDemoAssessmentLoaded();

    assert.ok(demo.gradingSummary, 'Demo assessment must contain gradingSummary');
    const grading = demo.gradingSummary;
    assert.strictEqual(grading.totalQuestions, 16);
    assert.strictEqual(grading.answeredCount, 2);
    assert.strictEqual(grading.unansweredCount, 14);
    assert.strictEqual(grading.needsReviewCount, 2);
    assert.strictEqual(grading.totalMaxMarks, 16);
    assert.strictEqual(grading.totalAwardedMarks, null);

    // Q1 and Q2 evaluations
    const q1Eval = grading.evaluations.find((e) => e.questionId === demo.questions[0].id);
    assert.ok(q1Eval);
    assert.strictEqual(q1Eval.status, 'needs_review');
    assert.strictEqual(q1Eval.maxMarks, 1);
    assert.strictEqual(q1Eval.awardedMarks, null);

    const q2Eval = grading.evaluations.find((e) => e.questionId === demo.questions[1].id);
    assert.ok(q2Eval);
    assert.strictEqual(q2Eval.status, 'needs_review');
    assert.strictEqual(q2Eval.maxMarks, 1);
    assert.strictEqual(q2Eval.awardedMarks, null);

    // Q3 through Q16 evaluations are all unanswered with 0 marks
    for (let i = 2; i < 16; i++) {
      const qId = demo.questions[i].id;
      const qEval = grading.evaluations.find((e) => e.questionId === qId);
      assert.ok(qEval, `Evaluation for question ${i + 1} must exist`);
      assert.strictEqual(qEval.status, 'unanswered');
      assert.strictEqual(qEval.awardedMarks, 0);
      assert.strictEqual(qEval.feedback, 'Question was not attempted.');
    }
  });
});
