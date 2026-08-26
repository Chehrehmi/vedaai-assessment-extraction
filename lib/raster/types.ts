/**
 * Representation of a rasterized page image in memory.
 */
export interface RasterizedPage {
  pageNumber: number;
  width: number;
  height: number;
  imageBuffer: Buffer;
  mimeType: 'image/png';
}

/**
 * Result of document rasterization.
 */
export interface RasterResult {
  pageCount: number;
  pages: RasterizedPage[];
}
