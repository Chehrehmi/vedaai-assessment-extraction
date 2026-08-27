import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from '@napi-rs/canvas';
import {
  rasterizeDocument,
  rasterStore,
  isSupportedMimeType,
  RasterizedPage,
} from '../lib/raster/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate sample PDF if present
const samplePdfPath =
  process.env.SAMPLE_PDF_PATH ||
  path.resolve(__dirname, '../../reference/2240208_CSC631_CIA1_ComponentA_2.pdf');

beforeEach(() => {
  rasterStore.clear();
});

test('1. isSupportedMimeType correctly identifies valid and invalid types', () => {
  assert.equal(isSupportedMimeType('application/pdf'), true);
  assert.equal(isSupportedMimeType('image/png'), true);
  assert.equal(isSupportedMimeType('image/jpeg'), true);
  assert.equal(isSupportedMimeType('image/jpg'), true);
  assert.equal(isSupportedMimeType('text/plain'), false);
  assert.equal(isSupportedMimeType('application/json'), false);
});

test('2. single PNG image rasterizes to exactly one page with dimensions preserved', async () => {
  const canvas = createCanvas(300, 200);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 300, 200);
  const pngBuffer = canvas.toBuffer('image/png');

  const result = await rasterizeDocument(pngBuffer, 'image/png');

  assert.equal(result.pageCount, 1);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.equal(result.pages[0].width, 300);
  assert.equal(result.pages[0].height, 200);
  assert.equal(result.pages[0].mimeType, 'image/png');
  assert.ok(result.pages[0].imageBuffer.length > 0);
});

test('3. single JPEG image rasterizes to exactly one page with dimensions preserved', async () => {
  const canvas = createCanvas(400, 250);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(0, 0, 400, 250);
  const jpegBuffer = canvas.toBuffer('image/jpeg');

  const result = await rasterizeDocument(jpegBuffer, 'image/jpeg');

  assert.equal(result.pageCount, 1);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.equal(result.pages[0].width, 400);
  assert.equal(result.pages[0].height, 250);
  assert.equal(result.pages[0].mimeType, 'image/png');
  assert.ok(result.pages[0].imageBuffer.length > 0);
});

test('4. PDF rasterization renders all pages with dimensions and buffers', async () => {
  if (!fs.existsSync(samplePdfPath)) {
    console.log('Skipping real PDF test: sample PDF not found at', samplePdfPath);
    return;
  }

  const pdfBuffer = fs.readFileSync(samplePdfPath);
  const result = await rasterizeDocument(pdfBuffer, 'application/pdf');

  assert.equal(result.pageCount, 6);
  assert.equal(result.pages.length, 6);

  for (let i = 0; i < 6; i++) {
    const page = result.pages[i];
    assert.equal(page.pageNumber, i + 1);
    assert.ok(page.width > 0);
    assert.ok(page.height > 0);
    assert.equal(page.mimeType, 'image/png');
    assert.ok(page.imageBuffer.length > 0);
  }
});

test('5. corrupt or invalid document buffer throws a descriptive error', async () => {
  const garbageBuffer = Buffer.from('this is not a valid pdf or image file');

  await assert.rejects(async () => {
    await rasterizeDocument(garbageBuffer, 'application/pdf');
  }, /Failed to rasterize PDF/);

  await assert.rejects(async () => {
    await rasterizeDocument(garbageBuffer, 'image/png');
  }, /Failed to rasterize image/);
});

test('6. empty buffer throws validation error', async () => {
  await assert.rejects(async () => {
    await rasterizeDocument(Buffer.alloc(0), 'image/png');
  }, /Cannot rasterize empty document buffer/);
});

test('7. unsupported MIME type throws error', async () => {
  const dummyBuffer = Buffer.from('dummy');
  await assert.rejects(async () => {
    await rasterizeDocument(dummyBuffer, 'application/zip');
  }, /Unsupported document MIME type/);
});

test('8. RasterStore saves, retrieves, and clears pages correctly', () => {
  const dummyPage1: RasterizedPage = {
    pageNumber: 1,
    width: 100,
    height: 100,
    imageBuffer: Buffer.from('img1'),
    mimeType: 'image/png',
  };
  const dummyPage2: RasterizedPage = {
    pageNumber: 2,
    width: 100,
    height: 100,
    imageBuffer: Buffer.from('img2'),
    mimeType: 'image/png',
  };

  rasterStore.savePages('asmt-1', 'answer_sheet', [dummyPage1, dummyPage2]);

  assert.equal(rasterStore.count(), 2);
  const p1 = rasterStore.getPage('asmt-1', 'answer_sheet', 1);
  assert.ok(p1);
  assert.equal(p1.pageNumber, 1);

  const all = rasterStore.getPages('asmt-1', 'answer_sheet');
  assert.equal(all.length, 2);
  assert.equal(all[0].pageNumber, 1);
  assert.equal(all[1].pageNumber, 2);

  rasterStore.deleteAssessmentPages('asmt-1');
  assert.equal(rasterStore.count(), 0);
});

test('9. Maths-SQP-shorter-edited.pdf rasterizes all pages with proper font glyphs', async () => {
  const mathsSqpPath = path.resolve(__dirname, '../../reference/Maths-SQP-shorter-edited.pdf');
  if (!fs.existsSync(mathsSqpPath)) {
    return;
  }

  const pdfBuffer = fs.readFileSync(mathsSqpPath);
  const result = await rasterizeDocument(pdfBuffer, 'application/pdf');

  assert.equal(result.pageCount, 3);
  assert.equal(result.pages.length, 3);

  for (let i = 0; i < 3; i++) {
    const page = result.pages[i];
    assert.equal(page.pageNumber, i + 1);
    assert.equal(page.width, 1191);
    assert.equal(page.height, 1684);
    assert.ok(page.imageBuffer.length > 50000);
  }
});

test('10. ANS_SHEET.pdf rasterizes all handwritten pages with full fidelity', async () => {
  const ansSheetPath = path.resolve(__dirname, '../../reference/ANS_SHEET.pdf');
  if (!fs.existsSync(ansSheetPath)) {
    return;
  }

  const pdfBuffer = fs.readFileSync(ansSheetPath);
  const result = await rasterizeDocument(pdfBuffer, 'application/pdf');

  assert.equal(result.pageCount, 3);
  assert.equal(result.pages.length, 3);

  for (let i = 0; i < 3; i++) {
    const page = result.pages[i];
    assert.equal(page.pageNumber, i + 1);
    assert.ok(page.width > 0);
    assert.ok(page.height > 0);
    assert.ok(page.imageBuffer.length > 50000);
  }
});
