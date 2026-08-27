import { NextRequest, NextResponse } from 'next/server';
import { assessmentStore } from '@/lib/store';
import { isDemoAssessment, ensureDemoAssessmentLoaded } from '@/lib/demo';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let assessment = assessmentStore.get(id);

    if (!assessment && isDemoAssessment(id)) {
      assessment = await ensureDemoAssessmentLoaded();
    }

    if (!assessment) {
      return NextResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Assessment session not found: ${id}`,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        id: assessment.id,
        status: assessment.status,
        errorCode: assessment.errorCode,
        errorMessage: assessment.errorMessage,
        questionCount: assessment.questions?.length ?? 0,
        answerCount: assessment.answers?.length ?? 0,
        mappingCount: assessment.mappings?.length ?? 0,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('Error fetching assessment status:', err);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while checking assessment status',
        },
      },
      { status: 500 }
    );
  }
}
