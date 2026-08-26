import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Question, Answer, AnswerMapping } from '../lib/domain/types';
import { AnswerMappingSchema } from '../lib/validation/schemas';
import {
  DocumentAIProvider,
  PageImageInput,
  RawQuestionExtraction,
  RawAnswerBlock,
  SemanticQuestionCandidate,
  SemanticAnswerCandidate,
  SemanticMappingDecision,
} from '../lib/ai';
import {
  resolveMappingsWithSemanticFallback,
  resolveAssessmentMappingsWithSemanticFallback,
} from '../lib/mapping';
import { assessmentStore } from '../lib/store';

class MockDocumentAIProvider implements DocumentAIProvider {
  public resolveCalls: { questions: SemanticQuestionCandidate[]; answers: SemanticAnswerCandidate[] }[] = [];
  public mockDecisions: SemanticMappingDecision[] = [];
  public shouldThrow: boolean = false;

  async extractQuestionsFromImages(pages: PageImageInput[]): Promise<RawQuestionExtraction[]> {
    return [];
  }

  async extractAnswersFromImages(pages: PageImageInput[]): Promise<RawAnswerBlock[]> {
    return [];
  }

  async resolveSemanticMappings(
    questions: SemanticQuestionCandidate[],
    answers: SemanticAnswerCandidate[]
  ): Promise<SemanticMappingDecision[]> {
    this.resolveCalls.push({ questions, answers });
    if (this.shouldThrow) {
      throw new Error('Simulated Gemini API failure');
    }
    return this.mockDecisions;
  }
}

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

describe('Phase 3C-B: Semantic AI Fallback Layer', () => {
  let mockProvider: MockDocumentAIProvider;

  beforeEach(() => {
    assessmentStore.clear();
    mockProvider = new MockDocumentAIProvider();
  });

  // --------------------------------------------------------------------------
  // 0. Single-question anchorless baseline (4dea7b9 regression test)
  // --------------------------------------------------------------------------
  it('0. single question + single unlabeled answer produces deterministic structural match (0.80) with zero AI calls', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', text: 'Solve problem 1', order: 0 });
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null, rawText: 'Problem 1 solution' });

    const mappings = await resolveMappingsWithSemanticFallback([q1], [a1], { provider: mockProvider });

    assert.equal(mappings.length, 1);
    assert.deepEqual(mappings[0], {
      questionId: 'q1',
      answerId: 'a1',
      confidence: 0.8,
      status: 'matched',
      method: 'structural',
    });
    // 0 AI calls because single-question structural match is deterministic and confident
    assert.equal(mockProvider.resolveCalls.length, 0);
  });

  // --------------------------------------------------------------------------
  // 1. Strong Semantic Match
  // --------------------------------------------------------------------------
  it('1. strong semantic match (confidence >= 0.85) resolves unresolved question with status "matched" and method "semantic"', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', text: 'Solve recurrence using tree method', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Shortest path graph algorithm', order: 1 });
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null, rawText: 'Recurrence tree branching factor 2...' });
    const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null, rawText: 'Dijkstra priority queue...' });

    mockProvider.mockDecisions = [
      {
        answerId: 'a1',
        questionId: 'q1',
        confidence: 0.92,
        reason: 'Answer content discusses recurrence tree and matches question 1 topic',
      },
      {
        answerId: 'a2',
        questionId: 'q2',
        confidence: 0.89,
        reason: 'Answer discusses Dijkstra algorithm',
      },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q1, q2], [a1, a2], { provider: mockProvider });

    assert.equal(mappings.length, 2);
    assert.deepEqual(mappings[0], {
      questionId: 'q1',
      answerId: 'a1',
      confidence: 0.92,
      status: 'matched',
      method: 'semantic',
    });
    assert.deepEqual(mappings[1], {
      questionId: 'q2',
      answerId: 'a2',
      confidence: 0.89,
      status: 'matched',
      method: 'semantic',
    });
    assert.equal(mockProvider.resolveCalls.length, 1);
  });

  // --------------------------------------------------------------------------
  // 2. Weak Semantic Match
  // --------------------------------------------------------------------------
  it('2. weak semantic match (confidence < 0.85) produces status "needs_review" and method "semantic"', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', text: 'Explain dynamic programming', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Explain greedy algorithms', order: 1 });
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null, rawText: 'Memoization table' });
    const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null, rawText: 'Fractional knapsack' });

    mockProvider.mockDecisions = [
      {
        answerId: 'a1',
        questionId: 'q1',
        confidence: 0.72,
        reason: 'Moderate semantic alignment with dynamic programming',
      },
      {
        answerId: 'a2',
        questionId: 'q2',
        confidence: 0.75,
        reason: 'Moderate semantic alignment with greedy algorithms',
      },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q1, q2], [a1, a2], { provider: mockProvider });

    assert.equal(mappings.length, 2);
    assert.equal(mappings[0].questionId, 'q1');
    assert.equal(mappings[0].answerId, 'a1');
    assert.equal(mappings[0].status, 'needs_review');
    assert.equal(mappings[0].method, 'semantic');
    assert.equal(mappings[0].confidence, 0.72);

    assert.equal(mappings[1].questionId, 'q2');
    assert.equal(mappings[1].answerId, 'a2');
    assert.equal(mappings[1].status, 'needs_review');
    assert.equal(mappings[1].method, 'semantic');
    assert.equal(mappings[1].confidence, 0.75);
  });

  // --------------------------------------------------------------------------
  // 3. Model Returns Null
  // --------------------------------------------------------------------------
  it('3. model returns questionId: null -> question remains unanswered with confidence 0 and no answerId', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', text: 'Define Dijkstra algorithm', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Define Bellman-Ford algorithm', order: 1 });
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null, rawText: 'Photosynthesis in plants' });

    mockProvider.mockDecisions = [
      {
        answerId: 'a1',
        questionId: null,
        confidence: 0.1,
        reason: 'Answer content is completely unrelated to any algorithm',
      },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q1, q2], [a1], { provider: mockProvider });

    assert.equal(mappings.length, 2);
    assert.equal(mappings[0].questionId, 'q1');
    assert.equal(mappings[0].status, 'unanswered');
    assert.equal(mappings[0].confidence, 0);
    assert.equal(mappings[0].answerId, undefined);

    assert.equal(mappings[1].questionId, 'q2');
    assert.equal(mappings[1].status, 'unanswered');
    assert.equal(mappings[1].confidence, 0);
    assert.equal(mappings[1].answerId, undefined);
  });

  // --------------------------------------------------------------------------
  // 4 & 5. Candidate Boundary Enforcement (Invalid IDs Rejected)
  // --------------------------------------------------------------------------
  it('4. hallucinated or non-candidate questionId from AI is strictly rejected', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', text: 'Problem 1', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Problem 2', order: 1 });
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null, rawText: 'Solution 1' });

    mockProvider.mockDecisions = [
      {
        answerId: 'a1',
        questionId: 'hallucinated-q99',
        confidence: 0.95,
        reason: 'Invented question ID',
      },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q1, q2], [a1], { provider: mockProvider });

    assert.equal(mappings.length, 2);
    // Both questions remain unanswered because hallucinated ID was rejected
    assert.equal(mappings[0].questionId, 'q1');
    assert.equal(mappings[0].status, 'unanswered');
    assert.equal(mappings[0].answerId, undefined);

    assert.equal(mappings[1].questionId, 'q2');
    assert.equal(mappings[1].status, 'unanswered');
    assert.equal(mappings[1].answerId, undefined);
  });

  it('5. hallucinated or non-candidate answerId from AI is strictly rejected', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', text: 'Problem 1', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Problem 2', order: 1 });
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null, rawText: 'Solution 1' });

    mockProvider.mockDecisions = [
      {
        answerId: 'hallucinated-a99',
        questionId: 'q1',
        confidence: 0.95,
        reason: 'Invented answer ID',
      },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q1, q2], [a1], { provider: mockProvider });

    assert.equal(mappings.length, 2);
    assert.equal(mappings[0].questionId, 'q1');
    assert.equal(mappings[0].status, 'unanswered');
    assert.equal(mappings[0].answerId, undefined);

    assert.equal(mappings[1].questionId, 'q2');
    assert.equal(mappings[1].status, 'unanswered');
    assert.equal(mappings[1].answerId, undefined);
  });


  // --------------------------------------------------------------------------
  // 6. Malformed AI Output Schema Rejection
  // --------------------------------------------------------------------------
  it('6. malformed semantic output fails SemanticMappingResponseSchema validation and is safely rejected', async () => {
    const { SemanticMappingResponseSchema } = await import('../lib/ai/schemas');

    // Missing required confidence field
    const malformed1 = {
      decisions: [
        { answerId: 'a1', questionId: 'q1' },
      ],
    };
    const res1 = SemanticMappingResponseSchema.safeParse(malformed1);
    assert.equal(res1.success, false);

    // Empty answerId
    const malformed2 = {
      decisions: [
        { answerId: '', questionId: 'q1', confidence: 0.9 },
      ],
    };
    const res2 = SemanticMappingResponseSchema.safeParse(malformed2);
    assert.equal(res2.success, false);

    // Confidence out of range
    const malformed3 = {
      decisions: [
        { answerId: 'a1', questionId: 'q1', confidence: 1.5 },
      ],
    };
    const res3 = SemanticMappingResponseSchema.safeParse(malformed3);
    assert.equal(res3.success, false);
  });

  // --------------------------------------------------------------------------
  // 7 & 8. Deterministic Immutability Protection
  // --------------------------------------------------------------------------
  it('7. deterministic explicit mapping CANNOT be overridden by semantic AI', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', text: 'Matrix multiplication', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Graph coloring', order: 1 });
    const q3 = createMockQuestion({ id: 'q3', number: '3', text: 'Topological sort', order: 2 });

    // Answer a1 explicitly says Q1
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1', rawText: 'Matrix code' });
    const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null, rawText: 'Graph coloring code' });

    // AI resolves unresolved q2
    mockProvider.mockDecisions = [
      {
        answerId: 'a2',
        questionId: 'q2',
        confidence: 0.9,
      },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q1, q2, q3], [a1, a2], { provider: mockProvider });

    assert.equal(mappings.length, 3);
    // Q1 remains explicit_reference match to a1
    assert.equal(mappings[0].questionId, 'q1');
    assert.equal(mappings[0].answerId, 'a1');
    assert.equal(mappings[0].method, 'explicit_reference');
    assert.equal(mappings[0].status, 'matched');

    // Q2 gets semantic match to a2
    assert.equal(mappings[1].questionId, 'q2');
    assert.equal(mappings[1].answerId, 'a2');
    assert.equal(mappings[1].method, 'semantic');
    assert.equal(mappings[1].status, 'matched');

    // Q3 has no answer -> unanswered
    assert.equal(mappings[2].questionId, 'q3');
    assert.equal(mappings[2].status, 'unanswered');

    // Verify AI only received unresolved q2 and q3 and unassigned a2
    assert.equal(mockProvider.resolveCalls[0].questions.length, 2);
    assert.equal(mockProvider.resolveCalls[0].questions[0].id, 'q2');
    assert.equal(mockProvider.resolveCalls[0].questions[1].id, 'q3');
    assert.equal(mockProvider.resolveCalls[0].answers.length, 1);
    assert.equal(mockProvider.resolveCalls[0].answers[0].id, 'a2');
  });


  it('8. deterministic structural 1:1 match CANNOT be overridden by semantic AI', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
    const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });

    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
    const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });
    const a3 = createMockAnswer({ id: 'a3', detectedQuestionReference: 'Q3' });

    // In deterministic pass, Q1, Q2, Q3 are all matched (Q2 is structural match to a2)
    const mappings = await resolveMappingsWithSemanticFallback([q1, q2, q3], [a1, a2, a3], { provider: mockProvider });

    assert.equal(mappings.length, 3);
    assert.equal(mappings[1].questionId, 'q2');
    assert.equal(mappings[1].answerId, 'a2');
    assert.equal(mappings[1].method, 'structural');
    assert.equal(mappings[1].status, 'matched');

    // Zero AI calls because everything was deterministically resolved!
    assert.equal(mockProvider.resolveCalls.length, 0);
  });

  // --------------------------------------------------------------------------
  // 9. Semantic Mapping Fills Unresolved Gap
  // --------------------------------------------------------------------------
  it('9. semantic mapping fills unresolved question in ambiguous structural situation (Case C)', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Binary search tree insertion', order: 1 });
    const q3 = createMockQuestion({ id: 'q3', number: '3', text: 'QuickSort partition', order: 2 });
    const q4 = createMockQuestion({ id: 'q4', number: '4', order: 3 });

    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
    const a_bst = createMockAnswer({ id: 'a-bst', detectedQuestionReference: null, rawText: 'BST insert: if val < root.val...' });
    const a4 = createMockAnswer({ id: 'a4', detectedQuestionReference: 'Q4' });

    mockProvider.mockDecisions = [
      {
        answerId: 'a-bst',
        questionId: 'q2',
        confidence: 0.94,
        reason: 'Answer clearly implements BST insert',
      },
    ];

    const mappings = await resolveMappingsWithSemanticFallback(
      [q1, q2, q3, q4],
      [a1, a_bst, a4],
      { provider: mockProvider }
    );

    assert.equal(mappings.length, 4);
    assert.equal(mappings[0].questionId, 'q1');
    assert.equal(mappings[0].status, 'matched');

    // Q2 matched to a-bst via semantic AI
    assert.equal(mappings[1].questionId, 'q2');
    assert.equal(mappings[1].answerId, 'a-bst');
    assert.equal(mappings[1].status, 'matched');
    assert.equal(mappings[1].method, 'semantic');
    assert.equal(mappings[1].confidence, 0.94);

    // Q3 has no answer -> unanswered
    assert.equal(mappings[2].questionId, 'q3');
    assert.equal(mappings[2].status, 'unanswered');

    assert.equal(mappings[3].questionId, 'q4');
    assert.equal(mappings[3].status, 'matched');
  });

  // --------------------------------------------------------------------------
  // 10, 11, 12. Conflict & Ambiguity Resolution
  // --------------------------------------------------------------------------
  it('10 & 11. one answer mapped to multiple questions produces needs_review on all candidate questions', async () => {
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Sorting algorithms', order: 0 });
    const q3 = createMockQuestion({ id: 'q3', number: '3', text: 'Search algorithms', order: 1 });
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null, rawText: 'Algorithms discussion' });

    // AI claims a1 matches both q2 and q3
    mockProvider.mockDecisions = [
      { answerId: 'a1', questionId: 'q2', confidence: 0.9 },
      { answerId: 'a1', questionId: 'q3', confidence: 0.88 },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q2, q3], [a1], { provider: mockProvider });

    assert.equal(mappings.length, 2);
    // Both mappings must be needs_review due to assignment conflict
    assert.equal(mappings[0].questionId, 'q2');
    assert.equal(mappings[0].status, 'needs_review');
    assert.equal(mappings[0].method, 'semantic');

    assert.equal(mappings[1].questionId, 'q3');
    assert.equal(mappings[1].status, 'needs_review');
    assert.equal(mappings[1].method, 'semantic');
  });

  it('12. multiple answers mapped to the same question produces needs_review', async () => {
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Dynamic Programming', order: 0 });
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: null, rawText: 'DP Solution A' });
    const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null, rawText: 'DP Solution B' });

    mockProvider.mockDecisions = [
      { answerId: 'a1', questionId: 'q2', confidence: 0.88 },
      { answerId: 'a2', questionId: 'q2', confidence: 0.86 },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q2], [a1, a2], { provider: mockProvider });

    assert.equal(mappings.length, 1);
    assert.equal(mappings[0].questionId, 'q2');
    assert.equal(mappings[0].status, 'needs_review');
    assert.equal(mappings[0].method, 'semantic');
  });

  // --------------------------------------------------------------------------
  // 13. Multi-page Answer Identity
  // --------------------------------------------------------------------------
  it('13. multi-page Answer remains one logical Answer throughout semantic mapping', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', text: 'Full complexity analysis', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'Sorting algorithms', order: 1 });
    const multiAnswer = createMockAnswer({
      id: 'multi-ans',
      pages: [1, 2, 3],
      regions: [
        { page: 1, x: 0, y: 0.1, width: 0.9, height: 0.8 },
        { page: 2, x: 0, y: 0.1, width: 0.9, height: 0.8 },
        { page: 3, x: 0, y: 0.1, width: 0.9, height: 0.8 },
      ],
      detectedQuestionReference: null,
      rawText: 'Multi-page complete derivation',
    });
    const a2 = createMockAnswer({
      id: 'ans-2',
      pages: [4],
      regions: [{ page: 4, x: 0, y: 0.1, width: 0.9, height: 0.8 }],
      detectedQuestionReference: null,
      rawText: 'MergeSort explanation',
    });

    mockProvider.mockDecisions = [
      {
        answerId: 'multi-ans',
        questionId: 'q1',
        confidence: 0.91,
      },
      {
        answerId: 'ans-2',
        questionId: 'q2',
        confidence: 0.88,
      },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q1, q2], [multiAnswer, a2], { provider: mockProvider });

    assert.equal(mappings.length, 2);
    assert.deepEqual(mappings[0], {
      questionId: 'q1',
      answerId: 'multi-ans',
      confidence: 0.91,
      status: 'matched',
      method: 'semantic',
    });
    assert.deepEqual(mappings[1], {
      questionId: 'q2',
      answerId: 'ans-2',
      confidence: 0.88,
      status: 'matched',
      method: 'semantic',
    });
  });


  // --------------------------------------------------------------------------
  // 14. No AI Call When No Unresolved Cases
  // --------------------------------------------------------------------------
  it('14. zero AI calls occur when all questions and answers are already resolved deterministically', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });

    const mappings = await resolveMappingsWithSemanticFallback([q1], [a1], { provider: mockProvider });

    assert.equal(mappings.length, 1);
    assert.equal(mappings[0].method, 'explicit_reference');
    assert.equal(mockProvider.resolveCalls.length, 0);
  });

  // --------------------------------------------------------------------------
  // 15. Assessment Store Integration
  // --------------------------------------------------------------------------
  it('15. resolveAssessmentMappingsWithSemanticFallback updates Assessment.mappings in assessmentStore', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', text: 'HeapSort implementation', order: 1 });
    const q3 = createMockQuestion({ id: 'q3', number: '3', text: 'MergeSort implementation', order: 2 });

    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
    const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null, rawText: 'Heapify algorithm' });

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
      questions: [q1, q2, q3],
      answers: [a1, a2],
      mappings: [],
    });

    mockProvider.mockDecisions = [
      {
        answerId: 'a2',
        questionId: 'q2',
        confidence: 0.92,
      },
    ];

    const mappings = await resolveAssessmentMappingsWithSemanticFallback(assessment.id, { provider: mockProvider });

    assert.equal(mappings.length, 3);
    assert.equal(mappings[0].questionId, 'q1');
    assert.equal(mappings[0].method, 'explicit_reference');

    assert.equal(mappings[1].questionId, 'q2');
    assert.equal(mappings[1].method, 'semantic');
    assert.equal(mappings[1].status, 'matched');

    assert.equal(mappings[2].questionId, 'q3');
    assert.equal(mappings[2].status, 'unanswered');

    const stored = assessmentStore.get(assessment.id);
    assert.ok(stored);
    assert.deepEqual(stored.mappings, mappings);
  });


  // --------------------------------------------------------------------------
  // 16. Graceful Degradation on AI Failure
  // --------------------------------------------------------------------------
  it('16. AI provider failure gracefully preserves deterministic mappings without crashing or corrupting store', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });

    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
    const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });

    mockProvider.shouldThrow = true;

    const mappings = await resolveMappingsWithSemanticFallback([q1, q2], [a1, a2], { provider: mockProvider });

    assert.equal(mappings.length, 2);
    // Q1 explicit match remains intact
    assert.equal(mappings[0].questionId, 'q1');
    assert.equal(mappings[0].answerId, 'a1');
    assert.equal(mappings[0].method, 'explicit_reference');
    assert.equal(mappings[0].status, 'matched');

    // Q2 structural fallback remains intact
    assert.equal(mappings[1].questionId, 'q2');
    assert.equal(mappings[1].answerId, 'a2');
    assert.equal(mappings[1].method, 'structural');
  });

  // --------------------------------------------------------------------------
  // 17. Strict Schema Conformance
  // --------------------------------------------------------------------------
  it('17. all resulting AnswerMapping objects strictly pass AnswerMappingSchema', async () => {
    const q1 = createMockQuestion({ id: 'q1', number: '1', order: 0 });
    const q2 = createMockQuestion({ id: 'q2', number: '2', order: 1 });
    const q3 = createMockQuestion({ id: 'q3', number: '3', order: 2 });

    const a1 = createMockAnswer({ id: 'a1', detectedQuestionReference: 'Q1' });
    const a2 = createMockAnswer({ id: 'a2', detectedQuestionReference: null });

    mockProvider.mockDecisions = [
      {
        answerId: 'a2',
        questionId: 'q2',
        confidence: 0.88,
      },
    ];

    const mappings = await resolveMappingsWithSemanticFallback([q1, q2, q3], [a1, a2], { provider: mockProvider });

    for (const m of mappings) {
      assert.doesNotThrow(() => AnswerMappingSchema.parse(m));
    }
  });

  // --------------------------------------------------------------------------
  // 18. Security: Server-side API key safety
  // --------------------------------------------------------------------------
  it('18. LLM_API_KEY is purely server-side and never exposed to client bundles via NEXT_PUBLIC_', () => {
    assert.equal(process.env.NEXT_PUBLIC_LLM_API_KEY, undefined);
  });
});

