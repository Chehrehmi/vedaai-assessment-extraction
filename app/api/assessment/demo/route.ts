import { NextRequest, NextResponse } from 'next/server';
import { ensureDemoAssessmentLoaded, DEMO_ASSESSMENT_ID } from '@/lib/demo';

export const dynamic = 'force-dynamic';

/**
 * POST /api/assessment/demo
 * Loads the pre-validated demo assessment and raster pages idempotently.
 */
export async function POST(req: NextRequest) {
  try {
    const assessment = await ensureDemoAssessmentLoaded();
    return NextResponse.json(
      {
        assessmentId: assessment.id,
        status: 'completed',
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('Failed to load demo assessment:', err);
    return NextResponse.json(
      {
        error: {
          code: 'DEMO_LOAD_FAILED',
          message: err?.message || 'Failed to initialize sample demo assessment',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/assessment/demo
 */
export async function GET(req: NextRequest) {
  try {
    const assessment = await ensureDemoAssessmentLoaded();
    return NextResponse.json(
      {
        assessmentId: assessment.id,
        status: 'completed',
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('Failed to load demo assessment:', err);
    return NextResponse.json(
      {
        error: {
          code: 'DEMO_LOAD_FAILED',
          message: err?.message || 'Failed to initialize sample demo assessment',
        },
      },
      { status: 500 }
    );
  }
}
