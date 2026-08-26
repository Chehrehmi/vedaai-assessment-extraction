'use client';

import React, { useState, useMemo } from 'react';
import { Question, Answer, AnswerMapping, MappingStatus } from '@/lib/domain/types';
import { QuestionCard } from './QuestionCard';
import { UnmatchedAnswersPanel } from './UnmatchedAnswersPanel';

interface QuestionListProps {
  questions: Question[];
  mappings: AnswerMapping[];
  answers: Answer[];
  selectedQuestionId?: string;
  selectedAnswerId?: string;
  onSelectQuestion: (question: Question, mapping?: AnswerMapping, answer?: Answer) => void;
  onSelectUnmatchedAnswer: (answer: Answer) => void;
  onJumpToPage?: (page: number) => void;
}

type FilterType = 'all' | 'matched' | 'needs_review' | 'unanswered';

export function QuestionList({
  questions,
  mappings,
  answers,
  selectedQuestionId,
  selectedAnswerId,
  onSelectQuestion,
  onSelectUnmatchedAnswer,
  onJumpToPage,
}: QuestionListProps) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Index mappings by questionId
  const mappingByQuestionId = useMemo(() => {
    const map = new Map<string, AnswerMapping>();
    for (const m of mappings) {
      map.set(m.questionId, m);
    }
    return map;
  }, [mappings]);

  // Index answers by id
  const answerById = useMemo(() => {
    const map = new Map<string, Answer>();
    for (const a of answers) {
      map.set(a.id, a);
    }
    return map;
  }, [answers]);

  // Find unmatched answers (answers not referenced by any mapping)
  const unmatchedAnswers = useMemo(() => {
    const mappedAnswerIds = new Set(
      mappings.map((m) => m.answerId).filter((id): id is string => Boolean(id))
    );
    return answers.filter((a) => !mappedAnswerIds.has(a.id));
  }, [answers, mappings]);

  // Sorted questions by printed order
  const sortedQuestions = useMemo(() => {
    return [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [questions]);

  // Summary counts
  const stats = useMemo(() => {
    let matched = 0;
    let needsReview = 0;
    let unanswered = 0;

    for (const q of questions) {
      const m = mappingByQuestionId.get(q.id);
      const status: MappingStatus = m?.status || 'unanswered';
      if (status === 'matched') matched++;
      else if (status === 'needs_review') needsReview++;
      else unanswered++;
    }

    return {
      total: questions.length,
      matched,
      needsReview,
      unanswered,
      unmatched: unmatchedAnswers.length,
    };
  }, [questions, mappingByQuestionId, unmatchedAnswers]);

  // Filtered questions
  const filteredQuestions = useMemo(() => {
    return sortedQuestions.filter((q) => {
      const m = mappingByQuestionId.get(q.id);
      const status: MappingStatus = m?.status || 'unanswered';

      if (filter !== 'all' && status !== filter) {
        return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesNumber = q.number.toLowerCase().includes(query);
        const matchesText = q.text.toLowerCase().includes(query);
        return matchesNumber || matchesText;
      }

      return true;
    });
  }, [sortedQuestions, mappingByQuestionId, filter, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-white border-r border-[#dfc0b7]/40">
      {/* Top Header & Stats */}
      <div className="p-4 border-b border-[#dfc0b7]/30 shrink-0">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="font-extrabold text-lg text-[#241916]">
            Questions ({questions.length})
          </h2>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#fae3dd] text-[#a63b17]">
            {stats.matched} / {stats.total} Mapped
          </span>
        </div>

        {/* Search Bar */}
        <div className="relative mb-3">
          <span className="material-symbols-outlined absolute left-3 top-2.5 text-[#8b716a] text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search questions by number or text..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-[#fff8f6] rounded-xl border border-[#dfc0b7]/50 text-xs text-[#241916] placeholder-[#8b716a] focus:outline-hidden focus:border-[#a63b17]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-xs text-[#8b716a] hover:text-[#241916]"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-full font-bold transition-colors shrink-0 ${
              filter === 'all'
                ? 'bg-[#241916] text-white shadow-2xs'
                : 'bg-[#fff1ed] text-[#57423b] hover:bg-[#ffe9e3]'
            }`}
          >
            All ({stats.total})
          </button>
          <button
            type="button"
            onClick={() => setFilter('matched')}
            className={`px-3 py-1.5 rounded-full font-bold transition-colors shrink-0 ${
              filter === 'matched'
                ? 'bg-[#006e1c] text-white shadow-2xs'
                : 'bg-[#4bae4f]/15 text-[#006e1c] hover:bg-[#4bae4f]/25'
            }`}
          >
            ✓ Matched ({stats.matched})
          </button>
          <button
            type="button"
            onClick={() => setFilter('needs_review')}
            className={`px-3 py-1.5 rounded-full font-bold transition-colors shrink-0 ${
              filter === 'needs_review'
                ? 'bg-[#a63b17] text-white shadow-2xs'
                : 'bg-[#ffdbd0] text-[#a63b17] hover:bg-[#ffb59f]/40'
            }`}
          >
            ⚠ Review ({stats.needsReview})
          </button>
          <button
            type="button"
            onClick={() => setFilter('unanswered')}
            className={`px-3 py-1.5 rounded-full font-bold transition-colors shrink-0 ${
              filter === 'unanswered'
                ? 'bg-[#57423b] text-white shadow-2xs'
                : 'bg-[#e4e2e1] text-[#57423b] hover:bg-[#c8c6c6]'
            }`}
          >
            — Unanswered ({stats.unanswered})
          </button>
        </div>
      </div>

      {/* Questions Scrollable List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredQuestions.length === 0 ? (
          <div className="p-8 text-center bg-[#fff8f6] rounded-2xl border border-[#dfc0b7]/30 my-4">
            <span className="material-symbols-outlined text-3xl text-gray-400 mb-2 block">
              filter_list_off
            </span>
            <p className="text-xs font-semibold text-[#57423b]">
              No questions found matching your filter.
            </p>
          </div>
        ) : (
          filteredQuestions.map((q) => {
            const mapping = mappingByQuestionId.get(q.id);
            const answer = mapping?.answerId ? answerById.get(mapping.answerId) : undefined;
            const isSelected = selectedQuestionId === q.id;

            return (
              <QuestionCard
                key={q.id}
                question={q}
                mapping={mapping}
                answer={answer}
                isSelected={isSelected}
                onSelect={() => onSelectQuestion(q, mapping, answer)}
                onJumpToPage={onJumpToPage}
              />
            );
          })
        )}

        {/* Unmatched Answers Section */}
        <UnmatchedAnswersPanel
          unmatchedAnswers={unmatchedAnswers}
          selectedAnswerId={selectedAnswerId}
          onSelectAnswer={onSelectUnmatchedAnswer}
          onJumpToPage={onJumpToPage}
        />
      </div>
    </div>
  );
}
