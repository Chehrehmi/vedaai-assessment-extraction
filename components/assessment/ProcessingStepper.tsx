'use client';

import React from 'react';
import { ProcessingStage } from '@/lib/domain/types';

interface ProcessingStepperProps {
  stage: ProcessingStage;
  errorCode?: string;
  errorMessage?: string;
  onRetry?: () => void;
  onUploadDifferent?: () => void;
}

interface StepInfo {
  id: number;
  title: string;
  description: string;
  stages: ProcessingStage[];
}

const STEPS: StepInfo[] = [
  {
    id: 1,
    title: 'Uploading & Rasterizing',
    description: 'Converting PDF/image pages to normalized high-resolution frames',
    stages: ['queued', 'uploading'],
  },
  {
    id: 2,
    title: 'Question Paper Extraction',
    description: 'Identifying numbered questions, sub-parts, and printed sections',
    stages: ['reading_question_paper', 'extracting_questions'],
  },
  {
    id: 3,
    title: 'Handwritten Answer Detection',
    description: 'Locating handwriting regions and spatial coordinates across all pages',
    stages: ['reading_answer_sheet', 'detecting_answers'],
  },
  {
    id: 4,
    title: 'Answer-to-Question Mapping',
    description: 'Deterministic rule alignment, spatial continuity, and semantic fallback',
    stages: ['mapping_answers', 'finalizing'],
  },
];

export function ProcessingStepper({
  stage,
  errorCode,
  errorMessage,
  onRetry,
  onUploadDifferent,
}: ProcessingStepperProps) {
  const isFailed = stage === 'failed';

  const getStepStatus = (stepIndex: number): 'completed' | 'active' | 'pending' => {
    if (isFailed) return 'pending';
    if (stage === 'completed') return 'completed';

    const stageOrder: Record<ProcessingStage, number> = {
      queued: 0,
      uploading: 0,
      reading_question_paper: 1,
      extracting_questions: 1,
      reading_answer_sheet: 2,
      detecting_answers: 2,
      mapping_answers: 3,
      finalizing: 3,
      completed: 4,
      failed: -1,
    };

    const currentStageIndex = stageOrder[stage] ?? 0;
    if (currentStageIndex > stepIndex) return 'completed';
    if (currentStageIndex === stepIndex) return 'active';
    return 'pending';
  };

  const getStageLabel = (st: ProcessingStage): string => {
    switch (st) {
      case 'queued':
        return 'Queued in processing pool...';
      case 'uploading':
        return 'Uploading documents...';
      case 'reading_question_paper':
        return 'Reading question paper pages...';
      case 'extracting_questions':
        return 'Extracting questions & sub-parts...';
      case 'reading_answer_sheet':
        return 'Reading answer sheet pages...';
      case 'detecting_answers':
        return 'Detecting handwritten answer blocks...';
      case 'mapping_answers':
        return 'Mapping student answers to questions...';
      case 'finalizing':
        return 'Validating referential integrity & assembling payload...';
      case 'completed':
        return 'Processing complete!';
      case 'failed':
        return 'Processing failed';
      default:
        return 'Processing...';
    }
  };

  return (
    <div className="w-full max-w-2xl bg-white rounded-3xl p-8 shadow-sm border border-[#dfc0b7]/40">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-[#fae3dd] text-[#a63b17] flex items-center justify-center mx-auto mb-4">
          <span className={`material-symbols-outlined text-3xl ${!isFailed ? 'animate-spin' : ''}`}>
            {isFailed ? 'error' : 'progress_activity'}
          </span>
        </div>
        <h2 className="text-2xl font-extrabold text-[#241916] mb-1">
          {isFailed ? 'Processing Failed' : 'Analyzing Assessment'}
        </h2>
        <p className="text-sm font-medium text-[#a63b17]">
          {getStageLabel(stage)}
        </p>
      </div>

      {/* Failure State Banner */}
      {isFailed && (
        <div className="mb-6 p-5 bg-[#ffdad6] border border-[#ba1a1a]/30 rounded-2xl text-[#93000a]">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-2xl shrink-0 mt-0.5">error</span>
            <div className="flex-1">
              <h3 className="font-bold text-sm">
                {errorCode ? `Error: ${errorCode}` : 'Assessment Processing Error'}
              </h3>
              <p className="text-xs mt-1 text-[#93000a]/90 leading-relaxed">
                {errorMessage || 'An unexpected error occurred while processing your assessment. Please try again.'}
              </p>
              <div className="mt-4 flex items-center gap-3">
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="px-4 py-2 bg-[#ba1a1a] text-white rounded-full text-xs font-bold hover:bg-[#93000a] transition-colors shadow-sm"
                  >
                    Try Again
                  </button>
                )}
                {onUploadDifferent && (
                  <button
                    type="button"
                    onClick={onUploadDifferent}
                    className="px-4 py-2 bg-white text-[#93000a] border border-[#ba1a1a]/40 rounded-full text-xs font-bold hover:bg-[#ffdad6]/50 transition-colors"
                  >
                    Upload Different Files
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stepper List */}
      <div className="space-y-4">
        {STEPS.map((step, idx) => {
          const status = getStepStatus(idx);
          const isCompleted = status === 'completed';
          const isActive = status === 'active';

          return (
            <div
              key={step.id}
              className={`p-4 rounded-2xl border transition-all flex items-center gap-4 ${
                isActive
                  ? 'bg-[#fff1ed] border-[#a63b17] shadow-sm'
                  : isCompleted
                  ? 'bg-white border-[#4bae4f]/40'
                  : 'bg-white/50 border-[#dfc0b7]/30 opacity-60'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-xs ${
                  isCompleted
                    ? 'bg-[#006e1c] text-white'
                    : isActive
                    ? 'bg-[#a63b17] text-white ring-4 ring-[#ffe9e3]'
                    : 'bg-[#e4e2e1] text-[#57423b]'
                }`}
              >
                {isCompleted ? (
                  <span className="material-symbols-outlined text-[18px]">check</span>
                ) : isActive ? (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <span>{step.id}</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className={`text-sm font-bold truncate ${isActive ? 'text-[#a63b17]' : 'text-[#241916]'}`}>
                    {step.title}
                  </h4>
                  {isActive && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#fae3dd] text-[#a63b17] animate-pulse shrink-0">
                      In Progress
                    </span>
                  )}
                  {isCompleted && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#78dc77]/20 text-[#006e1c] shrink-0">
                      Done
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#57423b] mt-0.5 line-clamp-1">{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
