import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentStore } from '../lib/store';
import { rasterStore, RasterizedPage } from '../lib/raster';
import { processAssessment, clearInFlightAssessments } from '../lib/pipeline';
import {
  DocumentAIProvider,
  PageImageInput,
  RawQuestionExtraction,
  RawAnswerBlock,
  SemanticQuestionCandidate,
  SemanticAnswerCandidate,
  SemanticMappingDecision,
} from '../lib/ai';
import { AssessmentSchema } from '../lib/validation/schemas';
import { Assessment } from '../lib/domain/types';

class MockPipelineAIProvider implements DocumentAIProvider {
  public questionExtractions: RawQuestionExtraction[] = [];
  public answerBlocks: RawAnswerBlock[] = [];
  public semanticDecisions: SemanticMappingDecision[] = [];

  public failQuestions: boolean = false;
  public failAnswers: boolean = false;
  public failSemantic: boolean = false;

  public extractQuestionsCalls: number = 0;
  public extractAnswersCalls: number = 0;
  public resolveSemanticCalls: number = 0;

  async extractQuestionsFromImages(pages: PageImageInput[]): Promise<RawQuestionExtraction[]> {
    this.extractQuestionsCalls++;
    if (this.failQuestions) {
      throw new Error('Simulated question extraction failure with API_KEY_AIzaSyFakeSecret123456789012345678');
    }
    return this.questionExtractions;
  }

  async extractAnswersFromImages(pages: PageImageInput[]): Promise<RawAnswerBlock[]> {
    this.extractAnswersCalls++;
    if (this.failAnswers) {
      throw new Error('Simulated answer extraction failure with Bearer sk-secrettoken123');
    }
    return this.answerBlocks;
  }

  async resolveSemanticMappings(
    questions: SemanticQuestionCandidate[],
    answers: SemanticAnswerCandidate[]
  ): Promise<SemanticMappingDecision[]> {
    this.resolveSemanticCalls++;
    if (this.failSemantic) {
      throw new Error('Simulated semantic fallback failure');
    }
    return this.semanticDecisions;
  }
}

function createDummyRasterPage(pageNumber: number): RasterizedPage {
  return {
    pageNumber,
    width: 800,
    height: 1000,
    mimeType: 'image/png',
    imageBuffer: Buffer.from(`fake-png-buffer-page-${pageNumber}`),
  };
}


function setupTestAssessment(assessmentId: string, qpPagesCount = 1, asPagesCount = 1): Assessment {
  const qpPages = Array.from({ length: qpPagesCount }, (_, i) => createDummyRasterPage(i + 1));
  const asPages = Array.from({ length: asPagesCount }, (_, i) => createDummyRasterPage(i + 1));

  rasterStore.savePages(assessmentId, 'question_paper', qpPages);
  rasterStore.savePages(assessmentId, 'answer_sheet', asPages);

  return assessmentStore.create({
    id: assessmentId,
    status: 'queued',
    questionPaper: {
      id: `qp-doc-${assessmentId}`,
      filename: 'qp.pdf',
      mimeType: 'application/pdf',
      pageCount: qpPagesCount,
      pages: qpPages.map((p) => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        imageUrl: `/api/assessment/${assessmentId}/page/question_paper/${p.pageNumber}`,
      })),
    },
    answerSheet: {
      id: `as-doc-${assessmentId}`,
      filename: 'as.pdf',
      mimeType: 'application/pdf',
      pageCount: asPagesCount,
      pages: asPages.map((p) => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        imageUrl: `/api/assessment/${assessmentId}/page/answer_sheet/${p.pageNumber}`,
      })),
    },
    questions: [],
    answers: [],
    mappings: [],
  });
}

describe('Phase 3C-C: End-to-End Processing Pipeline Orchestration', () => {
  let mockProvider: MockPipelineAIProvider;

  beforeEach(() => {
    assessmentStore.clear();
    rasterStore.clear();
    clearInFlightAssessments();
    mockProvider = new MockPipelineAIProvider();
  });

  // --------------------------------------------------------------------------
  // 1. Successful Complete Pipeline Lifecycle
  // --------------------------------------------------------------------------
  it('1. successful pipeline transitions through all canonical stages and reaches completed state', async () => {
    const assessmentId = 'test-asm-1';
    setupTestAssessment(assessmentId, 1, 2);

    mockProvider.questionExtractions = [
      { number: '1', text: 'Solve recurrence relation' },
      { number: '2', text: 'Explain dynamic programming' },
    ];

    mockProvider.answerBlocks = [
      {
        page: 1,
        detectedQuestionReference: 'Q1',
        text: 'Recurrence tree solution',
        box_2d: [100, 100, 400, 900],
        confidence: 0.95,
      },
      {
        page: 2,
        detectedQuestionReference: 'Q2',
        text: 'Memoization table DP solution',
        box_2d: [100, 100, 500, 900],
        confidence: 0.9,
      },
    ];


    const stageHistory: string[] = [];
    const origUpdate = assessmentStore.update.bind(assessmentStore);
    assessmentStore.update = (id, patch) => {
      if (patch.status) {
        stageHistory.push(patch.status);
      }
      return origUpdate(id, patch);
    };

    const finalAssessment = await processAssessment(assessmentId, {
      provider: mockProvider,
    });

    assert.equal(finalAssessment.status, 'completed');
    assert.equal(finalAssessment.questions.length, 2);
    assert.equal(finalAssessment.answers.length, 2);
    assert.equal(finalAssessment.mappings.length, 2);

    // Verify stage progression:
    // queued -> reading_question_paper -> extracting_questions -> reading_answer_sheet -> detecting_answers -> mapping_answers -> finalizing -> completed
    assert.deepEqual(stageHistory, [
      'reading_question_paper',
      'extracting_questions',
      'reading_answer_sheet',
      'detecting_answers',
      'mapping_answers',
      'finalizing',
      'completed',
    ]);

    // Verify full Assessment schema validity
    assert.doesNotThrow(() => AssessmentSchema.parse(finalAssessment));
  });

  // --------------------------------------------------------------------------
  // 2. Question Extraction Failure
  // --------------------------------------------------------------------------
  it('2. question extraction failure transitions assessment to status "failed" with sanitized error', async () => {
    const assessmentId = 'test-asm-q-fail';
    setupTestAssessment(assessmentId, 1, 1);

    mockProvider.failQuestions = true;

    const failed = await processAssessment(assessmentId, {
      provider: mockProvider,
    });

    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'QUESTION_EXTRACTION_FAILED');
    assert.ok(failed.errorMessage);
    // Ensure API keys are redacted in error message
    assert.equal(failed.errorMessage.includes('AIzaSyFakeSecret'), false);
    assert.ok(failed.errorMessage.includes('[REDACTED_API_KEY]'));
  });

  // --------------------------------------------------------------------------
  // 3. Answer Extraction Failure
  // --------------------------------------------------------------------------
  it('3. answer extraction failure transitions assessment to status "failed" with sanitized error', async () => {
    const assessmentId = 'test-asm-a-fail';
    setupTestAssessment(assessmentId, 1, 1);

    mockProvider.questionExtractions = [
      { number: '1', text: 'Solve problem 1' },
    ];
    mockProvider.failAnswers = true;

    const failed = await processAssessment(assessmentId, {
      provider: mockProvider,
    });

    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'ANSWER_EXTRACTION_FAILED');
    assert.ok(failed.errorMessage);
    // Ensure Bearer tokens are redacted
    assert.equal(failed.errorMessage.includes('sk-secrettoken'), false);
    assert.ok(failed.errorMessage.includes('[REDACTED_TOKEN]'));
  });

  // --------------------------------------------------------------------------
  // 4. Missing Raster Pages Failure
  // --------------------------------------------------------------------------
  it('4. missing raster pages transitions assessment to status "failed"', async () => {
    const assessmentId = 'test-asm-no-raster';
    // Create assessment record without storing raster pages
    assessmentStore.create({
      id: assessmentId,
      status: 'queued',
      questionPaper: {
        id: 'qp-doc',
        filename: 'qp.pdf',
        mimeType: 'application/pdf',
        pageCount: 1,
      },
      answerSheet: {
        id: 'as-doc',
        filename: 'as.pdf',
        mimeType: 'application/pdf',
        pageCount: 1,
      },
      questions: [],
      answers: [],
      mappings: [],
    });

    const failed = await processAssessment(assessmentId, {
      provider: mockProvider,
    });

    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'QUESTION_EXTRACTION_FAILED');
    assert.ok(failed.errorMessage?.includes('No question paper pages found'));
  });

  // --------------------------------------------------------------------------
  // 5. Semantic Provider Graceful Fallback
  // --------------------------------------------------------------------------
  it('5. semantic provider failure gracefully preserves deterministic mappings and completes successfully', async () => {
    const assessmentId = 'test-asm-sem-fallback';
    setupTestAssessment(assessmentId, 1, 1);

    mockProvider.questionExtractions = [
      { number: '1', text: 'Question 1' },
    ];
    mockProvider.answerBlocks = [
      {
        page: 1,
        detectedQuestionReference: 'Q1',
        text: 'Solution 1',
        box_2d: [100, 100, 500, 900],
        confidence: 0.9,
      },
    ];
    mockProvider.failSemantic = true;

    const completed = await processAssessment(assessmentId, {
      provider: mockProvider,
    });

    assert.equal(completed.status, 'completed');
    assert.equal(completed.mappings.length, 1);
    assert.equal(completed.mappings[0].method, 'explicit_reference');
    assert.equal(completed.mappings[0].status, 'matched');
  });

  // --------------------------------------------------------------------------
  // 6. Unknown Assessment ID Handling
  // --------------------------------------------------------------------------
  it('6. unknown assessment ID throws error without fabricating records in store', async () => {
    await assert.rejects(
      async () => {
        await processAssessment('non-existent-id-999', { provider: mockProvider });
      },
      /Assessment not found/
    );

    assert.equal(assessmentStore.get('non-existent-id-999'), undefined);
    assert.equal(assessmentStore.getAll().length, 0);
  });

  // --------------------------------------------------------------------------
  // 7. Duplicate Concurrent Calls Protection
  // --------------------------------------------------------------------------
  it('7. concurrent duplicate processAssessment calls execute pipeline only once', async () => {
    const assessmentId = 'test-asm-concurrent';
    setupTestAssessment(assessmentId, 1, 1);

    mockProvider.questionExtractions = [
      { number: '1', text: 'Question 1' },
    ];
    mockProvider.answerBlocks = [
      {
        page: 1,
        detectedQuestionReference: 'Q1',
        text: 'Solution 1',
        box_2d: [100, 100, 500, 900],
        confidence: 0.9,
      },
    ];

    // Trigger two concurrent processAssessment calls
    const [res1, res2] = await Promise.all([
      processAssessment(assessmentId, { provider: mockProvider }),
      processAssessment(assessmentId, { provider: mockProvider }),
    ]);

    assert.ok(res1);
    assert.ok(res2);
    // Mock extract questions was called only once across both concurrent requests
    assert.equal(mockProvider.extractQuestionsCalls, 1);
    assert.equal(mockProvider.extractAnswersCalls, 1);
  });

  // --------------------------------------------------------------------------
  // 8. Already Completed / Failed Idempotency
  // --------------------------------------------------------------------------
  it('8. already-completed assessment returns immediately without doing redundant work', async () => {
    const assessmentId = 'test-asm-completed';
    const asm = setupTestAssessment(assessmentId, 1, 1);
    assessmentStore.update(assessmentId, { status: 'completed' });

    const res = await processAssessment(assessmentId, { provider: mockProvider });
    assert.equal(res.status, 'completed');
    assert.equal(mockProvider.extractQuestionsCalls, 0);
    assert.equal(mockProvider.extractAnswersCalls, 0);
  });

  it('8b. already-failed assessment returns immediately without re-running', async () => {
    const assessmentId = 'test-asm-failed';
    setupTestAssessment(assessmentId, 1, 1);
    assessmentStore.update(assessmentId, {
      status: 'failed',
      errorCode: 'PREVIOUS_ERROR',
      errorMessage: 'Fatal error',
    });

    const res = await processAssessment(assessmentId, { provider: mockProvider });
    assert.equal(res.status, 'failed');
    assert.equal(res.errorCode, 'PREVIOUS_ERROR');
    assert.equal(mockProvider.extractQuestionsCalls, 0);
  });

  // --------------------------------------------------------------------------
  // 9. Every Question Has Exactly One Mapping Record & Unmatched Answers Represented
  // --------------------------------------------------------------------------
  it('9. every question has exactly one mapping and unmatched answers are accessible', async () => {
    const assessmentId = 'test-asm-coverage';
    setupTestAssessment(assessmentId, 1, 2);

    mockProvider.questionExtractions = [
      { number: '1', text: 'Problem 1' },
      { number: '2', text: 'Problem 2' },
      { number: '3', text: 'Problem 3' },
    ];

    mockProvider.answerBlocks = [
      {
        page: 1,
        detectedQuestionReference: 'Q1',
        text: 'Ans 1',
        box_2d: [100, 100, 400, 900],
        confidence: 0.9,
      },
      {
        page: 2,
        detectedQuestionReference: 'Q99', // unmatched answer referencing non-existent question
        text: 'Ans 99',
        box_2d: [100, 100, 400, 900],
        confidence: 0.9,
      },
    ];

    const completed = await processAssessment(assessmentId, {
      provider: mockProvider,
    });

    assert.equal(completed.status, 'completed');
    assert.equal(completed.questions.length, 3);
    assert.equal(completed.answers.length, 2);
    assert.equal(completed.mappings.length, 3);

    // Question 1 mapped
    const m1 = completed.mappings.find((m) => m.questionId === completed.questions[0].id);
    assert.ok(m1);
    assert.equal(m1.status, 'matched');

    // Questions 2 and 3 both receive candidate A2 as needs_review (structural Case C fallback)
    const m2 = completed.mappings.find((m) => m.questionId === completed.questions[1].id);
    assert.ok(m2);
    assert.equal(m2.status, 'needs_review');

    const m3 = completed.mappings.find((m) => m.questionId === completed.questions[2].id);
    assert.ok(m3);
    assert.equal(m3.status, 'needs_review');


    // Unmatched Answer 99 remains in answers array
    assert.ok(completed.answers.some((a) => a.detectedQuestionReference === '99' || a.detectedQuestionReference === 'Q99'));


  });

  // --------------------------------------------------------------------------
  // 10. Deterministic Mappings Never Overwritten by Semantic Fallback
  // --------------------------------------------------------------------------
  it('10. deterministic explicit mapping is never overwritten by semantic AI during pipeline execution', async () => {
    const assessmentId = 'test-asm-deterministic-win';
    setupTestAssessment(assessmentId, 1, 2);

    mockProvider.questionExtractions = [
      { number: '1', text: 'Problem 1' },
      { number: '2', text: 'Problem 2' },
      { number: '3', text: 'Problem 3' },
    ];

    mockProvider.answerBlocks = [
      {
        page: 1,
        detectedQuestionReference: 'Q1',
        text: 'Solution 1',
        box_2d: [100, 100, 400, 900],
        confidence: 0.95,
      },
      {
        page: 2,
        detectedQuestionReference: null,
        text: 'Solution for problem 2',
        box_2d: [100, 100, 400, 900],
        confidence: 0.9,
      },
    ];

    // Mock AI resolves unassigned answer 2 to question 2
    mockProvider.semanticDecisions = [
      {
        answerId: 'will-match-a2',
        questionId: 'q2',
        confidence: 0.91,
      },
    ];

    const completed = await processAssessment(assessmentId, {
      provider: mockProvider,
    });

    assert.equal(completed.status, 'completed');
    // Q1 remains explicit_reference
    assert.equal(completed.mappings[0].method, 'explicit_reference');
    assert.equal(completed.mappings[0].status, 'matched');
  });

  // --------------------------------------------------------------------------
  // 11. Final Validation Failure
  // --------------------------------------------------------------------------
  it('11. corrupted data violating final validation transitions assessment to status "failed"', async () => {
    const assessmentId = 'test-asm-val-fail';
    setupTestAssessment(assessmentId, 1, 1);

    mockProvider.questionExtractions = [
      { number: '1', text: 'Problem 1' },
    ];
    mockProvider.answerBlocks = [
      {
        page: 1,
        detectedQuestionReference: 'Q1',
        text: 'Solution 1',
        box_2d: [100, 100, 400, 900],
        confidence: 0.95,
      },
    ];

    // Simulate an unexpected corruption of mappings right before finalization
    const origGet = assessmentStore.get.bind(assessmentStore);
    let stageCount = 0;
    assessmentStore.get = (id: string) => {
      const result = origGet(id);
      if (result && result.status === 'finalizing') {
        stageCount++;
        // Inject an invalid mapping with unknown question ID
        return {
          ...result,
          mappings: [
            {
              questionId: 'phantom-question-id-999',
              answerId: result.answers[0]?.id,
              confidence: 0.9,
              status: 'matched' as const,
              method: 'explicit_reference' as const,
            },
          ],
        };
      }
      return result;
    };

    const failed = await processAssessment(assessmentId, {
      provider: mockProvider,
    });

    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'VALIDATION_FAILED');
    assert.ok(failed.errorMessage?.includes('Mapping contains unknown questionId'));
  });
});

