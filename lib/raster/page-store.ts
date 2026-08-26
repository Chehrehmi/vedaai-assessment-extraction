import { RasterizedPage } from './types';

export type DocumentType = 'question_paper' | 'answer_sheet';

/**
 * In-memory process-lifetime storage for rasterized page image buffers.
 * Key format: `${assessmentId}:${docType}:${pageNumber}`
 */
export class RasterStore {
  private readonly store = new Map<string, RasterizedPage>();

  private makeKey(assessmentId: string, docType: DocumentType, pageNumber: number): string {
    return `${assessmentId}:${docType}:${pageNumber}`;
  }

  /**
   * Stores rasterized pages for an assessment document.
   */
  savePages(assessmentId: string, docType: DocumentType, pages: RasterizedPage[]): void {
    for (const page of pages) {
      const key = this.makeKey(assessmentId, docType, page.pageNumber);
      this.store.set(key, page);
    }
  }

  /**
   * Retrieves a specific page image by assessment, document type, and page number.
   */
  getPage(assessmentId: string, docType: DocumentType, pageNumber: number): RasterizedPage | undefined {
    const key = this.makeKey(assessmentId, docType, pageNumber);
    return this.store.get(key);
  }

  /**
   * Retrieves all pages for an assessment document, sorted by pageNumber.
   */
  getPages(assessmentId: string, docType: DocumentType): RasterizedPage[] {
    const prefix = `${assessmentId}:${docType}:`;
    const results: RasterizedPage[] = [];
    for (const [key, val] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        results.push(val);
      }
    }
    return results.sort((a, b) => a.pageNumber - b.pageNumber);
  }

  /**
   * Deletes all pages for a given assessment.
   */
  deleteAssessmentPages(assessmentId: string): void {
    const prefix = `${assessmentId}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Clears the entire store (for testing isolation).
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Returns total count of stored pages across all assessments.
   */
  count(): number {
    return this.store.size;
  }
}

/**
 * Process-lifetime singleton instance.
 */
export const rasterStore = new RasterStore();
