import { NextRequest, NextResponse } from 'next/server';
import { rasterStore, DocumentType } from '@/lib/raster';

export const dynamic = 'force-dynamic';

function normalizeDocType(raw: string): DocumentType | null {
  const lower = raw.toLowerCase().replace(/[-_]/g, '');
  if (lower === 'questionpaper' || lower === 'qp') {
    return 'question_paper';
  }
  if (lower === 'answersheet' || lower === 'as') {
    return 'answer_sheet';
  }
  return null;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; docType: string; pageNumber: string }> }
) {
  try {
    const { id, docType, pageNumber } = await context.params;
    const normalizedType = normalizeDocType(docType);

    if (!normalizedType) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_DOC_TYPE',
            message: `Unsupported document type: ${docType}. Must be "question_paper" or "answer_sheet"`,
          },
        },
        { status: 400 }
      );
    }

    const pageNum = parseInt(pageNumber, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_PAGE_NUMBER',
            message: `Invalid page number: ${pageNumber}`,
          },
        },
        { status: 400 }
      );
    }

    const page = rasterStore.getPage(id, normalizedType, pageNum);

    if (!page) {
      return NextResponse.json(
        {
          error: {
            code: 'PAGE_NOT_FOUND',
            message: `Page ${pageNum} of ${normalizedType} for assessment ${id} not found`,
          },
        },
        { status: 404 }
      );
    }

    // Convert Buffer to Uint8Array for standard web Response body
    const bodyData = new Uint8Array(page.imageBuffer);

    return new NextResponse(bodyData, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': page.imageBuffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err: any) {
    console.error('Error serving rasterized page image:', err);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while fetching page image',
        },
      },
      { status: 500 }
    );
  }
}
