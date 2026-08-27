'use client';

import React, { useState } from 'react';
import { DocumentMetadata, AnswerRegion, MappingStatus } from '@/lib/domain/types';
import { HighlightOverlay } from './HighlightOverlay';

export type ActiveDocType = 'answer_sheet' | 'question_paper';

interface DocumentViewerProps {
  assessmentId: string;
  questionPaper: DocumentMetadata;
  answerSheet: DocumentMetadata;
  activeDocType: ActiveDocType;
  currentPage: number;
  activeRegions?: AnswerRegion[];
  activeStatus?: MappingStatus;
  activeLabel?: string;
  activeConfidence?: number;
  onDocTypeChange: (docType: ActiveDocType) => void;
  onPageChange: (page: number) => void;
}

export function DocumentViewer({
  assessmentId,
  questionPaper,
  answerSheet,
  activeDocType,
  currentPage,
  activeRegions = [],
  activeStatus = 'matched',
  activeLabel,
  activeConfidence,
  onDocTypeChange,
  onPageChange,
}: DocumentViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [imageError, setImageError] = useState(false);

  const currentDoc = activeDocType === 'answer_sheet' ? answerSheet : questionPaper;
  const pageCount = currentDoc?.pageCount || 1;

  const handleZoomIn = () => setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))));
  const handleZoomReset = () => setZoom(1);

  const handlePrevPage = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < pageCount) {
      onPageChange(currentPage + 1);
    }
  };

  // Image source URL
  const imageUrl = `/api/assessment/${assessmentId}/page/${activeDocType}/${currentPage}`;

  // Check if activeRegions has regions on other pages
  const otherPagesWithRegions = activeRegions
    .map((r) => r.page)
    .filter((p) => p !== currentPage && p >= 1 && p <= pageCount);
  const uniqueOtherPages = Array.from(new Set(otherPagesWithRegions));

  return (
    <div className="flex flex-col h-full bg-[#1b1c1c] text-white select-none">
      {/* Top Toolbar */}
      <div className="px-2.5 sm:px-4 py-2 sm:py-3 bg-[#241916] border-b border-white/10 flex items-center justify-between gap-2 sm:gap-4 shrink-0 flex-wrap">
        {/* Document Selector Switcher */}
        <div className="flex items-center gap-1 bg-black/40 p-0.5 sm:p-1 rounded-xl border border-white/10">
          <button
            type="button"
            onClick={() => {
              onDocTypeChange('answer_sheet');
              onPageChange(1);
            }}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 sm:gap-1.5 cursor-pointer ${
              activeDocType === 'answer_sheet'
                ? 'bg-[#a63b17] text-white shadow-xs'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="material-symbols-outlined text-[15px] sm:text-[16px]">edit_note</span>
            <span>Answer Sheet <span className="opacity-75">({answerSheet.pageCount}p)</span></span>
          </button>
          <button
            type="button"
            onClick={() => {
              onDocTypeChange('question_paper');
              onPageChange(1);
            }}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 sm:gap-1.5 cursor-pointer ${
              activeDocType === 'question_paper'
                ? 'bg-[#a63b17] text-white shadow-xs'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="material-symbols-outlined text-[15px] sm:text-[16px]">description</span>
            <span>Question Paper <span className="opacity-75">({questionPaper.pageCount}p)</span></span>
          </button>
        </div>

        {/* Page & Zoom Controls */}
        <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
          {/* Page Navigation */}
          <div className="flex items-center gap-0.5 sm:gap-1 bg-black/40 px-1.5 sm:px-2 py-1 rounded-xl border border-white/10 text-xs">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={handlePrevPage}
              className="p-1 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-not-allowed"
              title="Previous Page"
            >
              <span className="material-symbols-outlined text-[15px] sm:text-[16px]">chevron_left</span>
            </button>
            <span className="font-mono px-1 sm:px-2 font-bold text-white/90 text-[11px] sm:text-xs">
              Page {currentPage} of {pageCount}
            </span>
            <button
              type="button"
              disabled={currentPage >= pageCount}
              onClick={handleNextPage}
              className="p-1 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-not-allowed"
              title="Next Page"
            >
              <span className="material-symbols-outlined text-[15px] sm:text-[16px]">chevron_right</span>
            </button>
          </div>

          {/* Zoom Controls (Exposed on all screen sizes) */}
          <div className="flex items-center gap-0.5 sm:gap-1 bg-black/40 px-1.5 sm:px-2 py-1 rounded-xl border border-white/10 text-xs">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
              title="Zoom Out"
            >
              <span className="material-symbols-outlined text-[15px] sm:text-[16px]">remove</span>
            </button>
            <button
              type="button"
              onClick={handleZoomReset}
              className="font-mono px-1 sm:px-1.5 font-semibold hover:text-[#ffb59f] transition-colors cursor-pointer text-[11px] sm:text-xs"
              title="Reset Zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
              title="Zoom In"
            >
              <span className="material-symbols-outlined text-[15px] sm:text-[16px]">add</span>
            </button>
          </div>
        </div>
      </div>

      {/* Continuation Notice Banner */}
      {uniqueOtherPages.length > 0 && activeDocType === 'answer_sheet' && (
        <div className="bg-[#a63b17] px-3 sm:px-4 py-2 text-xs flex items-center justify-between gap-2 shadow-xs shrink-0 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="material-symbols-outlined text-[16px] shrink-0">auto_stories</span>
            <span className="text-[11px] sm:text-xs truncate sm:whitespace-normal">
              This answer also spans page(s): {uniqueOtherPages.join(', ')}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {uniqueOtherPages.map((pg) => (
              <button
                key={`jump-btn-${pg}`}
                type="button"
                onClick={() => onPageChange(pg)}
                className="px-2.5 py-1 rounded bg-white text-[#a63b17] font-bold text-[11px] hover:bg-white/90 cursor-pointer shadow-2xs"
              >
                Go to P.{pg} →
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Canvas Scroll Area */}
      <div className="flex-1 overflow-auto p-2 sm:p-6 md:p-8 flex items-center justify-center relative bg-[#121212]">
        <div
          className="transition-transform duration-150 origin-center max-w-full"
          style={{ transform: `scale(${zoom})` }}
        >
          {/* Document Paper Container */}
          <div className="relative bg-white rounded-lg shadow-2xl overflow-hidden border border-white/10 w-full max-w-[850px]">
            {/* Page Loading Spinner */}
            {isLoadingImage && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-2xs flex items-center justify-center z-30">
                <span className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin"></span>
              </div>
            )}

            {/* Document Page Image */}
            <img
              key={imageUrl}
              src={imageUrl}
              alt={`Document ${activeDocType} Page ${currentPage}`}
              onLoadStart={() => setIsLoadingImage(true)}
              onLoad={() => {
                setIsLoadingImage(false);
                setImageError(false);
              }}
              onError={() => {
                setIsLoadingImage(false);
                setImageError(true);
              }}
              className="w-full h-auto block select-none"
            />

            {/* Spatial Highlight Overlay */}
            {activeDocType === 'answer_sheet' && activeRegions.length > 0 && !imageError && (
              <HighlightOverlay
                regions={activeRegions}
                currentPage={currentPage}
                status={activeStatus}
                label={activeLabel}
                confidence={activeConfidence}
              />
            )}

            {/* Image Error Fallback */}
            {imageError && (
              <div className="p-12 text-center text-[#57423b] bg-[#fff8f6]">
                <span className="material-symbols-outlined text-4xl text-[#ba1a1a] mb-2">broken_image</span>
                <p className="font-bold text-sm">Failed to load page image</p>
                <p className="text-xs mt-1 text-gray-500">Page {currentPage} could not be rendered.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
