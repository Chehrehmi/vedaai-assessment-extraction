import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { assessmentStore } from '../lib/store';
import { rasterStore } from '../lib/raster';
import {
  DEMO_ASSESSMENT_ID,
  isDemoAssessment,
  ensureDemoAssessmentLoaded,
  DEMO_ANSWERS,
} from '../lib/demo';
import { AssessmentSchema } from '../lib/validation/schemas';
import { POST as demoPostHandler, GET as demoGetHandler } from '../app/api/assessment/demo/route';
import { GET as getAssessmentHandler } from '../app/api/assessment/[id]/route';
import { GET as getStatusHandler } from '../app/api/assessment/[id]/status/route';
import { GET as getPageHandler } from '../app/api/assessment/[id]/page/[docType]/[pageNumber]/route';

describe('Demo Assessment Feature Suite', () => {
  beforeEach(() => {
    assessmentStore.clear();
    rasterStore.clear();
  });

  it('1. isDemoAssessment correctly identifies demo IDs', () => {
    assert.strictEqual(isDemoAssessment('demo-cbse-maths-assessment'), true);
    assert.strictEqual(isDemoAssessment('demo-sample-123'), true);
    assert.strictEqual(isDemoAssessment('custom-uuid-1234'), false);
    assert.strictEqual(isDemoAssessment('asmt-86049b4a'), false);
  });

  it('2. ensureDemoAssessmentLoaded creates a valid Assessment strictly matching schema', async () => {
    const assessment = await ensureDemoAssessmentLoaded();

    assert.strictEqual(assessment.id, DEMO_ASSESSMENT_ID);
    assert.strictEqual(assessment.status, 'completed');
    assert.strictEqual(assessment.questions.length, 16);
    assert.strictEqual(assessment.answers.length, 2);
    assert.strictEqual(assessment.mappings.length, 16);

    // Validate against strict Zod schema
    const validated = AssessmentSchema.parse(assessment);
    assert.strictEqual(validated.id, DEMO_ASSESSMENT_ID);
  });

  it('3. DEMO_MAPPINGS accurately reflects 2 matched and 14 unanswered questions', async () => {
    const assessment = await ensureDemoAssessmentLoaded();

    const matched = assessment.mappings.filter((m) => m.status === 'matched');
    const unanswered = assessment.mappings.filter((m) => m.status === 'unanswered');

    assert.strictEqual(matched.length, 2);
    assert.strictEqual(unanswered.length, 14);

    // Q1 and Q2 are matched to answers with high confidence
    assert.strictEqual(matched[0].questionId, assessment.questions[0].id);
    assert.strictEqual(matched[0].answerId, 'demo-ans-1');
    assert.strictEqual(matched[0].method, 'explicit_reference');
    assert.ok(matched[0].confidence >= 0.95);

    assert.strictEqual(matched[1].questionId, assessment.questions[1].id);
    assert.strictEqual(matched[1].answerId, 'demo-ans-2');
    assert.strictEqual(matched[1].method, 'explicit_reference');
    assert.ok(matched[1].confidence >= 0.95);
  });

  it('4. Multi-page handwritten answers maintain accurate spatial regions and page spans', async () => {
    const assessment = await ensureDemoAssessmentLoaded();

    const ans1 = assessment.answers.find((a) => a.id === 'demo-ans-1');
    assert.ok(ans1);
    assert.deepStrictEqual(ans1.pages, [1, 2]);
    assert.strictEqual(ans1.regions.length, 2);
    assert.strictEqual(ans1.regions[0].page, 1);
    assert.strictEqual(ans1.regions[1].page, 2);

    const ans2 = assessment.answers.find((a) => a.id === 'demo-ans-2');
    assert.ok(ans2);
    assert.deepStrictEqual(ans2.pages, [2, 3]);
    assert.strictEqual(ans2.regions.length, 2);
    assert.strictEqual(ans2.regions[0].page, 2);
    assert.strictEqual(ans2.regions[1].page, 3);
  });

  it('5. RasterStore retains all 6 high-resolution pages for question paper and answer sheet', async () => {
    await ensureDemoAssessmentLoaded();

    assert.strictEqual(rasterStore.count(), 6);

    for (let p = 1; p <= 3; p++) {
      const qpPage = rasterStore.getPage(DEMO_ASSESSMENT_ID, 'question_paper', p);
      assert.ok(qpPage, `QP page ${p} should exist`);
      assert.strictEqual(qpPage.pageNumber, p);
      assert.ok(qpPage.imageBuffer.length > 1000);

      const asPage = rasterStore.getPage(DEMO_ASSESSMENT_ID, 'answer_sheet', p);
      assert.ok(asPage, `AS page ${p} should exist`);
      assert.strictEqual(asPage.pageNumber, p);
      assert.ok(asPage.imageBuffer.length > 1000);
    }
  });

  it('6. ensureDemoAssessmentLoaded is idempotent and reuses existing store record without re-rasterizing', async () => {
    const first = await ensureDemoAssessmentLoaded();
    const second = await ensureDemoAssessmentLoaded();

    assert.strictEqual(first.id, second.id);
    assert.strictEqual(first.createdAt, second.createdAt);
    assert.strictEqual(rasterStore.count(), 6);
  });

  it('7. POST /api/assessment/demo returns HTTP 200 with completed status and demo assessmentId', async () => {
    const req = new NextRequest('http://localhost:3000/api/assessment/demo', { method: 'POST' });
    const res = await demoPostHandler(req);

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.assessmentId, DEMO_ASSESSMENT_ID);
    assert.strictEqual(data.status, 'completed');
  });

  it('8. GET /api/assessment/[id] auto-hydrates demo assessment when requested by ID', async () => {
    // Start with empty store
    assert.strictEqual(assessmentStore.get(DEMO_ASSESSMENT_ID), undefined);

    const req = new NextRequest(`http://localhost:3000/api/assessment/${DEMO_ASSESSMENT_ID}`);
    const res = await getAssessmentHandler(req, { params: Promise.resolve({ id: DEMO_ASSESSMENT_ID }) });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.id, DEMO_ASSESSMENT_ID);
    assert.strictEqual(data.status, 'completed');
    assert.strictEqual(data.questions.length, 16);
  });

  it('9. GET /api/assessment/[id]/status returns completed status for demo assessment', async () => {
    const req = new NextRequest(`http://localhost:3000/api/assessment/${DEMO_ASSESSMENT_ID}/status`);
    const res = await getStatusHandler(req, { params: Promise.resolve({ id: DEMO_ASSESSMENT_ID }) });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.id, DEMO_ASSESSMENT_ID);
    assert.strictEqual(data.status, 'completed');
    assert.strictEqual(data.questionCount, 16);
    assert.strictEqual(data.answerCount, 2);
  });

  it('10. GET /api/assessment/[id]/page/[docType]/[pageNumber] returns image/png for demo assessment', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/assessment/${DEMO_ASSESSMENT_ID}/page/answer_sheet/1`
    );
    const res = await getPageHandler(req, {
      params: Promise.resolve({
        id: DEMO_ASSESSMENT_ID,
        docType: 'answer_sheet',
        pageNumber: '1',
      }),
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'image/png');
    const buffer = await res.arrayBuffer();
    assert.ok(buffer.byteLength > 1000);
  });
});
