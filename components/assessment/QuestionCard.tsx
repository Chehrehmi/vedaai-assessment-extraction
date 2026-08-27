'use client';

import React from 'react';
import { Question, Answer, AnswerMapping } from '@/lib/domain/types';
import { StatusPill } from './StatusPill';

interface QuestionCardProps {
  question: Question;
  mapping?: AnswerMapping;
  answer?: Answer;
  isSelected: boolean;
  onSelect: () => void;
  onJumpToPage?: (page: number) => void;
}

export function QuestionCard({
  question,
  mapping,
  answer,
  isSelected,
  onSelect,
  onJumpToPage,
}: QuestionCardProps) {
  const status = mapping?.status || 'unanswered';
  const confidence = mapping?.confidence;
  const isMultiPage = answer && answer.pages.length > 1;

  const getMethodLabel = (method?: string) => {
    switch (method) {
      case 'explicit_reference':
        return 'Explicit Reference';
      case 'structural':
        return 'Structural Sequence';
      case 'semantic':
        return 'Semantic Match';
      default:
        return 'Auto Mapped';
    }
  };

  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border transition-all cursor-pointer overflow-hidden ${
        isSelected
          ? 'bg-white border-[#a63b17] shadow-md ring-2 ring-[#a63b17]/20'
          : 'bg-white border-[#dfc0b7]/40 hover:border-[#dfc0b7] hover:shadow-sm'
      }`}
    >
      {/* Card Header */}
      <div className="p-3.5 sm:p-4 flex items-start justify-between gap-2.5 sm:gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center font-extrabold text-xs shrink-0 ${
              isSelected
                ? 'bg-[#a63b17] text-white'
                : 'bg-[#fff1ed] text-[#a63b17] border border-[#dfc0b7]/50'
            }`}
          >
            {question.number}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-bold text-sm text-[#241916]">Question {question.number}</h3>
              {question.subPart && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#fff1ed] text-[#a63b17]">
                  Part ({question.subPart})
                </span>
              )}
            </div>
            <p className="text-xs text-[#57423b] line-clamp-2 leading-relaxed">
              {question.text}
            </p>
          </div>
        </div>

        <StatusPill status={status} confidence={confidence} />
      </div>

      {/* Expanded Details when Selected */}
      {isSelected && (
        <div className="px-4 pb-4 pt-2 border-t border-[#dfc0b7]/30 bg-[#fff8f6]/50 space-y-3">
          {/* Full Question Text */}
          <div>
            <span className="text-[10px] uppercase tracking-wider font-bold text-[#8b716a]">
              Full Question Text
            </span>
            <p className="text-xs text-[#241916] mt-0.5 bg-white p-2.5 rounded-xl border border-[#dfc0b7]/30 leading-relaxed font-sans">
              {question.text}
            </p>
            {question.alternativeText && (
              <div className="mt-1.5 p-2 bg-[#fae3dd]/40 rounded-lg border border-[#dfc0b7]/30">
                <span className="text-[10px] font-bold text-[#a63b17] block">
                  Visually Impaired Alternative ({question.alternativeType || 'Visual'}):
                </span>
                <p className="text-xs text-[#57423b] mt-0.5">{question.alternativeText}</p>
              </div>
            )}
          </div>

          {/* Mapped Student Answer Details */}
          {status !== 'unanswered' && answer ? (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[#8b716a]">
                  Student Answer
                </span>
                <div className="flex items-center gap-1.5">
                  {mapping?.method && (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#e4e2e1] text-[#57423b] font-medium">
                      {getMethodLabel(mapping.method)}
                    </span>
                  )}
                  {answer.detectedQuestionReference && (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#fff1ed] text-[#a63b17] font-semibold">
                      Ref: &quot;{answer.detectedQuestionReference}&quot;
                    </span>
                  )}
                </div>
              </div>

              {answer.rawText && (
                <div className="p-2.5 bg-white rounded-xl border border-[#dfc0b7]/30 text-xs text-[#241916] leading-relaxed font-mono">
                  {answer.rawText}
                </div>
              )}

              {/* Multi-page Navigation Affordance */}
              {isMultiPage && (
                <div className="mt-2.5 p-2.5 bg-[#ffe9e3]/60 rounded-xl border border-[#dfc0b7]/40 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-[#57423b]">
                    <span className="material-symbols-outlined text-[16px] text-[#a63b17]">auto_stories</span>
                    <span className="font-semibold">Spans {answer.pages.length} Pages:</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {answer.pages.map((pg) => (
                      <button
                        key={`page-btn-${pg}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToPage?.(pg);
                        }}
                        className="px-2 py-1 bg-white hover:bg-[#a63b17] hover:text-white rounded-lg text-xs font-bold border border-[#dfc0b7]/40 transition-colors shadow-2xs"
                      >
                        P.{pg}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 bg-[#e4e2e1]/40 rounded-xl border border-[#c8c6c6]/50 text-center">
              <span className="material-symbols-outlined text-gray-400 text-xl block mb-1">
                edit_off
              </span>
              <p className="text-xs font-medium text-[#57423b]">
                No handwritten answer detected on the student&apos;s answer sheet for this question.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
