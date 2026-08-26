import { NormalizedBoundingBox, NormalizedBoundingBoxSchema } from '../types/extraction.js';

/**
 * Normalizes Gemini's native 0..1000 integer bounding box [ymin, xmin, ymax, xmax]
 * into VedaAI's standard 0..1 fraction coordinate system { x, y, width, height }.
 */
export function normalizeBox2d(
  box2d: [number, number, number, number] | number[]
): NormalizedBoundingBox {
  if (!Array.isArray(box2d) || box2d.length !== 4) {
    throw new Error(`Invalid box_2d: expected array of 4 numbers, got ${JSON.stringify(box2d)}`);
  }

  const [ymin, xmin, ymax, xmax] = box2d;

  if ([ymin, xmin, ymax, xmax].some((v) => typeof v !== 'number' || isNaN(v))) {
    throw new Error(`Invalid coordinate value: all coordinates must be valid numbers`);
  }

  if (ymin < 0 || xmin < 0 || ymax < 0 || xmax < 0) {
    throw new Error(`Negative coordinates are invalid: [${box2d.join(', ')}]`);
  }

  // Gemini uses 0..1000 scale where 0 is top/left and 1000 is bottom/right
  const normXmin = Math.max(0, Math.min(1, xmin / 1000));
  const normYmin = Math.max(0, Math.min(1, ymin / 1000));
  const normXmax = Math.max(0, Math.min(1, xmax / 1000));
  const normYmax = Math.max(0, Math.min(1, ymax / 1000));

  const x = normXmin;
  const y = normYmin;
  const rawWidth = normXmax - normXmin;
  const rawHeight = normYmax - normYmin;

  if (rawWidth <= 0) {
    throw new Error(`Invalid box width: xmax (${xmax}) must be greater than xmin (${xmin})`);
  }
  if (rawHeight <= 0) {
    throw new Error(`Invalid box height: ymax (${ymax}) must be greater than ymin (${ymin})`);
  }

  const width = Math.min(rawWidth, 1 - x);
  const height = Math.min(rawHeight, 1 - y);

  const result: NormalizedBoundingBox = {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    width: Number(width.toFixed(4)),
    height: Number(height.toFixed(4)),
  };

  // Validate with schema to ensure contract conformance
  return NormalizedBoundingBoxSchema.parse(result);
}

/**
 * Converts normalized 0..1 bounding box to pixel coordinates for rendering/annotations.
 */
export function denormalizeToPixels(
  box: NormalizedBoundingBox,
  pageWidth: number,
  pageHeight: number
): { left: number; top: number; width: number; height: number } {
  if (pageWidth <= 0 || pageHeight <= 0) {
    throw new Error(`Invalid page dimensions: ${pageWidth}x${pageHeight}`);
  }

  return {
    left: Math.round(box.x * pageWidth),
    top: Math.round(box.y * pageHeight),
    width: Math.max(1, Math.round(box.width * pageWidth)),
    height: Math.max(1, Math.round(box.height * pageHeight)),
  };
}
