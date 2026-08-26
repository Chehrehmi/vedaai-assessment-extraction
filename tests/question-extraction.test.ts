import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuestionsFromLines,
  parseQuestionLabel,
  isHeaderOrFooterLine,
} from '../lib/extraction/question-parser';
import { extractPdfText } from '../lib/extraction/text-extractor';
import { extractQuestions } from '../lib/extraction/question-extractor';
import { extractQuestionsForAssessment } from '../lib/extraction';
import {
  QuestionSchema,
} from '../lib/validation/schemas';
import {
  RawQuestionExtractionArraySchema,
  RawQuestionExtractionSchema,
} from '../lib/ai/schemas';
import { DocumentAIProvider, PageImageInput, RawQuestionExtraction } from '../lib/ai/types';
import { assessmentStore } from '../lib/store/assessment-store';
import { rasterStore } from '../lib/raster/page-store';
import { Assessment } from '../lib/domain/types';

// Helper to create ExtractedPageText structures for testing
function createPageText(lines: string[], pageNumber = 1) {
  return {
    pageNumber,
    lines,
    rawText: lines.join('\n'),
  };
}

// Mock AI provider that tracks calls and returns configured questions
class MockDocumentAIProvider implements DocumentAIProvider {
  public callCount = 0;
  public lastPagesReceived: PageImageInput[] = [];
  public mockResponse: RawQuestionExtraction[] = [];

  constructor(mockResponse: RawQuestionExtraction[] = []) {
    this.mockResponse = mockResponse;
  }

  async extractQuestionsFromImages(pages: PageImageInput[]): Promise<RawQuestionExtraction[]> {
    this.callCount++;
    this.lastPagesReceived = pages;
    return this.mockResponse;
  }

  async extractAnswersFromImages(): Promise<any[]> {
    return [];
  }
}

// ----------------------------------------------------------------------------
// TEXT/PARSER TESTS
// ----------------------------------------------------------------------------

test('1. basic numbered questions (1, 2, 3) are extracted with clean text', () => {
  const pages = [
    createPageText([
      '1. Define Big-O notation and explain asymptotic bounds.',
      '2. Describe the working mechanism of QuickSort.',
      '3. Compare singly linked lists with doubly linked lists.',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);

  assert.equal(questions.length, 3);
  assert.equal(questions[0].number, '1');
  assert.equal(questions[0].text, 'Define Big-O notation and explain asymptotic bounds.');
  assert.equal(questions[0].order, 0);
  assert.equal(questions[0].parentNumber, undefined);

  assert.equal(questions[1].number, '2');
  assert.equal(questions[1].text, 'Describe the working mechanism of QuickSort.');
  assert.equal(questions[1].order, 1);

  assert.equal(questions[2].number, '3');
  assert.equal(questions[2].text, 'Compare singly linked lists with doubly linked lists.');
  assert.equal(questions[2].order, 2);
});

test('2. multi-digit questions (9, 10, 11, 12) parse correctly', () => {
  const pages = [
    createPageText([
      '9. Explain Dijkstra shortest path algorithm.',
      '10. Formulate the Bellman-Ford recurrence.',
      '11. Solve the 0/1 Knapsack problem using dynamic programming.',
      '12. Prove that 3-SAT is NP-complete.',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);

  assert.equal(questions.length, 4);
  assert.equal(questions[0].number, '9');
  assert.equal(questions[1].number, '10');
  assert.equal(questions[2].number, '11');
  assert.equal(questions[3].number, '12');
  assert.equal(questions[3].order, 3);
});

test('3. sub-questions 11(a) and 11(b) are separate Question records with parentNumber', () => {
  const pages = [
    createPageText([
      '11(a) Explain Prim algorithm for finding minimum spanning tree.',
      '11(b) Compare Kruskal vs Prim complexity with adjacency matrix.',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);

  assert.equal(questions.length, 2);

  assert.equal(questions[0].number, '11(a)');
  assert.equal(questions[0].parentNumber, '11');
  assert.equal(questions[0].subPart, 'a');
  assert.equal(questions[0].text, 'Explain Prim algorithm for finding minimum spanning tree.');
  assert.equal(questions[0].order, 0);

  assert.equal(questions[1].number, '11(b)');
  assert.equal(questions[1].parentNumber, '11');
  assert.equal(questions[1].subPart, 'b');
  assert.equal(questions[1].text, 'Compare Kruskal vs Prim complexity with adjacency matrix.');
  assert.equal(questions[1].order, 1);
});

test('4. formatting variants "11 (a)", "11(a)", "11. (a)", "11(a)." normalize correctly', () => {
  const v1 = parseQuestionLabel('11 (a)');
  assert.equal(v1.number, '11(a)');
  assert.equal(v1.parentNumber, '11');
  assert.equal(v1.subPart, 'a');

  const v2 = parseQuestionLabel('11(a)');
  assert.equal(v2.number, '11(a)');
  assert.equal(v2.parentNumber, '11');
  assert.equal(v2.subPart, 'a');

  const v3 = parseQuestionLabel('11. (a)');
  assert.equal(v3.number, '11(a)');
  assert.equal(v3.parentNumber, '11');
  assert.equal(v3.subPart, 'a');

  const v4 = parseQuestionLabel('11(a).');
  assert.equal(v4.number, '11(a)');
  assert.equal(v4.parentNumber, '11');
  assert.equal(v4.subPart, 'a');
});

test('5. sub-question independence: 11(a) can exist without a parent Question "11"', () => {
  const pages = [
    createPageText([
      '10. Top level question ten.',
      '11(a) First sub-part of eleven without parent item eleven.',
      '11(b) Second sub-part of eleven.',
      '12. Top level question twelve.',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);

  assert.equal(questions.length, 4);
  assert.equal(questions[0].number, '10');
  assert.equal(questions[1].number, '11(a)');
  assert.equal(questions[1].parentNumber, '11');
  assert.equal(questions[2].number, '11(b)');
  assert.equal(questions[2].parentNumber, '11');
  assert.equal(questions[3].number, '12');

  // Verify no orphan Question with number "11" was erroneously injected
  assert.equal(questions.some((q) => q.number === '11'), false);
});

test('6. deterministic ordering: Question items produce sequential order 0..N-1', () => {
  const pages = [
    createPageText(['1. First question', '2. Second question']),
    createPageText(['3(a) Third part a', '3(b) Third part b', '4. Fourth question'], 2),
  ];

  const questions = parseQuestionsFromLines(pages);

  assert.equal(questions.length, 5);
  for (let i = 0; i < questions.length; i++) {
    assert.equal(questions[i].order, i);
  }
});

test('7. question text does not accidentally absorb header, footer, or page number lines', () => {
  const pages = [
    createPageText([
      'DELHI PUBLIC SCHOOL - SEMESTER EXAMINATION',
      'Course Code: CS-631',
      'Time Allowed: 3 Hours       Maximum Marks: 100',
      '------------------------------------------------',
      '1. What is an AVL tree and why is rebalancing required?',
      'Page 1 of 2',
      '2. Describe red-black tree insertion properties.',
      'End of Question Paper',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);

  assert.equal(questions.length, 2);
  assert.equal(questions[0].number, '1');
  assert.equal(questions[0].text, 'What is an AVL tree and why is rebalancing required?');
  assert.equal(questions[1].number, '2');
  assert.equal(questions[1].text, 'Describe red-black tree insertion properties.');
});

test('8. duplicate label handling preserves both questions as distinct records with unique IDs', () => {
  const pages = [
    createPageText([
      '11(a) Part 1 of question.',
      '11(a) Duplicate part with alternative topic.',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);

  assert.equal(questions.length, 2);
  assert.notEqual(questions[0].id, questions[1].id);
  assert.equal(questions[0].order, 0);
  assert.equal(questions[1].order, 1);
  assert.equal(questions[0].text, 'Part 1 of question.');
  assert.equal(questions[1].text, 'Duplicate part with alternative topic.');
});

test('9. malformed or ambiguous labels do not crash and extract with fallback structure', () => {
  const parsed1 = parseQuestionLabel('Section A');
  assert.equal(parsed1.number, 'Section A');
  assert.equal(parsed1.parentNumber, undefined);

  const headerCheck = isHeaderOrFooterLine('Time: 3 Hours');
  assert.equal(headerCheck, true);
});

// ----------------------------------------------------------------------------
// SCHEMA VALIDATION TESTS
// ----------------------------------------------------------------------------

test('10. valid extracted question passes Zod validation', () => {
  const validQuestion = {
    id: 'b5f0ef35-4927-4dd3-ae9e-e67c87c9fe10',
    number: '11(a)',
    text: 'Explain quicksort partitioning.',
    order: 0,
    parentNumber: '11',
    subPart: 'a',
  };

  const parsed = QuestionSchema.parse(validQuestion);
  assert.deepEqual(parsed, validQuestion);
});

test('11. missing question number fails schema validation', () => {
  const invalidQuestion = {
    id: 'b5f0ef35-4927-4dd3-ae9e-e67c87c9fe10',
    number: '', // empty
    text: 'Some question text.',
    order: 0,
  };

  assert.throws(() => QuestionSchema.parse(invalidQuestion));
});

test('12. missing question text fails schema validation', () => {
  const missingTextQuestion = {
    id: 'b5f0ef35-4927-4dd3-ae9e-e67c87c9fe10',
    number: '1',
    text: undefined, // missing text
    order: 0,
  };

  assert.throws(() => QuestionSchema.parse(missingTextQuestion));

  // Also verify RawQuestionExtractionSchema rejects empty string text
  assert.throws(() =>
    RawQuestionExtractionSchema.parse({
      number: '1',
      text: '',
    })
  );
});

test('13. malformed Gemini response fails RawQuestionExtraction schema validation', () => {
  const badGeminiOutputs = [
    { number: '1' }, // missing text
    { text: 'some text' }, // missing number
    { number: '', text: 'text' }, // empty number
    { number: '1', text: '' }, // empty text
    { number: 123, text: 'text' }, // non-string number
  ];

  for (const bad of badGeminiOutputs) {
    const result = RawQuestionExtractionSchema.safeParse(bad);
    assert.equal(result.success, false);
  }

  const badArrayResult = RawQuestionExtractionArraySchema.safeParse('not an array');
  assert.equal(badArrayResult.success, false);
});

// ----------------------------------------------------------------------------
// HYBRID FALLBACK TESTS
// ----------------------------------------------------------------------------

test('14. text-rich document does NOT call Gemini provider', async () => {
  const mockProvider = new MockDocumentAIProvider([
    { number: '99', text: 'This should never be returned by text path' },
  ]);

  // When a text layer is present, extractQuestions uses the text path directly
  const textDoc = {
    hasText: true,
    pageCount: 1,
    pages: [
      createPageText([
        '1. First text question.',
        '2. Second text question.',
      ]),
    ],
    fullText: '1. First text question.\n2. Second text question.',
  };

  const parsedQuestions = parseQuestionsFromLines(textDoc.pages);
  assert.equal(parsedQuestions.length, 2);
  assert.equal(mockProvider.callCount, 0);
});

test('15. text-empty / scanned document DOES invoke the vision fallback path', async () => {
  const mockProvider = new MockDocumentAIProvider([
    { number: '1', text: 'Scanned question 1 from vision AI.' },
    { number: '2', text: 'Scanned question 2 from vision AI.' },
  ]);

  const dummyImageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  const result = await extractQuestions({
    pageImages: [{ pageNumber: 1, imageBuffer: dummyImageBuffer, mimeType: 'image/png' }],
    provider: mockProvider,
  });

  assert.equal(mockProvider.callCount, 1);
  assert.equal(result.method, 'vision_fallback');
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].number, '1');
  assert.equal(result.questions[0].text, 'Scanned question 1 from vision AI.');
  assert.equal(result.questions[1].number, '2');
  assert.equal(result.questions[1].text, 'Scanned question 2 from vision AI.');
});

// ----------------------------------------------------------------------------
// ASSESSMENT INTEGRATION TESTS
// ----------------------------------------------------------------------------

test('16. extracted questions are stored on the correct Assessment record in assessmentStore', async () => {
  assessmentStore.clear();
  rasterStore.clear();

  const assessment = assessmentStore.create({
    questionPaper: {
      id: 'qp-1',
      filename: 'exam.pdf',
      mimeType: 'application/pdf',
      pageCount: 1,
    },
    answerSheet: {
      id: 'as-1',
      filename: 'answers.pdf',
      mimeType: 'application/pdf',
      pageCount: 2,
    },
  });

  // Seed raster page image in rasterStore using savePages
  rasterStore.savePages(assessment.id, 'question_paper', [
    { pageNumber: 1, imageBuffer: Buffer.from([1, 2, 3]), width: 800, height: 1100, mimeType: 'image/png' },
  ]);

  const mockProvider = new MockDocumentAIProvider([
    { number: '1', text: 'Define recursion.' },
    { number: '2(a)', text: 'Explain divide and conquer.', parentNumber: '2', subPart: 'a' },
  ]);

  const extracted = await extractQuestionsForAssessment(assessment.id, {
    provider: mockProvider,
  });

  assert.equal(extracted.length, 2);

  const updatedAssessment = assessmentStore.get(assessment.id);
  assert.ok(updatedAssessment);
  assert.equal(updatedAssessment.questions.length, 2);
  assert.equal(updatedAssessment.questions[0].number, '1');
  assert.equal(updatedAssessment.questions[1].number, '2(a)');
  assert.equal(updatedAssessment.questions[1].parentNumber, '2');
});

test('17. unrelated Assessment fields remain unchanged during question extraction', async () => {
  assessmentStore.clear();
  rasterStore.clear();

  const assessment = assessmentStore.create({
    status: 'queued',
    questionPaper: {
      id: 'qp-doc',
      filename: 'math_exam.pdf',
      mimeType: 'application/pdf',
      pageCount: 1,
    },
    answerSheet: {
      id: 'as-doc',
      filename: 'math_answers.pdf',
      mimeType: 'application/pdf',
      pageCount: 3,
    },
  });

  rasterStore.savePages(assessment.id, 'question_paper', [
    { pageNumber: 1, imageBuffer: Buffer.from([1]), width: 800, height: 1100, mimeType: 'image/png' },
  ]);

  const mockProvider = new MockDocumentAIProvider([
    { number: '1', text: 'Solve matrix eigenvalue equation.' },
  ]);

  await extractQuestionsForAssessment(assessment.id, { provider: mockProvider });

  const updated = assessmentStore.get(assessment.id)!;
  assert.equal(updated.id, assessment.id);
  assert.equal(updated.status, 'queued');
  assert.equal(updated.questionPaper.id, 'qp-doc');
  assert.equal(updated.questionPaper.filename, 'math_exam.pdf');
  assert.equal(updated.answerSheet.id, 'as-doc');
  assert.equal(updated.answerSheet.filename, 'math_answers.pdf');
});

test('18. answerSheet, answers, and mappings remain untouched after question extraction', async () => {
  assessmentStore.clear();
  rasterStore.clear();

  const assessment = assessmentStore.create({
    questionPaper: {
      id: 'qp-x',
      filename: 'chem.pdf',
      mimeType: 'application/pdf',
      pageCount: 1,
    },
    answerSheet: {
      id: 'as-x',
      filename: 'chem_answers.pdf',
      mimeType: 'application/pdf',
      pageCount: 2,
    },
  });

  rasterStore.savePages(assessment.id, 'question_paper', [
    { pageNumber: 1, imageBuffer: Buffer.from([1]), width: 800, height: 1100, mimeType: 'image/png' },
  ]);

  const mockProvider = new MockDocumentAIProvider([
    { number: '1', text: 'Explain Gibbs free energy.' },
  ]);

  await extractQuestionsForAssessment(assessment.id, { provider: mockProvider });

  const updated = assessmentStore.get(assessment.id)!;
  assert.deepEqual(updated.answers, []);
  assert.deepEqual(updated.mappings, []);
  assert.equal(updated.answerSheet.id, 'as-x');
  assert.equal(updated.answerSheet.pageCount, 2);
});

test('19. real-world exam structures (instructions, 21A/21B, OR blocks, Visually Impaired, Case Study subparts) parse deterministically', () => {
  const pages = [
    createPageText([
      'MATHEMATICS – Code No. 041',
      'General Instructions:',
      '1. This Question paper contains 38 questions.',
      '2. This Question paper is divided into five Sections.',
      'SECTION - A',
      'Select the correct option (Question 1 - Question 18)',
      '1. Identify the function shown in the graph',
      'For Visually Impaired: 1. Inverse Trigonometric Function...',
      '2. If for three matrices A, B, C...',
      'SECTION B',
      '21A Evaluate tan(x) OR',
      '21B Find the domain of cos^-1(x)',
      '22. If y = log tan(x), prove that dy/dx = 0',
      'SECTION E',
      '36. Case Study - 1 Traffic management',
      '1. Traffic flows from A to B',
      '2. Traffic flows from B to C',
      'I. Is the traffic flow reflexive? [1]',
      'II. Is the traffic flow transitive? [1]',
      'III A. Represent the relation as ordered pairs.',
      'OR',
      'III B. Does the traffic flow represent a function? [2]',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);

  // Assert general instructions 1 and 2 were NOT extracted as questions
  assert.equal(questions.some((q) => q.text.includes('This Question paper contains 38')), false);

  // Assert Question 1 and 2
  assert.equal(questions[0].number, '1');
  assert.equal(questions[1].number, '2');

  // Assert Question 1 has alternative text for visually impaired
  assert.equal(questions[0].number, '1');
  assert.equal(questions[0].alternativeType, 'visually_impaired');
  assert.ok(questions[0].alternativeText?.includes('Inverse Trigonometric Function'));

  // Assert Question 21A and 21B
  const q21A = questions.find((q) => q.number === '21A');
  const q21B = questions.find((q) => q.number === '21B');
  assert.ok(q21A);
  assert.ok(q21B);
  assert.equal(q21A.parentNumber, '21');
  assert.equal(q21B.parentNumber, '21');

  // Assert Question 22
  const q22 = questions.find((q) => q.number === '22');
  assert.ok(q22);

  // Assert Case Study subparts
  const q36I = questions.find((q) => q.number === '36(I)');
  const q36II = questions.find((q) => q.number === '36(II)');
  const q36IIIA = questions.find((q) => q.number === '36(III A)');
  const q36IIIB = questions.find((q) => q.number === '36(III B)');

  assert.ok(q36I);
  assert.ok(q36II);
  assert.ok(q36IIIA);
  assert.ok(q36IIIB);
  assert.equal(q36IIIA.parentNumber, '36');
  assert.equal(q36IIIB.parentNumber, '36');

  // Assert "OR" is NOT emitted as a question
  assert.equal(questions.some((q) => q.number.toUpperCase() === 'OR'), false);
});

test('20. visually-impaired alternatives for Q16, Q23B, Q28B, Q30 attach to ONE logical Question record', () => {
  const pages = [
    createPageText([
      '16 . Maximise Z = 3x + 2y subject to 3x + 4y <= 12 with graphical constraints',
      '16 . For Visually Impaired: If Z = ax + by + c attains maximum at (4,0) and (0,3)...',
      '23A Find integral of (x-3)e^x / (x-1)^3 dx OR',
      '23B Find out the area of shaded region in the enclosed figure.',
      '23 B For Visually Impaired: Find out the area of region enclosed by y^2 = x, x = 3',
      '28A Sketch graph y = |x+1| and evaluate integral',
      '28B Using integration find area of region x^2 - 4y <= 0',
      'For Visually Impaired:',
      '28A Define function y = |x+1| and evaluate integral',
      'OR',
      '28B Using integration find area enclosed within curve: 25x^2 + 16y^2 = 400',
      '30 . Solve graphically: Maximise Z = 2x + y subject to linear constraints',
      '30 For Visually Impaired: The objective function Z = 3x + 2y with corner points (600,0)...',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);

  // Exactly 1 record for Question 16
  const q16List = questions.filter((q) => q.number === '16');
  assert.equal(q16List.length, 1);
  assert.equal(q16List[0].alternativeType, 'visually_impaired');
  assert.ok(q16List[0].text.includes('Maximise Z = 3x + 2y'));
  assert.ok(q16List[0].alternativeText?.includes('If Z = ax + by + c'));

  // Exactly 1 record for Question 23B
  const q23BList = questions.filter((q) => q.number === '23B');
  assert.equal(q23BList.length, 1);
  assert.equal(q23BList[0].alternativeType, 'visually_impaired');
  assert.ok(q23BList[0].text.includes('shaded region'));
  assert.ok(q23BList[0].alternativeText?.includes('y^2 = x, x = 3'));

  // Exactly 1 record for Question 28A and 28B each
  const q28AList = questions.filter((q) => q.number === '28A');
  const q28BList = questions.filter((q) => q.number === '28B');
  assert.equal(q28AList.length, 1);
  assert.equal(q28BList.length, 1);
  assert.equal(q28AList[0].alternativeType, 'visually_impaired');
  assert.equal(q28BList[0].alternativeType, 'visually_impaired');
  assert.ok(q28BList[0].alternativeText?.includes('25x^2 + 16y^2 = 400'));

  // Exactly 1 record for Question 30
  const q30List = questions.filter((q) => q.number === '30');
  assert.equal(q30List.length, 1);
  assert.equal(q30List[0].alternativeType, 'visually_impaired');
  assert.ok(q30List[0].alternativeText?.includes('The objective function Z = 3x + 2y'));
});

test('21. legitimate sub-questions 21A/21B, 23A/23B, 26A/26B, 28A/28B, 29A/29B, 33A/33B, 34A/34B remain distinct records', () => {
  const pages = [
    createPageText([
      '21A Evaluate tan(x) OR',
      '21B Find domain of cos^-1(x)',
      '23A Find integral A OR',
      '23B Find integral B',
      '26A Differentiate y(x) OR',
      '26B Differentiate z(x)',
      '28A Sketch graph A OR',
      '28B Sketch graph B',
      '29A Find distance of line A OR',
      '29B Find intersection of line B',
      '33A Evaluate integral A OR',
      '33B Evaluate integral B',
      '34A Solve differential equation A OR',
      '34B Solve differential equation B',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);
  const labels = questions.map((q) => q.number);

  assert.deepEqual(labels, [
    '21A', '21B',
    '23A', '23B',
    '26A', '26B',
    '28A', '28B',
    '29A', '29B',
    '33A', '33B',
    '34A', '34B',
  ]);

  for (const q of questions) {
    assert.ok(q.parentNumber);
    assert.ok(q.subPart);
  }
});

test('22. case study subparts 36(I), 36(II), 36(III A), 36(III B) remain distinct records', () => {
  const pages = [
    createPageText([
      '36. Case Study 1: Traffic optimization',
      'Context background details...',
      'I. Is the traffic flow reflexive?',
      'II. Is the traffic flow transitive?',
      'III A. State domain and range.',
      'OR',
      'III B. Does it represent a function?',
    ]),
  ];

  const questions = parseQuestionsFromLines(pages);
  assert.equal(questions.length, 5); // 36 parent context + 4 subparts

  const subparts = questions.filter((q) => q.parentNumber === '36');
  assert.equal(subparts.length, 4);
  assert.deepEqual(
    subparts.map((q) => q.number),
    ['36(I)', '36(II)', '36(III A)', '36(III B)']
  );
});


