import { NormalizedBoundingBox } from '../../src/types/extraction';

export type { NormalizedBoundingBox };

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

  const x = Number(normXmin.toFixed(4));
  const y = Number(normYmin.toFixed(4));
  const rawWidth = normXmax - normXmin;
  const rawHeight = normYmax - normYmin;

  if (rawWidth <= 0) {
    throw new Error(`Invalid box width: xmax (${xmax}) must be greater than xmin (${xmin})`);
  }
  if (rawHeight <= 0) {
    throw new Error(`Invalid box height: ymax (${ymax}) must be greater than ymin (${ymin})`);
  }

  // Ensure right and bottom edges stay strictly within [0, 1] page boundaries
  const width = Number(Math.min(rawWidth, 1 - x).toFixed(4));
  const height = Number(Math.min(rawHeight, 1 - y).toFixed(4));

  if (x + width > 1) {
    throw new Error(`Box right edge exceeds 1: x (${x}) + width (${width}) = ${x + width}`);
  }
  if (y + height > 1) {
    throw new Error(`Box bottom edge exceeds 1: y (${y}) + height (${height}) = ${y + height}`);
  }

  return {
    x,
    y,
    width,
    height,
  };
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
