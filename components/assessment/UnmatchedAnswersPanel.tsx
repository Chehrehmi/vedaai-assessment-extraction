'use client';

import React, { useState } from 'react';
import { Answer } from '@/lib/domain/types';

interface UnmatchedAnswersPanelProps {
  unmatchedAnswers: Answer[];
  selectedAnswerId?: string;
  onSelectAnswer: (answer: Answer) => void;
  onJumpToPage?: (page: number) => void;
}

export function UnmatchedAnswersPanel({
  unmatchedAnswers,
  selectedAnswerId,
  onSelectAnswer,
  onJumpToPage,
}: UnmatchedAnswersPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!unmatchedAnswers || unmatchedAnswers.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 rounded-2xl border border-[#ba1a1a]/30 bg-white overflow-hidden shadow-sm">
      {/* Panel Accordion Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3.5 sm:p-4 flex items-center justify-between gap-2.5 sm:gap-3 bg-[#ffdad6]/20 hover:bg-[#ffdad6]/35 transition-colors text-left cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#ffdad6] text-[#ba1a1a] flex items-center justify-center font-bold text-xs">
            <span className="material-symbols-outlined text-[16px]">help</span>
          </div>
          <div>
            <h4 className="font-bold text-sm text-[#93000a]">
              Unmatched Answers ({unmatchedAnswers.length})
            </h4>
            <p className="text-[11px] text-[#57423b]">
              Handwritten blocks detected that did not map to exam questions
            </p>
          </div>
        </div>
        <span className="material-symbols-outlined text-[#93000a] text-[20px] transition-transform">
          {isExpanded ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {/* Unmatched Answers List */}
      {isExpanded && (
        <div className="p-4 space-y-3 bg-[#fff8f6]/50 border-t border-[#dfc0b7]/30">
          {unmatchedAnswers.map((ans, idx) => {
            const isSelected = selectedAnswerId === ans.id;
            return (
              <div
                key={ans.id}
                onClick={() => onSelectAnswer(ans)}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white border-[#ba1a1a] ring-2 ring-[#ba1a1a]/20 shadow-xs'
                    : 'bg-white border-[#dfc0b7]/40 hover:border-[#ba1a1a]/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#ba1a1a]">
                      Unmatched #{idx + 1}
                    </span>
                    {ans.detectedQuestionReference && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#fff1ed] text-[#a63b17] font-semibold">
                        Label: &quot;{ans.detectedQuestionReference}&quot;
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {ans.pages.map((pg) => (
                      <span
                        key={`unmatched-page-${ans.id}-${pg}`}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#e4e2e1] text-[#57423b]"
                      >
                        Page {pg}
                      </span>
                    ))}
                  </div>
                </div>

                {ans.rawText ? (
                  <p className="text-xs text-[#241916] font-mono line-clamp-2 bg-[#fff8f6] p-2 rounded-lg border border-[#dfc0b7]/30">
                    {ans.rawText}
                  </p>
                ) : (
                  <p className="text-xs text-[#57423b] italic">
                    Handwritten region with {ans.regions.length} spatial box(es)
                  </p>
                )}

                {isSelected && (
                  <div className="mt-2 pt-2 border-t border-[#dfc0b7]/30 flex items-center justify-between text-[11px] text-[#006e1c] font-semibold">
                    <span>Highlighted on viewer</span>
                    {ans.pages.length > 1 && onJumpToPage && (
                      <div className="flex items-center gap-1">
                        <span className="text-[#57423b] text-[10px]">Jump:</span>
                        {ans.pages.map((p) => (
                          <button
                            key={`jump-${p}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onJumpToPage(p);
                            }}
                            className="px-1.5 py-0.5 rounded bg-[#a63b17] text-white text-[10px] font-bold"
                          >
                            P.{p}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
