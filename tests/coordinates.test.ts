import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBox2d, denormalizeToPixels } from '../src/utils/coordinates.js';
import { RawGeminiResponseSchema, NormalizedAnswerBlockSchema } from '../src/types/extraction.js';

test('normalizeBox2d: converts 0..1000 integer coordinates to 0..1 fractions', () => {
  const box2d = [150, 50, 950, 850];
  const normalized = normalizeBox2d(box2d);

  assert.equal(normalized.x, 0.05);
  assert.equal(normalized.y, 0.15);
  assert.equal(normalized.width, 0.80);
  assert.equal(normalized.height, 0.80);
});

test('normalizeBox2d: correctly handles full-page bounds [0, 0, 1000, 1000]', () => {
  const box2d = [0, 0, 1000, 1000];
  const normalized = normalizeBox2d(box2d);

  assert.equal(normalized.x, 0);
  assert.equal(normalized.y, 0);
  assert.equal(normalized.width, 1);
  assert.equal(normalized.height, 1);
});

test('normalizeBox2d: clamps slight out-of-bounds coordinates to [0, 1]', () => {
  const box2d = [100, 200, 1050, 990];
  const normalized = normalizeBox2d(box2d);

  assert.equal(normalized.x, 0.2);
  assert.equal(normalized.y, 0.1);
  assert.equal(normalized.width, 0.79);
  assert.equal(normalized.height, 0.9);
  assert.ok(normalized.y + normalized.height <= 1.0);
});

test('normalizeBox2d: throws on negative coordinates', () => {
  assert.throws(() => {
    normalizeBox2d([-10, 50, 500, 600]);
  }, /Negative coordinates are invalid/);
});

test('normalizeBox2d: throws on inverted coordinates (xmax <= xmin or ymax <= ymin)', () => {
  assert.throws(() => {
    normalizeBox2d([500, 600, 400, 700]);
  }, /Invalid box height/);

  assert.throws(() => {
    normalizeBox2d([100, 800, 500, 200]);
  }, /Invalid box width/);
});

test('normalizeBox2d: throws on non-array or wrong length', () => {
  assert.throws(() => {
    normalizeBox2d([100, 200, 300] as any);
  }, /Invalid box_2d: expected array of 4 numbers/);
});

test('denormalizeToPixels: maps fractions to integer pixel coordinates', () => {
  const box = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
  const px = denormalizeToPixels(box, 1000, 2000);

  assert.equal(px.left, 100);
  assert.equal(px.top, 400);
  assert.equal(px.width, 500);
  assert.equal(px.height, 1200);
});

test('RawGeminiResponseSchema: validates valid model JSON array', () => {
  const rawData = [
    {
      detectedQuestionReference: 'Q1',
      box_2d: [154, 0, 975, 995],
      text: 'Sample answer text',
      confidence: 0.95,
    },
    {
      detectedQuestionReference: null,
      box_2d: [100, 50, 400, 600],
      text: 'Continuation text',
      confidence: 0.88,
    }
  ];

  const parsed = RawGeminiResponseSchema.safeParse(rawData);
  assert.ok(parsed.success);
  assert.equal(parsed.data.length, 2);
  assert.equal(parsed.data[0].detectedQuestionReference, 'Q1');
  assert.equal(parsed.data[1].detectedQuestionReference, null);
});

test('RawGeminiResponseSchema: rejects malformed model output', () => {
  // Non-array
  assert.ok(!RawGeminiResponseSchema.safeParse({ box_2d: [0, 0, 100, 100] }).success);

  // Missing box_2d
  assert.ok(!RawGeminiResponseSchema.safeParse([{ text: 'hi', confidence: 0.9 }]).success);

  // Confidence > 1
  assert.ok(!RawGeminiResponseSchema.safeParse([{ box_2d: [0, 0, 100, 100], text: 'hi', confidence: 1.5 }]).success);

  // Confidence < 0
  assert.ok(!RawGeminiResponseSchema.safeParse([{ box_2d: [0, 0, 100, 100], text: 'hi', confidence: -0.1 }]).success);
});

test('NormalizedAnswerBlockSchema: validates normalized domain object', () => {
  const block = {
    pageNumber: 1,
    detectedQuestionReference: 'Q1',
    boundingBox: { x: 0.1, y: 0.15, width: 0.8, height: 0.7 },
    text: 'Valid answer',
    confidence: 0.95,
  };

  const parsed = NormalizedAnswerBlockSchema.safeParse(block);
  assert.ok(parsed.success);
});
