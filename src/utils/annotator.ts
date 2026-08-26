import { createCanvas, loadImage } from '@napi-rs/canvas';
import { NormalizedAnswerBlock } from '../types/extraction.js';
import { denormalizeToPixels } from './coordinates.js';

const PALETTE = [
  { stroke: '#4F46E5', fill: 'rgba(79, 70, 229, 0.12)', badge: '#4F46E5', text: '#FFFFFF' }, // Indigo
  { stroke: '#059669', fill: 'rgba(5, 150, 105, 0.12)', badge: '#059669', text: '#FFFFFF' }, // Emerald
  { stroke: '#D97706', fill: 'rgba(217, 119, 6, 0.12)', badge: '#D97706', text: '#FFFFFF' }, // Amber
  { stroke: '#DC2626', fill: 'rgba(220, 38, 38, 0.12)', badge: '#DC2626', text: '#FFFFFF' }, // Red
  { stroke: '#7C3AED', fill: 'rgba(124, 58, 237, 0.12)', badge: '#7C3AED', text: '#FFFFFF' }, // Violet
];

export async function createAnnotatedPageImage(
  imageBuffer: Buffer,
  pageNumber: number,
  blocks: NormalizedAnswerBlock[]
): Promise<Buffer> {
  const image = await loadImage(imageBuffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  // Draw original base page
  ctx.drawImage(image, 0, 0);

  // Draw each detected answer block
  blocks.forEach((block, index) => {
    const color = PALETTE[index % PALETTE.length];
    const px = denormalizeToPixels(block.boundingBox, image.width, image.height);

    // 1. Semi-transparent highlight fill
    ctx.fillStyle = color.fill;
    ctx.fillRect(px.left, px.top, px.width, px.height);

    // 2. Crisp bounding box border
    ctx.strokeStyle = color.stroke;
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    ctx.strokeRect(px.left, px.top, px.width, px.height);

    // 3. Badge label
    const qLabel = block.detectedQuestionReference ? `Q: ${block.detectedQuestionReference}` : 'Continuation/Unlabeled';
    const confLabel = `${Math.round(block.confidence * 100)}% conf`;
    const labelText = `[Block #${index + 1}] ${qLabel} (${confLabel})`;

    ctx.font = 'bold 20px sans-serif';
    const textMetrics = ctx.measureText(labelText);
    const badgePaddingX = 10;
    const badgePaddingY = 6;
    const badgeWidth = textMetrics.width + badgePaddingX * 2;
    const badgeHeight = 28;

    // Position badge above box, or just inside top if near top of image
    let badgeY = px.top - badgeHeight;
    if (badgeY < 5) {
      badgeY = px.top + 5;
    }
    const badgeX = Math.max(5, Math.min(px.left, image.width - badgeWidth - 5));

    // Badge background
    ctx.fillStyle = color.badge;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 6);
    ctx.fill();

    // Badge text
    ctx.fillStyle = color.text;
    ctx.fillText(labelText, badgeX + badgePaddingX, badgeY + badgeHeight - 7);
  });

  return canvas.toBuffer('image/png');
}
