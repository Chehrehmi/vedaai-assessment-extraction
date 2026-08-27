import fs from 'fs';
import path from 'path';
import { Assessment, Question, Answer, AnswerMapping } from '../domain/types';
import { assessmentStore } from '../store';
import { rasterStore, rasterizeDocument } from '../raster';
import { extractQuestions } from '../extraction/question-extractor';
import { mapAnswersDeterministically } from '../mapping/deterministic-mapper';
import { evaluateAssessment } from '../grading';

export const DEMO_ASSESSMENT_ID = 'demo-cbse-maths-assessment';

export function isDemoAssessment(id: string): boolean {
  return id === DEMO_ASSESSMENT_ID || id.startsWith('demo-');
}

/**
 * Validated handwritten student answers extracted from ANS_SHEET.pdf:
 * - Answer 1: Student answered Q1 on Page 1 and continued on Page 2.
 * - Answer 2: Student answered Q2 starting on Page 2 and continued on Page 3.
 * - Q3 through Q16 were intentionally left unanswered by the student.
 */
export const DEMO_ANSWERS: Answer[] = [
  {
    id: 'demo-ans-1',
    rawText:
      'Ans 1.\nGiven: graph of y = f(x)\nThe curve intersects x-axis at x = -2, 0, 2.\nf(x) = x(x-2)(x+2) = x(x² - 4) = x³ - 4x.\nVerification: f(-x) = -f(x), odd function symmetric about origin.\nHence option (B) is the correct answer.',
    pages: [1, 2],
    regions: [
      { page: 1, x: 0.05, y: 0.08, width: 0.90, height: 0.86, extractionConfidence: 0.95 },
      { page: 2, x: 0.05, y: 0.05, width: 0.90, height: 0.35, extractionConfidence: 0.95 },
    ],
    detectedQuestionReference: '1',
  },
  {
    id: 'demo-ans-2',
    rawText:
      'Ans 2.\nGiven matrices A = [a_ij] (m×4), B = [b_ij] (n×3), C = [c_ij] (p×q).\nFor AB to be defined: columns of A = rows of B => n = 4, order of AB = m×3.\nFor AC to be defined: columns of A = rows of C => p = 4, order of AC = m×q.\nSince AB and AC are square matrices of same order:\nm = 3, q = 3, n = 4, p = 4.\nMatching option: (A) m = q = 3 and n = p = 4.',
    pages: [2, 3],
    regions: [
      { page: 2, x: 0.05, y: 0.42, width: 0.90, height: 0.54, extractionConfidence: 0.95 },
      { page: 3, x: 0.05, y: 0.06, width: 0.90, height: 0.88, extractionConfidence: 0.95 },
    ],
    detectedQuestionReference: '2',
  },
];

/**
 * Resolves local file paths for sample PDFs with fallbacks.
 */
function resolveSamplePdf(filename: string): Buffer {
  const primaryPath = path.join(process.cwd(), 'fixtures', filename);
  if (fs.existsSync(primaryPath)) {
    return fs.readFileSync(primaryPath);
  }

  const fallbackRefPath = path.resolve(process.cwd(), '..', 'reference', filename);
  if (fs.existsSync(/*turbopackIgnore: true*/ fallbackRefPath)) {
    return fs.readFileSync(/*turbopackIgnore: true*/ fallbackRefPath);
  }

  throw new Error(`Demo sample PDF file not found: ${filename}. Checked: ${primaryPath}, ${fallbackRefPath}`);
}

/**
 * Loads the validated Demo Assessment into assessmentStore and rasterStore idempotently.
 * - Extracts all 16 questions deterministically from Maths-SQP-shorter-edited.pdf
 * - Renders high-res raster pages for question paper (3 pages) and answer sheet (3 pages)
 * - Deterministically maps Q1 and Q2 to student answers; classifies Q3..Q16 as unanswered
 */
export async function ensureDemoAssessmentLoaded(): Promise<Assessment> {
  const existing = assessmentStore.get(DEMO_ASSESSMENT_ID);
  const qpPagesExisting = rasterStore.getPage(DEMO_ASSESSMENT_ID, 'question_paper', 1);

  if (existing && existing.status === 'completed' && qpPagesExisting && existing.gradingSummary) {
    return existing;
  }

  // 1. Load and rasterize sample PDFs
  const qpBuffer = resolveSamplePdf('Maths-SQP-shorter-edited.pdf');
  const asBuffer = resolveSamplePdf('ANS_SHEET.pdf');

  const qpRaster = await rasterizeDocument(qpBuffer, 'application/pdf');
  const asRaster = await rasterizeDocument(asBuffer, 'application/pdf');

  // Save raster pages into rasterStore
  rasterStore.savePages(DEMO_ASSESSMENT_ID, 'question_paper', qpRaster.pages);
  rasterStore.savePages(DEMO_ASSESSMENT_ID, 'answer_sheet', asRaster.pages);

  // 2. Deterministically extract 16 questions from question paper text layer
  const extractionResult = await extractQuestions({ pdfBuffer: qpBuffer, pageImages: [] });
  const questions = extractionResult.questions;

  // 3. Deterministically map extracted questions to DEMO_ANSWERS
  const mappingResult = mapAnswersDeterministically(questions, DEMO_ANSWERS);

  // 4. Deterministically evaluate grading & feedback
  const gradingSummary = evaluateAssessment({
    questions,
    answers: DEMO_ANSWERS,
    mappings: mappingResult.mappings,
  });

  // If already exists in assessmentStore (e.g. from previous load without raster), delete first
  if (existing) {
    assessmentStore.delete(DEMO_ASSESSMENT_ID);
  }

  const assessment = assessmentStore.create({
    id: DEMO_ASSESSMENT_ID,
    status: 'completed',
    questionPaper: {
      id: 'demo-qp-doc',
      filename: 'Maths-SQP-shorter-edited.pdf (Sample)',
      mimeType: 'application/pdf',
      pageCount: qpRaster.pageCount,
      pages: qpRaster.pages.map((p) => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        imageUrl: `/api/assessment/${DEMO_ASSESSMENT_ID}/page/question_paper/${p.pageNumber}`,
      })),
    },
    answerSheet: {
      id: 'demo-as-doc',
      filename: 'ANS_SHEET.pdf (Sample)',
      mimeType: 'application/pdf',
      pageCount: asRaster.pageCount,
      pages: asRaster.pages.map((p) => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        imageUrl: `/api/assessment/${DEMO_ASSESSMENT_ID}/page/answer_sheet/${p.pageNumber}`,
      })),
    },
    questions,
    answers: DEMO_ANSWERS,
    mappings: mappingResult.mappings,
    gradingSummary,
    createdAt: new Date().toISOString(),
  });

  return assessment;
}
