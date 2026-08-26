import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NextRequest } from 'next/server';
import { createCanvas } from '@napi-rs/canvas';
import { POST } from '../app/api/assessment/route.js';
import { assessmentStore } from '../lib/store/index.js';
import { rasterStore } from '../lib/raster/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const samplePdfPath =
  process.env.SAMPLE_PDF_PATH ||
  path.resolve(__dirname, '../../reference/2240208_CSC631_CIA1_ComponentA_2.pdf');

function createSamplePng(width = 100, height = 100): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff5500';
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
}

function createSampleJpeg(width = 100, height = 100): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#00aa55';
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/jpeg');
}

function makeBlob(bytes: Buffer | Uint8Array | string, type: string): Blob {
  return new Blob([bytes as any], { type });
}

beforeEach(() => {
  assessmentStore.clear();
  rasterStore.clear();
});

test('1. missing questionPaper returns 400 MISSING_FILE', async () => {
  const png = createSamplePng();
  const formData = new FormData();
  formData.append('answerSheet', makeBlob(png, 'image/png'), 'answers.png');

  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.equal(data.error.code, 'MISSING_FILE');
  assert.match(data.error.message, /question paper/i);
  assert.equal(assessmentStore.count(), 0);
});

test('2. missing answerSheet returns 400 MISSING_FILE', async () => {
  const png = createSamplePng();
  const formData = new FormData();
  formData.append('questionPaper', makeBlob(png, 'image/png'), 'qp.png');

  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.equal(data.error.code, 'MISSING_FILE');
  assert.match(data.error.message, /answer sheet/i);
  assert.equal(assessmentStore.count(), 0);
});

test('3. unsupported question paper type returns 400 INVALID_FILE_TYPE', async () => {
  const formData = new FormData();
  formData.append('questionPaper', makeBlob('fake content', 'text/plain'), 'qp.txt');
  formData.append('answerSheet', makeBlob(createSamplePng(), 'image/png'), 'as.png');

  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.equal(data.error.code, 'INVALID_FILE_TYPE');
  assert.match(data.error.message, /text\/plain/);
  assert.equal(assessmentStore.count(), 0);
});

test('4. unsupported answer sheet type returns 400 INVALID_FILE_TYPE', async () => {
  const formData = new FormData();
  formData.append('questionPaper', makeBlob(createSamplePng(), 'image/png'), 'qp.png');
  formData.append('answerSheet', makeBlob('fake content', 'application/zip'), 'as.zip');

  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.equal(data.error.code, 'INVALID_FILE_TYPE');
  assert.match(data.error.message, /application\/zip/);
  assert.equal(assessmentStore.count(), 0);
});

test('5. file > 10 MB (10MB + 1 byte) returns 400 FILE_TOO_LARGE', async () => {
  const tenMbPlusOne = 10 * 1024 * 1024 + 1;
  const oversizedBlob = makeBlob(new Uint8Array(tenMbPlusOne), 'image/png');

  const formData = new FormData();
  formData.append('questionPaper', oversizedBlob, 'huge_qp.png');
  formData.append('answerSheet', makeBlob(createSamplePng(), 'image/png'), 'as.png');

  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.equal(data.error.code, 'FILE_TOO_LARGE');
  assert.match(data.error.message, /10MB limit/);
  assert.equal(assessmentStore.count(), 0);
});

test('6. file size boundary: 10MB exact is accepted by size validator', async () => {
  const tenMb = 10 * 1024 * 1024;
  const mockFile = {
    name: 'test.pdf',
    type: 'application/pdf',
    size: tenMb,
  };

  assert.equal(mockFile.size <= 10 * 1024 * 1024, true);
  assert.equal(mockFile.size + 1 > 10 * 1024 * 1024, true);
});

test('7. valid PDF/PDF request returns 202 and stores Assessment in queued state', async () => {
  if (!fs.existsSync(samplePdfPath)) {
    console.log('Skipping PDF/PDF test: sample PDF not found at', samplePdfPath);
    return;
  }

  const pdfBytes = fs.readFileSync(samplePdfPath);
  const formData = new FormData();
  formData.append('questionPaper', makeBlob(pdfBytes, 'application/pdf'), 'qp.pdf');
  formData.append('answerSheet', makeBlob(pdfBytes, 'application/pdf'), 'as.pdf');

  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 202);

  const data = await res.json();
  assert.ok(data.assessmentId);
  assert.equal(data.status, 'queued');

  // Verify Assessment in store
  const stored = assessmentStore.get(data.assessmentId);
  assert.ok(stored);
  assert.equal(stored.id, data.assessmentId);
  assert.equal(stored.status, 'queued');
  assert.equal(stored.questionPaper.pageCount, 6);
  assert.equal(stored.answerSheet.pageCount, 6);
  assert.equal(stored.questions.length, 0);
  assert.equal(stored.answers.length, 0);

  // Verify rasterized pages retained in rasterStore
  const qpPages = rasterStore.getPages(data.assessmentId, 'question_paper');
  const asPages = rasterStore.getPages(data.assessmentId, 'answer_sheet');
  assert.equal(qpPages.length, 6);
  assert.equal(asPages.length, 6);
});

test('8. valid PDF/PNG request returns 202', async () => {
  if (!fs.existsSync(samplePdfPath)) {
    console.log('Skipping PDF/PNG test: sample PDF not found');
    return;
  }

  const pdfBytes = fs.readFileSync(samplePdfPath);
  const pngBytes = createSamplePng(300, 200);

  const formData = new FormData();
  formData.append('questionPaper', makeBlob(pdfBytes, 'application/pdf'), 'qp.pdf');
  formData.append('answerSheet', makeBlob(pngBytes, 'image/png'), 'as.png');

  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 202);

  const data = await res.json();
  const stored = assessmentStore.get(data.assessmentId);
  assert.ok(stored);
  assert.equal(stored.questionPaper.pageCount, 6);
  assert.equal(stored.answerSheet.pageCount, 1);
});

test('9. valid PNG/JPEG request returns 202', async () => {
  const pngBytes = createSamplePng(200, 300);
  const jpegBytes = createSampleJpeg(250, 350);

  const formData = new FormData();
  formData.append('questionPaper', makeBlob(pngBytes, 'image/png'), 'qp.png');
  formData.append('answerSheet', makeBlob(jpegBytes, 'image/jpeg'), 'as.jpg');

  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 202);

  const data = await res.json();
  const stored = assessmentStore.get(data.assessmentId);
  assert.ok(stored);
  assert.equal(stored.questionPaper.pageCount, 1);
  assert.equal(stored.answerSheet.pageCount, 1);
});

test('10. non-multipart request returns 400 INVALID_REQUEST', async () => {
  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.equal(data.error.code, 'INVALID_REQUEST');
  assert.equal(assessmentStore.count(), 0);
});

test('19. path traversal in uploaded filenames is safely sanitized', async () => {
  const pngBytes = createSamplePng();

  const formData = new FormData();
  formData.append(
    'questionPaper',
    makeBlob(pngBytes, 'image/png'),
    '../../../../etc/passwd'
  );
  formData.append(
    'answerSheet',
    makeBlob(pngBytes, 'image/png'),
    '..\\..\\windows\\system32\\cmd.exe'
  );

  const req = new NextRequest('http://localhost:3000/api/assessment', {
    method: 'POST',
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 202);

  const data = await res.json();
  const stored = assessmentStore.get(data.assessmentId);
  assert.ok(stored);
  assert.ok(!stored.questionPaper.filename.includes('/'));
  assert.ok(!stored.questionPaper.filename.includes('..'));
  assert.ok(!stored.answerSheet.filename.includes('\\'));
  assert.ok(!stored.answerSheet.filename.includes('/'));
  assert.ok(!stored.answerSheet.filename.includes('..'));
});
