'use client';

import React from 'react';
import { MappingStatus } from '@/lib/domain/types';

interface StatusPillProps {
  status: MappingStatus;
  confidence?: number;
  className?: string;
}

export function StatusPill({ status, confidence, className = '' }: StatusPillProps) {
  const formatConfidence = (conf?: number) => {
    if (typeof conf !== 'number') return '';
    return ` · ${Math.round(conf * 100)}%`;
  };

  switch (status) {
    case 'matched':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#4bae4f]/15 text-[#006e1c] border border-[#4bae4f]/30 shrink-0 ${className}`}
        >
          <span className="material-symbols-outlined text-[14px]">check</span>
          <span>Matched{confidence !== undefined && confidence < 0.9 ? formatConfidence(confidence) : ''}</span>
        </span>
      );

    case 'needs_review':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#ffdbd0] text-[#a63b17] border border-[#f4744c]/40 shrink-0 ${className}`}
        >
          <span className="material-symbols-outlined text-[14px]">warning</span>
          <span>Review{formatConfidence(confidence)}</span>
        </span>
      );

    case 'unanswered':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#e4e2e1] text-[#57423b] border border-[#c8c6c6] shrink-0 ${className}`}
        >
          <span>— Not answered</span>
        </span>
      );

    case 'unmatched':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#ffdad6] text-[#93000a] border border-[#ba1a1a]/30 shrink-0 ${className}`}
        >
          <span className="material-symbols-outlined text-[14px]">help</span>
          <span>Unmatched</span>
        </span>
      );

    default:
      return null;
  }
}
