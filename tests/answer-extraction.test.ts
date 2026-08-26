import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AnswerRegionSchema,
  AnswerSchema,
} from '../lib/validation/schemas';
import {
  RawAnswerBlockSchema,
  RawAnswerBlockArraySchema,
  RawAnswerRegionSchema,
} from '../lib/ai/schemas';
import {
  DocumentAIProvider,
  PageImageInput,
  RawAnswerBlock,
  RawQuestionExtraction,
} from '../lib/ai/types';
import {
  normalizeBox2d,
  denormalizeToPixels,
} from '../lib/extraction/coordinates';
import {
  normalizeRawRegions,
  normalizeQuestionReference,
  extractAnswers,
} from '../lib/extraction/answer-extractor';
import { extractAnswersForAssessment } from '../lib/extraction';
import { assessmentStore } from '../lib/store';
import { rasterStore } from '../lib/raster';

/**
 * Mock Document AI Provider for deterministic unit testing.
 */
class MockAnswerDocumentAIProvider implements DocumentAIProvider {
  constructor(private readonly mockBlocks: RawAnswerBlock[] = []) {}

  async extractQuestionsFromImages(): Promise<RawQuestionExtraction[]> {
    return [];
  }

  async extractAnswersFromImages(): Promise<RawAnswerBlock[]> {
    return this.mockBlocks;
  }
}

// ============================================================================
// 1. SCHEMA / COORDINATE TESTS
// ============================================================================

test('1. valid normalized AnswerRegion passes schema validation', () => {
  const validRegion = {
    page: 1,
    x: 0.1,
    y: 0.2,
    width: 0.8,
    height: 0.5,
    extractionConfidence: 0.95,
  };
  const result = AnswerRegionSchema.safeParse(validRegion);
  assert.ok(result.success);
});

test('2. negative coordinates in AnswerRegion are rejected', () => {
  const negativeX = { page: 1, x: -0.1, y: 0.2, width: 0.5, height: 0.5 };
  const negativeY = { page: 1, x: 0.1, y: -0.2, width: 0.5, height: 0.5 };
  assert.ok(!AnswerRegionSchema.safeParse(negativeX).success);
  assert.ok(!AnswerRegionSchema.safeParse(negativeY).success);
});

test('3. AnswerRegion with right edge > 1 is rejected', () => {
  const rightEdgeOver = { page: 1, x: 0.7, y: 0.2, width: 0.4, height: 0.5 }; // x + width = 1.1
  const result = AnswerRegionSchema.safeParse(rightEdgeOver);
  assert.ok(!result.success);
});

test('4. AnswerRegion with bottom edge > 1 is rejected', () => {
  const bottomEdgeOver = { page: 1, x: 0.1, y: 0.6, width: 0.5, height: 0.5 }; // y + height = 1.1
  const result = AnswerRegionSchema.safeParse(bottomEdgeOver);
  assert.ok(!result.success);
});

test('5. zero or inverted coordinate dimensions fail normalization', () => {
  assert.throws(() => normalizeBox2d([100, 100, 100, 200])); // rawHeight == 0
  assert.throws(() => normalizeBox2d([100, 100, 200, 100])); // rawWidth == 0
  assert.throws(() => normalizeBox2d([200, 100, 100, 200])); // ymax < ymin
});

test('6. page number < 1 is rejected by AnswerRegionSchema', () => {
  const invalidPage = { page: 0, x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
  const result = AnswerRegionSchema.safeParse(invalidPage);
  assert.ok(!result.success);
});

test('7. valid multi-page Answer passes validation', () => {
  const multiPageAnswer = {
    id: 'ans-1',
    pages: [1, 2],
    regions: [
      { page: 1, x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      { page: 2, x: 0.1, y: 0.1, width: 0.8, height: 0.4 },
    ],
    rawText: 'Continued on next page...',
    detectedQuestionReference: '11(a)',
  };
  const result = AnswerSchema.safeParse(multiPageAnswer);
  assert.ok(result.success);
});

test('8. unsorted pages array in Answer is rejected', () => {
  const unsortedAnswer = {
    id: 'ans-2',
    pages: [2, 1], // Unsorted!
    regions: [
      { page: 2, x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      { page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    ],
  };
  const result = AnswerSchema.safeParse(unsortedAnswer);
  assert.ok(!result.success);
});

test('9. empty regions array in Answer is rejected', () => {
  const emptyRegions = {
    id: 'ans-3',
    pages: [1],
    regions: [],
  };
  const result = AnswerSchema.safeParse(emptyRegions);
  assert.ok(!result.success);
});

// ============================================================================
// 2. GEMINI OUTPUT SCHEMA TESTS
// ============================================================================

test('10. valid raw answer extraction response is accepted by schema', () => {
  const rawResponse = [
    {
      page: 1,
      detectedQuestionReference: 'Q1',
      text: 'Quicksort uses divide and conquer...',
      confidence: 0.95,
      box_2d: [100, 150, 450, 850],
    },
  ];
  const result = RawAnswerBlockArraySchema.safeParse(rawResponse);
  assert.ok(result.success);
});

test('11. malformed raw answer extraction response is rejected', () => {
  const malformed = [
    {
      page: 'one', // Not an int
      box_2d: 'invalid_box',
    },
  ];
  const result = RawAnswerBlockArraySchema.safeParse(malformed);
  assert.ok(!result.success);
});

test('12. missing page number in raw block is rejected', () => {
  const missingPage = {
    detectedQuestionReference: '1',
    box_2d: [100, 100, 500, 500],
  };
  const result = RawAnswerBlockSchema.safeParse(missingPage);
  assert.ok(!result.success);
});

test('13. malformed box_2d with wrong length is rejected', () => {
  const invalidBoxLength = {
    page: 1,
    box_2d: [100, 200, 300], // Only 3 elements
  };
  const result = RawAnswerBlockSchema.safeParse(invalidBoxLength);
  assert.ok(!result.success);
});

test('14. answer block with nested regions is accepted', () => {
  const nestedBlock = {
    page: 1,
    detectedQuestionReference: '2',
    regions: [
      { box_2d: [100, 100, 300, 400], extractionConfidence: 0.9 },
      { box_2d: [350, 100, 600, 400], extractionConfidence: 0.85 },
    ],
  };
  const result = RawAnswerBlockSchema.safeParse(nestedBlock);
  assert.ok(result.success);
});

test('15. questionReference is optional and can be null or undefined', () => {
  const blockWithNullRef = {
    page: 1,
    detectedQuestionReference: null,
    box_2d: [100, 100, 400, 400],
    text: 'Handwritten notes with no visible question number',
  };
  const result = RawAnswerBlockSchema.safeParse(blockWithNullRef);
  assert.ok(result.success);
});

// ============================================================================
// 3. EXTRACTION LOGIC TESTS
// ============================================================================

test('16. mock provider returns multiple distinct answer blocks', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([
    {
      page: 1,
      detectedQuestionReference: 'Q1',
      text: 'Answer to question 1',
      confidence: 0.95,
      box_2d: [100, 100, 400, 900],
    },
    {
      page: 1,
      detectedQuestionReference: 'Q2',
      text: 'Answer to question 2',
      confidence: 0.9,
      box_2d: [450, 100, 850, 900],
    },
  ]);

  const pageImages: PageImageInput[] = [
    { pageNumber: 1, imageBuffer: Buffer.from([1, 2, 3]), mimeType: 'image/png' },
  ];

  const result = await extractAnswers({ pageImages, provider: mockProvider });
  assert.equal(result.answerCount, 2);
  assert.equal(result.answers[0].detectedQuestionReference, '1');
  assert.equal(result.answers[1].detectedQuestionReference, '2');
});

test('17. explicit question references are normalized and preserved', () => {
  assert.equal(normalizeQuestionReference('Q1'), '1');
  assert.equal(normalizeQuestionReference('Question 2'), '2');
  assert.equal(normalizeQuestionReference('Ans 11(a)'), '11(a)');
  assert.equal(normalizeQuestionReference('11 (b)'), '11 (b)');
  assert.equal(normalizeQuestionReference('No. 5'), '5');
  assert.equal(normalizeQuestionReference(null), null);
  assert.equal(normalizeQuestionReference(''), null);
});

test('18. answers without references are preserved as independent records', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([
    {
      page: 1,
      detectedQuestionReference: null,
      text: 'Unlabeled calculation',
      confidence: 0.8,
      box_2d: [100, 100, 500, 500],
    },
  ]);

  const result = await extractAnswers({
    pageImages: [{ pageNumber: 1, imageBuffer: Buffer.from([1]), mimeType: 'image/png' }],
    provider: mockProvider,
  });

  assert.equal(result.answerCount, 1);
  assert.equal(result.answers[0].detectedQuestionReference, null);
  assert.ok(result.answers[0].id);
  assert.equal(result.answers[0].regions.length, 1);
});

test('19. multiple regions on same page with same reference are grouped into one Answer', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([
    {
      page: 1,
      detectedQuestionReference: 'Q3',
      text: 'Part A of answer 3',
      confidence: 0.9,
      box_2d: [100, 100, 300, 800],
    },
    {
      page: 1,
      detectedQuestionReference: 'Q3',
      text: 'Part B of answer 3 (diagram)',
      confidence: 0.85,
      box_2d: [350, 100, 600, 800],
    },
  ]);

  const result = await extractAnswers({
    pageImages: [{ pageNumber: 1, imageBuffer: Buffer.from([1]), mimeType: 'image/png' }],
    provider: mockProvider,
  });

  assert.equal(result.answerCount, 1);
  assert.equal(result.answers[0].detectedQuestionReference, '3');
  assert.equal(result.answers[0].regions.length, 2);
  assert.deepEqual(result.answers[0].pages, [1]);
});

test('20. multi-page answer spanning pages 1 and 2 is merged into one Answer', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([
    {
      page: 1,
      detectedQuestionReference: '11(a)',
      text: 'Derivation start on page 1...',
      confidence: 0.95,
      box_2d: [500, 100, 950, 900],
    },
    {
      page: 2,
      detectedQuestionReference: '11(a)',
      text: 'Derivation conclusion on page 2...',
      confidence: 0.92,
      box_2d: [100, 100, 450, 900],
    },
  ]);

  const pageImages: PageImageInput[] = [
    { pageNumber: 1, imageBuffer: Buffer.from([1]), mimeType: 'image/png' },
    { pageNumber: 2, imageBuffer: Buffer.from([2]), mimeType: 'image/png' },
  ];

  const result = await extractAnswers({ pageImages, provider: mockProvider });
  assert.equal(result.answerCount, 1);
  assert.equal(result.answers[0].detectedQuestionReference, '11(a)');
  assert.deepEqual(result.answers[0].pages, [1, 2]);
  assert.equal(result.answers[0].regions.length, 2);
  assert.equal(result.answers[0].regions[0].page, 1);
  assert.equal(result.answers[0].regions[1].page, 2);
});

test('20b. one answer spanning 3 contiguous pages (1, 2, 3) becomes one Answer with 3 regions', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([
    { page: 1, detectedQuestionReference: 'Q1', text: 'Q1 start', confidence: 0.95, box_2d: [100, 100, 900, 900] },
    { page: 2, detectedQuestionReference: null, text: 'Q1 continuation', confidence: 0.94, box_2d: [50, 50, 950, 950] },
    { page: 3, detectedQuestionReference: null, text: 'Q1 conclusion', confidence: 0.92, box_2d: [50, 50, 800, 800] },
  ]);

  const pageImages: PageImageInput[] = [
    { pageNumber: 1, imageBuffer: Buffer.from([1]), mimeType: 'image/png' },
    { pageNumber: 2, imageBuffer: Buffer.from([2]), mimeType: 'image/png' },
    { pageNumber: 3, imageBuffer: Buffer.from([3]), mimeType: 'image/png' },
  ];

  const result = await extractAnswers({ pageImages, provider: mockProvider });
  assert.equal(result.answerCount, 1);
  assert.equal(result.answers[0].detectedQuestionReference, '1');
  assert.deepEqual(result.answers[0].pages, [1, 2, 3]);
  assert.equal(result.answers[0].regions.length, 3);
  assert.equal(result.answers[0].regions[0].page, 1);
  assert.equal(result.answers[0].regions[1].page, 2);
  assert.equal(result.answers[0].regions[2].page, 3);
});

test('20c. two unrelated answers on adjacent pages (Q1 on page 1, Q2 on page 2) do NOT merge', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([
    { page: 1, detectedQuestionReference: 'Q1', text: 'Answer 1', confidence: 0.95, box_2d: [100, 100, 900, 900] },
    { page: 2, detectedQuestionReference: 'Q2', text: 'Answer 2', confidence: 0.95, box_2d: [100, 100, 900, 900] },
  ]);

  const pageImages: PageImageInput[] = [
    { pageNumber: 1, imageBuffer: Buffer.from([1]), mimeType: 'image/png' },
    { pageNumber: 2, imageBuffer: Buffer.from([2]), mimeType: 'image/png' },
  ];

  const result = await extractAnswers({ pageImages, provider: mockProvider });
  assert.equal(result.answerCount, 2);
  assert.equal(result.answers[0].detectedQuestionReference, '1');
  assert.equal(result.answers[1].detectedQuestionReference, '2');
  assert.deepEqual(result.answers[0].pages, [1]);
  assert.deepEqual(result.answers[1].pages, [2]);
});

test('20d. same explicit question reference on non-contiguous pages (page 1 and page 3) does NOT automatically merge', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([
    { page: 1, detectedQuestionReference: 'Q1', text: 'Attempt 1', confidence: 0.95, box_2d: [100, 100, 900, 900] },
    { page: 2, detectedQuestionReference: 'Q2', text: 'Question 2', confidence: 0.95, box_2d: [100, 100, 900, 900] },
    { page: 3, detectedQuestionReference: 'Q1', text: 'Attempt 2 on later page', confidence: 0.95, box_2d: [100, 100, 900, 900] },
  ]);

  const pageImages: PageImageInput[] = [
    { pageNumber: 1, imageBuffer: Buffer.from([1]), mimeType: 'image/png' },
    { pageNumber: 2, imageBuffer: Buffer.from([2]), mimeType: 'image/png' },
    { pageNumber: 3, imageBuffer: Buffer.from([3]), mimeType: 'image/png' },
  ];

  const result = await extractAnswers({ pageImages, provider: mockProvider });
  assert.equal(result.answerCount, 3);
  assert.equal(result.answers[0].detectedQuestionReference, '1');
  assert.equal(result.answers[1].detectedQuestionReference, '2');
  assert.equal(result.answers[2].detectedQuestionReference, '1');
  assert.deepEqual(result.answers[0].pages, [1]);
  assert.deepEqual(result.answers[1].pages, [2]);
  assert.deepEqual(result.answers[2].pages, [3]);
});

test('20e. unreferenced block with page gap (page 1 -> page 3) stays independent', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([
    { page: 1, detectedQuestionReference: 'Q1', text: 'Answer 1', confidence: 0.95, box_2d: [100, 100, 900, 900] },
    { page: 3, detectedQuestionReference: null, text: 'Isolated unreferenced page 3', confidence: 0.8, box_2d: [100, 100, 900, 900] },
  ]);

  const pageImages: PageImageInput[] = [
    { pageNumber: 1, imageBuffer: Buffer.from([1]), mimeType: 'image/png' },
    { pageNumber: 3, imageBuffer: Buffer.from([3]), mimeType: 'image/png' },
  ];

  const result = await extractAnswers({ pageImages, provider: mockProvider });
  assert.equal(result.answerCount, 2);
  assert.equal(result.answers[0].detectedQuestionReference, '1');
  assert.equal(result.answers[1].detectedQuestionReference, null);
});

test('21. blank page produces no Answer records', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([]); // No blocks on blank page

  const result = await extractAnswers({
    pageImages: [{ pageNumber: 1, imageBuffer: Buffer.from([1]), mimeType: 'image/png' }],
    provider: mockProvider,
  });

  assert.equal(result.answerCount, 0);
  assert.deepEqual(result.answers, []);
});

test('22. normalizeBox2d correctly maps [ymin, xmin, ymax, xmax] to [0, 1] fractions', () => {
  const norm = normalizeBox2d([200, 100, 800, 900]);
  assert.equal(norm.x, 0.1);
  assert.equal(norm.y, 0.2);
  assert.equal(norm.width, 0.8);
  assert.equal(norm.height, 0.6);
  assert.ok(norm.x + norm.width <= 1);
  assert.ok(norm.y + norm.height <= 1);
});

test('23. denormalizeToPixels accurately converts fractions to pixel coordinates', () => {
  const pixels = denormalizeToPixels({ x: 0.1, y: 0.2, width: 0.8, height: 0.6 }, 1000, 2000);
  assert.equal(pixels.left, 100);
  assert.equal(pixels.top, 400);
  assert.equal(pixels.width, 800);
  assert.equal(pixels.height, 1200);
});

// ============================================================================
// 4. ASSESSMENT INTEGRATION TESTS
// ============================================================================

test('24. answers are stored on correct Assessment in assessmentStore', async () => {
  assessmentStore.clear();
  rasterStore.clear();

  const assessment = assessmentStore.create({
    questionPaper: {
      id: 'qp-1',
      filename: 'qp.pdf',
      mimeType: 'application/pdf',
      pageCount: 1,
    },
    answerSheet: {
      id: 'as-1',
      filename: 'answers.pdf',
      mimeType: 'application/pdf',
      pageCount: 1,
    },
  });

  rasterStore.savePages(assessment.id, 'answer_sheet', [
    { pageNumber: 1, imageBuffer: Buffer.from([10, 20]), width: 1000, height: 1400, mimeType: 'image/png' },
  ]);

  const mockProvider = new MockAnswerDocumentAIProvider([
    {
      page: 1,
      detectedQuestionReference: '1',
      text: 'Answer to Q1',
      confidence: 0.95,
      box_2d: [100, 100, 500, 900],
    },
  ]);

  const extracted = await extractAnswersForAssessment(assessment.id, { provider: mockProvider });
  assert.equal(extracted.length, 1);

  const updated = assessmentStore.get(assessment.id)!;
  assert.equal(updated.answers.length, 1);
  assert.equal(updated.answers[0].detectedQuestionReference, '1');
  assert.equal(updated.answers[0].pages[0], 1);
  assert.equal(updated.answers[0].regions.length, 1);
});

test('25. questions, mappings, and document metadata remain unchanged after answer extraction', async () => {
  assessmentStore.clear();
  rasterStore.clear();

  const assessment = assessmentStore.create({
    questionPaper: {
      id: 'qp-2',
      filename: 'math_paper.pdf',
      mimeType: 'application/pdf',
      pageCount: 2,
    },
    answerSheet: {
      id: 'as-2',
      filename: 'student_answers.pdf',
      mimeType: 'application/pdf',
      pageCount: 2,
    },
  });

  // Pre-populate questions to ensure isolation
  assessmentStore.update(assessment.id, {
    questions: [
      { id: 'q-1', number: '1', text: 'Solve calculus equation', order: 0 },
      { id: 'q-2', number: '2', text: 'State Bayes theorem', order: 1 },
    ],
  });

  rasterStore.savePages(assessment.id, 'answer_sheet', [
    { pageNumber: 1, imageBuffer: Buffer.from([1]), width: 800, height: 1100, mimeType: 'image/png' },
  ]);

  const mockProvider = new MockAnswerDocumentAIProvider([
    {
      page: 1,
      detectedQuestionReference: '1',
      text: 'Calculus answer steps...',
      confidence: 0.9,
      box_2d: [200, 200, 600, 800],
    },
  ]);

  await extractAnswersForAssessment(assessment.id, { provider: mockProvider });

  const updated = assessmentStore.get(assessment.id)!;
  // Questions must remain intact
  assert.equal(updated.questions.length, 2);
  assert.equal(updated.questions[0].number, '1');
  assert.equal(updated.questions[1].number, '2');

  // Mappings must remain untouched (empty array for Phase 3C)
  assert.deepEqual(updated.mappings, []);

  // Document metadata must remain intact
  assert.equal(updated.questionPaper.filename, 'math_paper.pdf');
  assert.equal(updated.answerSheet.filename, 'student_answers.pdf');
  assert.equal(updated.id, assessment.id);
});

test('26. unknown assessment ID throws descriptive error', async () => {
  const mockProvider = new MockAnswerDocumentAIProvider([]);
  await assert.rejects(
    () => extractAnswersForAssessment('non-existent-id', { provider: mockProvider }),
    /Assessment not found/
  );
});

test('27. provider failure throws descriptive error without corrupting store', async () => {
  assessmentStore.clear();
  rasterStore.clear();

  const assessment = assessmentStore.create({
    questionPaper: { id: 'qp-e', filename: 'qp.pdf', mimeType: 'application/pdf', pageCount: 1 },
    answerSheet: { id: 'as-e', filename: 'as.pdf', mimeType: 'application/pdf', pageCount: 1 },
  });

  rasterStore.savePages(assessment.id, 'answer_sheet', [
    { pageNumber: 1, imageBuffer: Buffer.from([1]), width: 800, height: 1100, mimeType: 'image/png' },
  ]);

  const failingProvider: DocumentAIProvider = {
    async extractQuestionsFromImages() { return []; },
    async extractAnswersFromImages() {
      throw new Error('Gemini API quota exceeded or connection reset');
    },
  };

  await assert.rejects(
    () => extractAnswersForAssessment(assessment.id, { provider: failingProvider }),
    /Gemini API quota exceeded/
  );

  const unmodified = assessmentStore.get(assessment.id)!;
  assert.deepEqual(unmodified.answers, []);
});
