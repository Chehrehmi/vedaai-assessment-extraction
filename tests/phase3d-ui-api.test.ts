import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentStore } from '../lib/store';
import { rasterStore, RasterizedPage } from '../lib/raster';
import { Assessment, Question, Answer, AnswerMapping } from '../lib/domain/types';
import { GET as getAssessmentHandler } from '../app/api/assessment/[id]/route';
import { GET as getAssessmentStatusHandler } from '../app/api/assessment/[id]/status/route';
import { GET as getAssessmentPageHandler } from '../app/api/assessment/[id]/page/[docType]/[pageNumber]/route';
import { NextRequest } from 'next/server';

function createDummyRasterPage(pageNumber: number, docType: 'question_paper' | 'answer_sheet'): RasterizedPage {
  return {
    pageNumber,
    width: 1000,
    height: 1400,
    mimeType: 'image/png',
    imageBuffer: Buffer.from(`fake-png-binary-data-for-${docType}-p${pageNumber}`),
  };
}

function setupMockCompletedAssessment(assessmentId: string): Assessment {
  const qpPages = [createDummyRasterPage(1, 'question_paper'), createDummyRasterPage(2, 'question_paper')];
  const asPages = [createDummyRasterPage(1, 'answer_sheet'), createDummyRasterPage(2, 'answer_sheet')];

  rasterStore.savePages(assessmentId, 'question_paper', qpPages);
  rasterStore.savePages(assessmentId, 'answer_sheet', asPages);

  const questions: Question[] = [
    {
      id: 'q1',
      number: '1',
      text: 'What is dynamic programming?',
      order: 0,
    },
    {
      id: 'q2',
      number: '2(a)',
      text: 'Explain memoization.',
      order: 1,
      parentNumber: '2',
      subPart: 'a',
    },
    {
      id: 'q3',
      number: '2(b)',
      text: 'Explain tabulation.',
      order: 2,
      parentNumber: '2',
      subPart: 'b',
    },
    {
      id: 'q4',
      number: '3',
      text: 'State Master Theorem.',
      order: 3,
    },
  ];

  const answers: Answer[] = [
    {
      id: 'ans-1',
      rawText: 'DP is an optimization method breaking problems into subproblems.',
      pages: [1, 2], // multi-page answer
      regions: [
        { page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.35, extractionConfidence: 0.95 },
        { page: 2, x: 0.1, y: 0.05, width: 0.8, height: 0.25, extractionConfidence: 0.92 },
      ],
      detectedQuestionReference: '1',
    },
    {
      id: 'ans-2',
      rawText: 'Memoization stores top-down results in a lookup table.',
      pages: [2],
      regions: [
        { page: 2, x: 0.1, y: 0.35, width: 0.8, height: 0.25, extractionConfidence: 0.85 },
      ],
      detectedQuestionReference: '2(a)',
    },
    {
      id: 'ans-unmatched',
      rawText: 'Extra handwritten answer written on margin.',
      pages: [2],
      regions: [
        { page: 2, x: 0.1, y: 0.65, width: 0.8, height: 0.2, extractionConfidence: 0.7 },
      ],
      detectedQuestionReference: '99',
    },
  ];

  const mappings: AnswerMapping[] = [
    {
      questionId: 'q1',
      answerId: 'ans-1',
      confidence: 0.95,
      status: 'matched',
      method: 'explicit_reference',
    },
    {
      questionId: 'q2',
      answerId: 'ans-2',
      confidence: 0.85,
      status: 'matched',
      method: 'explicit_reference',
    },
    {
      questionId: 'q3',
      answerId: 'ans-unmatched',
      confidence: 0.6,
      status: 'needs_review',
      method: 'structural',
    },
    {
      questionId: 'q4',
      confidence: 0,
      status: 'unanswered',
    },
  ];

  return assessmentStore.create({
    id: assessmentId,
    status: 'completed',
    questionPaper: {
      id: 'qp-doc',
      filename: 'Sample_Question_Paper.pdf',
      mimeType: 'application/pdf',
      pageCount: 2,
      pages: qpPages.map((p) => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        imageUrl: `/api/assessment/${assessmentId}/page/question_paper/${p.pageNumber}`,
      })),
    },
    answerSheet: {
      id: 'as-doc',
      filename: 'Sample_Answer_Sheet.pdf',
      mimeType: 'application/pdf',
      pageCount: 2,
      pages: asPages.map((p) => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        imageUrl: `/api/assessment/${assessmentId}/page/answer_sheet/${p.pageNumber}`,
      })),
    },
    questions,
    answers,
    mappings,
  });
}

describe('Phase 3D: UI APIs and Workspace Data Endpoints', () => {
  const assessmentId = 'test-phase3d-assessment-1';

  beforeEach(() => {
    assessmentStore.clear();
    rasterStore.clear();
  });

  // --------------------------------------------------------------------------
  // 1. GET /api/assessment/[id] Endpoint
  // --------------------------------------------------------------------------
  it('1. GET /api/assessment/[id] returns full completed assessment with all questions, answers, and mappings', async () => {
    setupMockCompletedAssessment(assessmentId);

    const req = new NextRequest(`http://localhost:3000/api/assessment/${assessmentId}`);
    const res = await getAssessmentHandler(req, {
      params: Promise.resolve({ id: assessmentId }),
    });

    assert.equal(res.status, 200);
    const data: Assessment = await res.json();

    assert.equal(data.id, assessmentId);
    assert.equal(data.status, 'completed');
    assert.equal(data.questions.length, 4);
    assert.equal(data.answers.length, 3);
    assert.equal(data.mappings.length, 4);

    // Verify multi-page answer preserved
    const multiPageAns = data.answers.find((a) => a.id === 'ans-1');
    assert.ok(multiPageAns);
    assert.deepEqual(multiPageAns.pages, [1, 2]);
    assert.equal(multiPageAns.regions.length, 2);
  });

  it('2. GET /api/assessment/[id] returns 404 for unknown or expired assessment session', async () => {
    const req = new NextRequest('http://localhost:3000/api/assessment/non-existent-id');
    const res = await getAssessmentHandler(req, {
      params: Promise.resolve({ id: 'non-existent-id' }),
    });

    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data?.error?.code, 'NOT_FOUND');
  });

  // --------------------------------------------------------------------------
  // 2. GET /api/assessment/[id]/status Endpoint
  // --------------------------------------------------------------------------
  it('3. GET /api/assessment/[id]/status returns live processing status and summary counts', async () => {
    setupMockCompletedAssessment(assessmentId);

    const req = new NextRequest(`http://localhost:3000/api/assessment/${assessmentId}/status`);
    const res = await getAssessmentStatusHandler(req, {
      params: Promise.resolve({ id: assessmentId }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.id, assessmentId);
    assert.equal(data.status, 'completed');
    assert.equal(data.questionCount, 4);
    assert.equal(data.answerCount, 3);
    assert.equal(data.mappingCount, 4);
  });

  it('4. GET /api/assessment/[id]/status returns 404 for missing assessment', async () => {
    const req = new NextRequest('http://localhost:3000/api/assessment/missing-id/status');
    const res = await getAssessmentStatusHandler(req, {
      params: Promise.resolve({ id: 'missing-id' }),
    });

    assert.equal(res.status, 404);
  });

  // --------------------------------------------------------------------------
  // 3. GET /api/assessment/[id]/page/[docType]/[pageNumber] Endpoint
  // --------------------------------------------------------------------------
  it('5. GET /api/assessment/[id]/page/[docType]/[pageNumber] returns binary PNG with correct content-type', async () => {
    setupMockCompletedAssessment(assessmentId);

    const req = new NextRequest(`http://localhost:3000/api/assessment/${assessmentId}/page/answer_sheet/1`);
    const res = await getAssessmentPageHandler(req, {
      params: Promise.resolve({
        id: assessmentId,
        docType: 'answer_sheet',
        pageNumber: '1',
      }),
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/png');
    assert.ok(res.headers.get('Cache-Control')?.includes('public'));

    const arrayBuffer = await res.arrayBuffer();
    const text = Buffer.from(arrayBuffer).toString();
    assert.ok(text.includes('fake-png-binary-data-for-answer_sheet-p1'));
  });

  it('6. GET /api/assessment/[id]/page with invalid docType returns 400', async () => {
    setupMockCompletedAssessment(assessmentId);

    const req = new NextRequest(`http://localhost:3000/api/assessment/${assessmentId}/page/invalid_doc/1`);
    const res = await getAssessmentPageHandler(req, {
      params: Promise.resolve({
        id: assessmentId,
        docType: 'invalid_doc',
        pageNumber: '1',
      }),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data?.error?.code, 'INVALID_DOC_TYPE');
  });

  it('7. GET /api/assessment/[id]/page with out-of-bounds pageNumber returns 404', async () => {
    setupMockCompletedAssessment(assessmentId);

    const req = new NextRequest(`http://localhost:3000/api/assessment/${assessmentId}/page/answer_sheet/99`);
    const res = await getAssessmentPageHandler(req, {
      params: Promise.resolve({
        id: assessmentId,
        docType: 'answer_sheet',
        pageNumber: '99',
      }),
    });

    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data?.error?.code, 'PAGE_NOT_FOUND');
  });

  // --------------------------------------------------------------------------
  // 4. Domain & State Mapping Integrity for UI Consumption
  // --------------------------------------------------------------------------
  it('8. assessment data structure supports all four UI mapping states (matched, needs_review, unanswered, unmatched)', () => {
    const asm = setupMockCompletedAssessment(assessmentId);

    const mappedAnswerIds = new Set(asm.mappings.map((m) => m.answerId).filter(Boolean));
    const unmatchedAnswers = asm.answers.filter((a) => !mappedAnswerIds.has(a.id));

    // Q1 is matched
    const m1 = asm.mappings.find((m) => m.questionId === 'q1');
    assert.equal(m1?.status, 'matched');
    assert.ok(m1?.answerId);

    // Q3 is needs_review
    const m3 = asm.mappings.find((m) => m.questionId === 'q3');
    assert.equal(m3?.status, 'needs_review');
    assert.ok(m3?.answerId);

    // Q4 is unanswered
    const m4 = asm.mappings.find((m) => m.questionId === 'q4');
    assert.equal(m4?.status, 'unanswered');
    assert.equal(m4?.answerId, undefined);

    // Ans-unmatched was matched to Q3 as needs_review, so let's verify unmatched extraction logic
    const standaloneUnmatchedAns = {
      id: 'ans-standalone',
      rawText: 'Orphan answer',
      pages: [1],
      regions: [{ page: 1, x: 0.2, y: 0.2, width: 0.5, height: 0.2 }],
    };
    asm.answers.push(standaloneUnmatchedAns);

    const updatedMappedIds = new Set(asm.mappings.map((m) => m.answerId).filter(Boolean));
    const updatedUnmatched = asm.answers.filter((a) => !updatedMappedIds.has(a.id));

    assert.equal(updatedUnmatched.length, 1);
    assert.equal(updatedUnmatched[0].id, 'ans-standalone');
  });

  it('9. normalized coordinates are strictly bounded 0..1 for percentage styling in HighlightOverlay', () => {
    const asm = setupMockCompletedAssessment(assessmentId);
    for (const ans of asm.answers) {
      for (const reg of ans.regions) {
        assert.ok(reg.x >= 0 && reg.x <= 1, `x must be 0..1 (got ${reg.x})`);
        assert.ok(reg.y >= 0 && reg.y <= 1, `y must be 0..1 (got ${reg.y})`);
        assert.ok(reg.width >= 0 && reg.width <= 1, `width must be 0..1 (got ${reg.width})`);
        assert.ok(reg.height >= 0 && reg.height <= 1, `height must be 0..1 (got ${reg.height})`);
        assert.ok(reg.x + reg.width <= 1.01, `x + width must be <= 1 (got ${reg.x + reg.width})`);
        assert.ok(reg.y + reg.height <= 1.01, `y + height must be <= 1 (got ${reg.y + reg.height})`);
      }
    }
  });

  // --------------------------------------------------------------------------
  // 5. Security Check: No LLM_API_KEY exposed in client environment
  // --------------------------------------------------------------------------
  it('10. LLM_API_KEY and GEMINI_API_KEY are server-side only and never exposed via NEXT_PUBLIC_ prefixes', () => {
    const envKeys = Object.keys(process.env);
    const leakedPublicAiKeys = envKeys.filter(
      (k) => k.startsWith('NEXT_PUBLIC_') && (k.includes('API_KEY') || k.includes('GEMINI') || k.includes('LLM'))
    );
    assert.equal(leakedPublicAiKeys.length, 0, `Found public AI keys: ${leakedPublicAiKeys.join(', ')}`);
  });
});
