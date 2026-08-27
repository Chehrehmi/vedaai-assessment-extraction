'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Assessment, Question, Answer, AnswerMapping } from '@/lib/domain/types';
import { ProcessingStepper } from '@/components/assessment/ProcessingStepper';
import { QuestionList } from '@/components/assessment/QuestionList';
import { DocumentViewer, ActiveDocType } from '@/components/assessment/DocumentViewer';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function AssessmentReviewPage({ params }: PageProps) {
  const { id: assessmentId } = use(params);
  const router = useRouter();

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [pollStage, setPollStage] = useState<string>('queued');
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  // Workspace interaction state
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | undefined>();
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | undefined>();
  const [activeDocType, setActiveDocType] = useState<ActiveDocType>('answer_sheet');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [mobileActiveTab, setMobileActiveTab] = useState<'questions' | 'viewer'>('questions');

  // Fetch full assessment payload
  const fetchFullAssessment = useCallback(async () => {
    try {
      const res = await fetch(`/api/assessment/${assessmentId}`);
      if (res.ok) {
        const data: Assessment = await res.json();
        setAssessment(data);
        setPollStage(data.status);
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Failed to fetch full assessment:', err);
    }
  }, [assessmentId]);

  // Polling loop for processing status
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    let isSubscribed = true;

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/assessment/${assessmentId}/status`);
        if (!res.ok) {
          if (res.status === 404) {
            setPollStage('failed');
            setErrorCode('NOT_FOUND');
            setErrorMessage('Assessment session not found or expired.');
            setIsLoading(false);
            return;
          }
        }

        const data = await res.json();
        if (!isSubscribed) return;

        setPollStage(data.status);
        if (data.errorCode) setErrorCode(data.errorCode);
        if (data.errorMessage) setErrorMessage(data.errorMessage);

        if (data.status === 'completed') {
          await fetchFullAssessment();
          return;
        }

        if (data.status === 'failed') {
          setIsLoading(false);
          return;
        }

        // Continue polling every 800ms
        timer = setTimeout(pollStatus, 800);
      } catch (err: any) {
        console.error('Polling error:', err);
        if (isSubscribed) {
          timer = setTimeout(pollStatus, 1200);
        }
      }
    };

    pollStatus();

    return () => {
      isSubscribed = false;
      if (timer) clearTimeout(timer);
    };
  }, [assessmentId, fetchFullAssessment]);

  // Handlers for Question and Answer selection
  const handleSelectQuestion = (
    question: Question,
    mapping?: AnswerMapping,
    answer?: Answer
  ) => {
    setSelectedQuestionId(question.id);
    setSelectedAnswerId(answer?.id);

    if (mapping && mapping.status !== 'unanswered' && answer && answer.regions.length > 0) {
      setActiveDocType('answer_sheet');
      // Set page to the first region's page
      const firstRegionPage = answer.regions[0].page;
      if (firstRegionPage) {
        setCurrentPage(firstRegionPage);
      }
      // On mobile, auto-switch to viewer tab
      if (window.innerWidth < 1024) {
        setMobileActiveTab('viewer');
      }
    }
  };

  const handleSelectUnmatchedAnswer = (answer: Answer) => {
    setSelectedQuestionId(undefined);
    setSelectedAnswerId(answer.id);
    setActiveDocType('answer_sheet');

    if (answer.regions.length > 0) {
      setCurrentPage(answer.regions[0].page);
    }

    if (window.innerWidth < 1024) {
      setMobileActiveTab('viewer');
    }
  };

  const handleJumpToPage = (page: number) => {
    setActiveDocType('answer_sheet');
    setCurrentPage(page);
    if (window.innerWidth < 1024) {
      setMobileActiveTab('viewer');
    }
  };

  // Derive active highlight regions based on current selection
  const getActiveHighlightData = () => {
    if (!assessment) return { regions: [], status: 'matched' as const, label: undefined, confidence: undefined };

    // 1. If an answer is selected directly (e.g. via unmatched panel or question mapping)
    if (selectedAnswerId) {
      const answer = assessment.answers.find((a) => a.id === selectedAnswerId);
      if (answer) {
        const mapping = assessment.mappings.find((m) => m.answerId === selectedAnswerId);
        const question = mapping ? assessment.questions.find((q) => q.id === mapping.questionId) : undefined;

        return {
          regions: answer.regions || [],
          status: mapping?.status || 'matched',
          label: question ? `Q${question.number}` : answer.detectedQuestionReference ? `Ans ${answer.detectedQuestionReference}` : 'Answer',
          confidence: mapping?.confidence ?? answer.regions[0]?.extractionConfidence,
        };
      }
    }

    // 2. If a question is selected with mapped answer
    if (selectedQuestionId) {
      const mapping = assessment.mappings.find((m) => m.questionId === selectedQuestionId);
      if (mapping && mapping.status !== 'unanswered' && mapping.answerId) {
        const answer = assessment.answers.find((a) => a.id === mapping.answerId);
        const question = assessment.questions.find((q) => q.id === selectedQuestionId);
        if (answer) {
          return {
            regions: answer.regions || [],
            status: mapping.status,
            label: question ? `Q${question.number}` : 'Answer',
            confidence: mapping.confidence,
          };
        }
      }
    }

    return { regions: [], status: 'matched' as const, label: undefined, confidence: undefined };
  };

  const highlightData = getActiveHighlightData();

  // If still processing or failed, show Processing Stepper screen
  if (pollStage !== 'completed' || !assessment) {
    return (
      <div className="flex h-screen overflow-hidden bg-[#fff8f6] text-[#241916]">
        {/* Sidebar */}
        <nav className="w-64 bg-white border-r border-[#dfc0b7]/40 h-full hidden lg:flex flex-col py-6 px-4 shrink-0 shadow-sm z-50">
          <div className="flex items-center gap-2.5 mb-8 px-2">
            <img src="/logo.png" alt="VedaAI Logo" className="h-7 w-auto object-contain" />
            <span className="font-extrabold text-2xl tracking-tight text-[#241916]">VedaAI</span>
          </div>

          <div className="flex flex-col flex-1 gap-2">
            <Link href="/exams" className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[#e4e2e1] font-semibold text-[#241916] border-l-4 border-[#a63b17]">
              <span className="material-symbols-outlined">inventory_2</span>
              <span>Exams</span>
            </Link>
          </div>

          <div className="mt-auto pt-4 border-t border-[#dfc0b7]/30">
            <div className="p-3 bg-[#fff1ed] rounded-xl flex items-center gap-3 border border-[#dfc0b7]/30">
              <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow-sm text-[#a63b17]">
                <span className="material-symbols-outlined text-[20px]">school</span>
              </div>
              <div className="min-w-0">
                <p className="font-bold text-xs text-[#241916] truncate">Delhi Public School</p>
                <p className="text-[10px] text-[#57423b] truncate">Bokaro Steel City</p>
              </div>
            </div>
          </div>
        </nav>

        <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 bg-[#fff8f6] overflow-y-auto">
          <ProcessingStepper
            stage={pollStage as any}
            errorCode={errorCode}
            errorMessage={errorMessage}
            onRetry={() => {
              setPollStage('queued');
              setIsLoading(true);
              router.refresh();
            }}
            onUploadDifferent={() => router.push('/exams')}
          />
        </main>
      </div>
    );
  }

  // Once completed: render the Dual-Pane Assessment Workspace
  return (
    <div className="flex h-screen overflow-hidden bg-[#fff8f6] text-[#241916]">
      {/* Sidebar */}
      <nav className="w-64 bg-white border-r border-[#dfc0b7]/40 h-full hidden lg:flex flex-col py-6 px-4 shrink-0 shadow-sm z-50">
        <div className="flex items-center gap-2.5 mb-6 px-2">
          <img src="/logo.png" alt="VedaAI Logo" className="h-7 w-auto object-contain" />
          <span className="font-extrabold text-2xl tracking-tight text-[#241916]">VedaAI</span>
        </div>

        <Link
          href="/exams"
          className="w-full bg-[#241916] text-white rounded-full py-2.5 px-4 flex items-center justify-center gap-2 mb-6 hover:bg-black transition-colors shadow-sm text-xs font-bold"
        >
          <span className="material-symbols-outlined text-[16px]">upload_file</span>
          <span>New Assessment</span>
        </Link>

        <div className="flex flex-col flex-1 gap-1.5">
          <a href="#" className="flex items-center gap-3 px-4 py-2 rounded-lg text-[#57423b] hover:bg-[#ffe9e3]/50 text-xs">
            <span className="material-symbols-outlined text-[18px]">grid_view</span>
            <span>Home</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-2 rounded-lg text-[#57423b] hover:bg-[#ffe9e3]/50 text-xs">
            <span className="material-symbols-outlined text-[18px]">groups</span>
            <span>My Classroom</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-2 rounded-lg text-[#57423b] hover:bg-[#ffe9e3]/50 text-xs">
            <span className="material-symbols-outlined text-[18px]">description</span>
            <span>Assignments</span>
          </a>
          <Link href="/exams" className="flex items-center gap-3 px-4 py-2 rounded-lg bg-[#e4e2e1] font-semibold text-[#241916] border-l-4 border-[#a63b17] text-xs">
            <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            <span>Exams</span>
          </Link>
        </div>

        <div className="mt-auto pt-4 border-t border-[#dfc0b7]/30">
          <div className="p-3 bg-[#fff1ed] rounded-xl flex items-center gap-3 border border-[#dfc0b7]/30">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm text-[#a63b17]">
              <span className="material-symbols-outlined text-[18px]">school</span>
            </div>
            <div className="min-w-0">
              <p className="font-bold text-xs text-[#241916] truncate">Delhi Public School</p>
              <p className="text-[10px] text-[#57423b] truncate">Bokaro Steel City</p>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top App Header */}
        <header className="px-3 sm:px-6 py-2.5 sm:py-3 bg-white border-b border-[#dfc0b7]/40 flex flex-col gap-2 shrink-0 shadow-2xs z-30">
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <Link
                href="/exams"
                className="p-1.5 rounded-lg hover:bg-[#fff1ed] text-[#57423b] transition-colors shrink-0"
                title="Back to Uploads"
              >
                <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h1 className="font-extrabold text-sm sm:text-base text-[#241916] truncate">
                    {assessment.questionPaper.filename || 'Exam Assessment'}
                  </h1>
                  {(assessment.id.startsWith('demo-') || assessmentId.startsWith('demo-')) && (
                    <span className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#fae3dd] text-[#a63b17] border border-[#dfc0b7]/60 shrink-0">
                      Sample Assessment
                    </span>
                  )}
                  <span className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#78dc77]/20 text-[#006e1c] shrink-0">
                    Completed
                  </span>
                </div>
                <p className="text-[10px] sm:text-[11px] text-[#57423b] mt-0.5 truncate hidden sm:block">
                  Answer Sheet: {assessment.answerSheet.filename} • {assessment.questions.length} Questions Extracted
                </p>
              </div>
            </div>
          </div>

          {/* Mobile Segmented Tab Switcher (Full-width, clearly accessible on mobile/tablet < lg) */}
          <div className="flex lg:hidden items-center bg-[#fff1ed] p-1 rounded-xl border border-[#dfc0b7]/50 text-xs font-bold w-full shadow-2xs">
            <button
              type="button"
              onClick={() => setMobileActiveTab('questions')}
              className={`flex-1 py-2 px-2.5 rounded-lg transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                mobileActiveTab === 'questions'
                  ? 'bg-[#241916] text-white shadow-2xs'
                  : 'text-[#57423b] hover:text-[#241916]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">format_list_bulleted</span>
              <span>Questions ({assessment.questions.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileActiveTab('viewer')}
              className={`flex-1 py-2 px-2.5 rounded-lg transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                mobileActiveTab === 'viewer'
                  ? 'bg-[#241916] text-white shadow-2xs'
                  : 'text-[#57423b] hover:text-[#241916]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {activeDocType === 'answer_sheet' ? 'edit_note' : 'description'}
              </span>
              <span>{activeDocType === 'answer_sheet' ? 'Answer Sheet' : 'Question Paper'}</span>
            </button>
          </div>
        </header>

        {/* Dual-Pane Workspace */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Left Pane: Questions & Mappings List (5/12 width on desktop) */}
          <div
            className={`w-full lg:w-5/12 h-full flex flex-col shrink-0 overflow-hidden ${
              mobileActiveTab === 'questions' ? 'flex' : 'hidden lg:flex'
            }`}
          >
            <QuestionList
              questions={assessment.questions}
              mappings={assessment.mappings}
              answers={assessment.answers}
              gradingSummary={assessment.gradingSummary}
              selectedQuestionId={selectedQuestionId}
              selectedAnswerId={selectedAnswerId}
              onSelectQuestion={handleSelectQuestion}
              onSelectUnmatchedAnswer={handleSelectUnmatchedAnswer}
              onJumpToPage={handleJumpToPage}
            />
          </div>

          {/* Right Pane: Document Viewer & Spatial Grounding (7/12 width on desktop) */}
          <div
            className={`w-full lg:w-7/12 h-full flex flex-col shrink-0 overflow-hidden ${
              mobileActiveTab === 'viewer' ? 'flex' : 'hidden lg:flex'
            }`}
          >
            <DocumentViewer
              assessmentId={assessment.id}
              questionPaper={assessment.questionPaper}
              answerSheet={assessment.answerSheet}
              activeDocType={activeDocType}
              currentPage={currentPage}
              activeRegions={highlightData.regions}
              activeStatus={highlightData.status}
              activeLabel={highlightData.label}
              activeConfidence={highlightData.confidence}
              onDocTypeChange={setActiveDocType}
              onPageChange={setCurrentPage}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
