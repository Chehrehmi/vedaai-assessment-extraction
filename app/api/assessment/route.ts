import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import path from 'path';
import { assessmentStore } from '@/lib/store';
import { rasterStore, rasterizeDocument, isSupportedMimeType } from '@/lib/raster';
import { DocumentMetadata, DocumentPageMetadata } from '@/lib/domain';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB in bytes (10,485,760 bytes)

/**
 * Sanitizes uploaded filenames to prevent path traversal or unsafe characters across all platforms.
 */
function sanitizeFilename(filename: string): string {
  if (!filename) return 'document.pdf';
  const normalized = filename.replace(/\\/g, '/');
  const base = path.posix.basename(normalized);
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.+/g, '.');
  return clean === '.' || clean === '' ? 'document.pdf' : clean;
}

/**
 * Helper to build standard 400 error response.
 */
function errorResponse(code: string, message: string, status = 400) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
      },
    },
    { status }
  );
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return errorResponse(
        'INVALID_REQUEST',
        'Request must be multipart/form-data'
      );
    }

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return errorResponse('INVALID_REQUEST', 'Failed to parse multipart form data');
    }

    const questionPaperEntry = formData.get('questionPaper');
    const answerSheetEntry = formData.get('answerSheet');

    // 1. Check existence
    if (!questionPaperEntry || !(questionPaperEntry instanceof Blob) || (typeof questionPaperEntry === 'string')) {
      return errorResponse('MISSING_FILE', 'Question paper file is required');
    }

    if (!answerSheetEntry || !(answerSheetEntry instanceof Blob) || (typeof answerSheetEntry === 'string')) {
      return errorResponse('MISSING_FILE', 'Answer sheet file is required');
    }

    const qpFile = questionPaperEntry as File;
    const asFile = answerSheetEntry as File;

    // 2. Check file size <= 10MB BEFORE expensive operations
    if (qpFile.size > MAX_FILE_SIZE_BYTES) {
      return errorResponse(
        'FILE_TOO_LARGE',
        `Question paper exceeds 10MB limit (${qpFile.size} bytes > ${MAX_FILE_SIZE_BYTES} bytes)`
      );
    }

    if (asFile.size > MAX_FILE_SIZE_BYTES) {
      return errorResponse(
        'FILE_TOO_LARGE',
        `Answer sheet exceeds 10MB limit (${asFile.size} bytes > ${MAX_FILE_SIZE_BYTES} bytes)`
      );
    }

    // 3. Check MIME types
    const qpMime = qpFile.type || 'application/octet-stream';
    const asMime = asFile.type || 'application/octet-stream';

    if (!isSupportedMimeType(qpMime)) {
      return errorResponse(
        'INVALID_FILE_TYPE',
        `Unsupported question paper MIME type: "${qpMime}". Supported types: application/pdf, image/jpeg, image/png`
      );
    }

    if (!isSupportedMimeType(asMime)) {
      return errorResponse(
        'INVALID_FILE_TYPE',
        `Unsupported answer sheet MIME type: "${asMime}". Supported types: application/pdf, image/jpeg, image/png`
      );
    }

    // 4. Convert files to Buffers
    const qpBuffer = Buffer.from(await qpFile.arrayBuffer());
    const asBuffer = Buffer.from(await asFile.arrayBuffer());

    const assessmentId = randomUUID();
    const qpDocId = randomUUID();
    const asDocId = randomUUID();

    // 5. Rasterize documents
    let qpRaster;
    let asRaster;

    try {
      qpRaster = await rasterizeDocument(qpBuffer, qpMime);
    } catch (err: any) {
      return errorResponse(
        'INVALID_FILE_TYPE',
        `Failed to parse/rasterize question paper: ${err?.message || 'corrupted document'}`
      );
    }

    try {
      asRaster = await rasterizeDocument(asBuffer, asMime);
    } catch (err: any) {
      return errorResponse(
        'INVALID_FILE_TYPE',
        `Failed to parse/rasterize answer sheet: ${err?.message || 'corrupted document'}`
      );
    }

    // 6. Retain rasterized pages in process-lifetime store
    rasterStore.savePages(assessmentId, 'question_paper', qpRaster.pages);
    rasterStore.savePages(assessmentId, 'answer_sheet', asRaster.pages);

    // 7. Construct DocumentMetadata
    const qpPageMetadata: DocumentPageMetadata[] = qpRaster.pages.map((p) => ({
      pageNumber: p.pageNumber,
      width: p.width,
      height: p.height,
      imageUrl: `/api/assessment/${assessmentId}/page/question_paper/${p.pageNumber}`,
    }));

    const asPageMetadata: DocumentPageMetadata[] = asRaster.pages.map((p) => ({
      pageNumber: p.pageNumber,
      width: p.width,
      height: p.height,
      imageUrl: `/api/assessment/${assessmentId}/page/answer_sheet/${p.pageNumber}`,
    }));

    const questionPaperMeta: DocumentMetadata = {
      id: qpDocId,
      filename: sanitizeFilename(qpFile.name || 'question_paper.pdf'),
      mimeType: qpMime,
      pageCount: qpRaster.pageCount,
      pages: qpPageMetadata,
    };

    const answerSheetMeta: DocumentMetadata = {
      id: asDocId,
      filename: sanitizeFilename(asFile.name || 'answer_sheet.pdf'),
      mimeType: asMime,
      pageCount: asRaster.pageCount,
      pages: asPageMetadata,
    };

    // 8. Create Assessment in store with status "queued"
    assessmentStore.create({
      id: assessmentId,
      status: 'queued',
      questionPaper: questionPaperMeta,
      answerSheet: answerSheetMeta,
      questions: [],
      answers: [],
      mappings: [],
      createdAt: new Date().toISOString(),
    });

    // 9. Return HTTP 202
    return NextResponse.json(
      {
        assessmentId,
        status: 'queued',
      },
      { status: 202 }
    );
  } catch (err: any) {
    console.error('Unhandled error in POST /api/assessment:', err);
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while processing the assessment request',
      500
    );
  }
}
