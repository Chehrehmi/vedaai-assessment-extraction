'use client';

import React from 'react';
import { AnswerRegion, MappingStatus } from '@/lib/domain/types';

interface HighlightOverlayProps {
  regions: AnswerRegion[];
  currentPage: number;
  status?: MappingStatus;
  label?: string;
  confidence?: number;
}

export function HighlightOverlay({
  regions,
  currentPage,
  status = 'matched',
  label,
  confidence,
}: HighlightOverlayProps) {
  const pageRegions = regions.filter((r) => r.page === currentPage);

  if (pageRegions.length === 0) {
    return null;
  }

  const isMatched = status === 'matched';
  const isNeedsReview = status === 'needs_review';

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {pageRegions.map((region, idx) => {
        // Compute clamped percentages
        const left = Math.max(0, Math.min(1, region.x)) * 100;
        const top = Math.max(0, Math.min(1, region.y)) * 100;
        const width = Math.max(0, Math.min(100 - left, region.width * 100));
        const height = Math.max(0, Math.min(100 - top, region.height * 100));

        const borderClass = isNeedsReview
          ? 'border-2 border-dashed border-[#f4744c] bg-[#ffdbd0]/25 shadow-sm'
          : isMatched
          ? 'border-2 border-[#006e1c] bg-[#78dc77]/15 shadow-sm'
          : 'border-2 border-[#ba1a1a] bg-[#ffdad6]/25 shadow-sm';

        const badgeClass = isNeedsReview
          ? 'bg-[#a63b17] text-white'
          : isMatched
          ? 'bg-[#006e1c] text-white'
          : 'bg-[#ba1a1a] text-white';

        return (
          <div
            key={`region-${region.page}-${idx}`}
            className={`absolute rounded-lg transition-all duration-300 pointer-events-auto ${borderClass}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${height}%`,
            }}
          >
            {/* Overlay Header Chip */}
            <div className="absolute -top-3.5 left-2 flex items-center gap-1.5 shadow-sm">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${badgeClass}`}>
                <span>{label || `Answer`}</span>
                {confidence !== undefined && (
                  <span className="opacity-90 font-mono text-[10px]">
                    {Math.round(confidence * 100)}%
                  </span>
                )}
              </span>
              {pageRegions.length > 1 && (
                <span className="bg-[#241916] text-white text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                  {idx + 1}/{pageRegions.length}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
