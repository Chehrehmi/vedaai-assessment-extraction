'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface SelectedFile {
  file: File;
  name: string;
  size: number;
  type: string;
}

export default function UploadPage() {
  const [questionPaper, setQuestionPaper] = useState<SelectedFile | null>(null);
  const [answerSheet, setAnswerSheet] = useState<SelectedFile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<{
    assessmentId: string;
    status: string;
  } | null>(null);

  const qpInputRef = useRef<HTMLInputElement>(null);
  const asInputRef = useRef<HTMLInputElement>(null);

  const MAX_SIZE_BYTES = 10 * 1024 * 1024;

  const handleFileSelect = (
    file: File | null,
    setFile: (sf: SelectedFile | null) => void,
    typeLabel: string
  ) => {
    setErrorMessage(null);
    if (!file) return;

    if (file.size > MAX_SIZE_BYTES) {
      setErrorMessage(`${typeLabel} exceeds maximum size of 10MB (${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
      return;
    }

    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      setErrorMessage(`${typeLabel} must be a PDF, PNG, or JPEG file`);
      return;
    }

    setFile({
      file,
      name: file.name,
      size: file.size,
      type: file.type,
    });
  };

  const router = useRouter();

  const handleStartMapping = async () => {
    if (!questionPaper || !answerSheet) {
      setErrorMessage('Please select both Question Paper and Answer Sheet files.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append('questionPaper', questionPaper.file);
      formData.append('answerSheet', answerSheet.file);

      const res = await fetch('/api/assessment', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data?.error?.message || `Server error (${res.status})`;
        setErrorMessage(errorMsg);
        setIsSubmitting(false);
        return;
      }

      setSubmissionResult({
        assessmentId: data.assessmentId,
        status: data.status || 'queued',
      });

      // Navigate to the assessment processing / review workspace
      router.push(`/exams/${data.assessmentId}`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to submit assessment files.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTryDemo = async () => {
    setIsDemoLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/assessment/demo', {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data?.error?.message || `Server error (${res.status})`;
        setErrorMessage(errorMsg);
        setIsDemoLoading(false);
        return;
      }

      // Navigate directly to the pre-validated demo assessment review workspace
      router.push(`/exams/${data.assessmentId}`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load sample demo assessment.');
      setIsDemoLoading(false);
    }
  };


  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#fff8f6] text-[#241916]">
      {/* Sidebar */}
      <nav className="w-64 bg-white border-r border-[#dfc0b7]/40 h-full hidden lg:flex flex-col py-6 px-4 shrink-0 shadow-sm z-50">
        <div className="flex items-center gap-2.5 mb-8 px-2">
          <img src="/logo.png" alt="VedaAI Logo" className="h-7 w-auto object-contain" />
          <span className="font-extrabold text-2xl tracking-tight text-[#241916]">VedaAI</span>
        </div>

        <button className="w-full bg-[#2D2D2D] text-white rounded-full py-3 px-4 flex items-center justify-center gap-2 mb-8 hover:bg-black transition-colors shadow-sm">
          <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
          <span className="text-sm font-medium">AI Teacher&apos;s Toolkit</span>
        </button>

        <div className="flex flex-col flex-1 gap-2">
          <a href="#" className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[#57423b] hover:bg-[#ffe9e3]/50 transition-colors">
            <span className="material-symbols-outlined">grid_view</span>
            <span>Home</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[#57423b] hover:bg-[#ffe9e3]/50 transition-colors">
            <span className="material-symbols-outlined">groups</span>
            <span>My Classroom</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[#57423b] hover:bg-[#ffe9e3]/50 transition-colors">
            <span className="material-symbols-outlined">description</span>
            <span>Assignments</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[#e4e2e1] font-semibold text-[#241916] border-l-4 border-[#a63b17]">
            <span className="material-symbols-outlined">inventory_2</span>
            <span>Exams</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[#57423b] hover:bg-[#ffe9e3]/50 transition-colors">
            <span className="material-symbols-outlined">history</span>
            <span>My Library</span>
          </a>
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

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto relative">
        {/* Top Bar */}
        <header className="flex justify-between items-center w-full px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-[#dfc0b7]/20">
          <div className="flex items-center gap-2.5">
            <div className="lg:hidden flex items-center gap-2 mr-1">
              <img src="/logo.png" alt="VedaAI Logo" className="h-6 w-auto object-contain" />
              <span className="font-extrabold text-lg text-[#241916]">VedaAI</span>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-[#57423b] px-3 py-1.5 rounded-md bg-white border border-[#dfc0b7]/50 shadow-xs text-xs font-semibold">
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
              <span>Exams</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-[#57423b]">
            <span className="font-medium">Teacher Workspace</span>
          </div>
        </header>

        {/* Content Container */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 py-8 sm:py-10 max-w-4xl mx-auto w-full">
          <div className="text-center mb-6 sm:mb-8 w-full">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-[#241916] mb-2 sm:mb-3">
              Upload{' '}
              <span className="bg-[#fae3dd] text-[#a63b17] px-2.5 sm:px-3 py-1 rounded-xl inline-block">
                Question Paper &amp; Answer Sheets
              </span>
            </h1>
            <p className="text-[#57423b] text-sm sm:text-base">Upload both files to get started</p>
          </div>

          {/* Submission Result / Queued State */}
          {submissionResult && (
            <div className="w-full mb-6 p-6 bg-white border border-[#4bae4f] rounded-2xl shadow-sm text-center">
              <div className="w-12 h-12 bg-[#78dc77]/20 rounded-full flex items-center justify-center mx-auto mb-3 text-[#006e1c]">
                <span className="material-symbols-outlined text-2xl">check_circle</span>
              </div>
              <h2 className="text-xl font-bold text-[#241916] mb-1">Assessment Created Successfully</h2>
              <p className="text-sm text-[#57423b] mb-3">
                Assessment ID: <code className="bg-[#fff1ed] px-2 py-1 rounded font-mono text-xs text-[#a63b17]">{submissionResult.assessmentId}</code>
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#fae3dd] text-[#a63b17] text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-[#a63b17] animate-pulse"></span>
                Status: {submissionResult.status}
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="w-full mb-6 p-4 bg-[#ffdad6] border border-[#ba1a1a]/30 rounded-xl text-[#93000a] text-sm flex items-center gap-3">
              <span className="material-symbols-outlined text-[20px]">error</span>
              <p className="font-medium flex-1">{errorMessage}</p>
              <button onClick={() => setErrorMessage(null)} className="text-[#93000a] hover:opacity-70">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          )}

          {/* Upload Grid */}
          <div className="w-full bg-white rounded-[28px] p-6 md:p-8 shadow-sm border border-[#dfc0b7]/40">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Question Paper Dropzone */}
              <div>
                <input
                  type="file"
                  ref={qpInputRef}
                  className="hidden"
                  accept=".pdf,image/png,image/jpeg"
                  onChange={(e) => handleFileSelect(e.target.files?.[0] || null, setQuestionPaper, 'Question paper')}
                />
                {!questionPaper ? (
                  <button
                    type="button"
                    onClick={() => qpInputRef.current?.click()}
                    className="dashed-border w-full flex flex-col items-center justify-center py-10 px-6 hover:bg-[#fff1ed]/50 transition-colors bg-white group cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-xl bg-[#ffe9e3] flex items-center justify-center mb-3 group-hover:scale-105 transition-transform text-[#a63b17]">
                      <span className="material-symbols-outlined text-2xl">upload</span>
                    </div>
                    <h3 className="font-bold text-base text-[#241916] mb-1">
                      Upload <span className="text-[#a63b17]">Question Paper</span>
                    </h3>
                    <p className="text-xs text-[#57423b]">PDF, PNG, JPG • Max 10MB</p>
                  </button>
                ) : (
                  <div className="dashed-border p-4 bg-[#fff1ed]/40 min-h-[140px] flex items-center justify-center relative">
                    <div className="bg-white rounded-xl p-4 w-full flex items-center gap-3 shadow-sm border border-[#dfc0b7]/50 relative">
                      <div className="w-10 h-10 bg-[#ffdad6] rounded-lg flex items-center justify-center text-[#ba1a1a] font-bold text-xs shrink-0">
                        {questionPaper.type.includes('pdf') ? 'PDF' : 'IMG'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#241916] truncate">{questionPaper.name}</p>
                        <p className="text-xs text-[#57423b] mt-0.5">{formatSize(questionPaper.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setQuestionPaper(null)}
                        className="w-7 h-7 bg-[#57423b] text-white rounded-full flex items-center justify-center hover:bg-[#241916] transition-colors shadow-sm"
                        title="Remove file"
                      >
                        <span className="material-symbols-outlined text-xs">close</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Answer Sheet Dropzone */}
              <div>
                <input
                  type="file"
                  ref={asInputRef}
                  className="hidden"
                  accept=".pdf,image/png,image/jpeg"
                  onChange={(e) => handleFileSelect(e.target.files?.[0] || null, setAnswerSheet, 'Answer sheet')}
                />
                {!answerSheet ? (
                  <button
                    type="button"
                    onClick={() => asInputRef.current?.click()}
                    className="dashed-border w-full flex flex-col items-center justify-center py-10 px-6 hover:bg-[#fff1ed]/50 transition-colors bg-white group cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-xl bg-[#ffe9e3] flex items-center justify-center mb-3 group-hover:scale-105 transition-transform text-[#a63b17]">
                      <span className="material-symbols-outlined text-2xl">upload</span>
                    </div>
                    <h3 className="font-bold text-base text-[#241916] mb-1">
                      Upload <span className="text-[#a63b17]">Answer Sheet</span>
                    </h3>
                    <p className="text-xs text-[#57423b]">PDF, PNG, JPG • Max 10MB</p>
                  </button>
                ) : (
                  <div className="dashed-border p-4 bg-[#fff1ed]/40 min-h-[140px] flex items-center justify-center relative">
                    <div className="bg-white rounded-xl p-4 w-full flex items-center gap-3 shadow-sm border border-[#dfc0b7]/50 relative">
                      <div className="w-10 h-10 bg-[#ffdad6] rounded-lg flex items-center justify-center text-[#ba1a1a] font-bold text-xs shrink-0">
                        {answerSheet.type.includes('pdf') ? 'PDF' : 'IMG'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#241916] truncate">{answerSheet.name}</p>
                        <p className="text-xs text-[#57423b] mt-0.5">{formatSize(answerSheet.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAnswerSheet(null)}
                        className="w-7 h-7 bg-[#57423b] text-white rounded-full flex items-center justify-center hover:bg-[#241916] transition-colors shadow-sm"
                        title="Remove file"
                      >
                        <span className="material-symbols-outlined text-xs">close</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="mt-8 flex flex-col items-center text-center w-full max-w-sm">
            <button
              type="button"
              disabled={!questionPaper || !answerSheet || isSubmitting}
              onClick={handleStartMapping}
              className={`w-full rounded-full py-3.5 px-8 font-bold text-base flex items-center justify-center gap-2 shadow-md transition-all ${
                !questionPaper || !answerSheet || isSubmitting
                  ? 'bg-[#c8c6c6] text-[#57423b] cursor-not-allowed'
                  : 'bg-[#241916] hover:bg-black text-white cursor-pointer active:scale-98'
              }`}
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Uploading &amp; Rasterizing...</span>
                </>
              ) : (
                <>
                  <span>Start Mapping</span>
                  <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </>
              )}
            </button>
            <p className="text-xs text-[#57423b]/80 mt-3">
              Once both files are uploaded, you&apos;ll be able to map answers with questions
            </p>
          </div>

          {/* Divider & Secondary Demo Action */}
          <div className="mt-8 pt-6 border-t border-[#dfc0b7]/40 w-full max-w-md flex flex-col items-center text-center">
            <div className="flex items-center gap-3 w-full mb-4">
              <div className="h-px bg-[#dfc0b7]/50 flex-1"></div>
              <span className="text-xs font-semibold text-[#57423b]/70 uppercase tracking-wider">or test instantly</span>
              <div className="h-px bg-[#dfc0b7]/50 flex-1"></div>
            </div>

            <button
              type="button"
              onClick={handleTryDemo}
              disabled={isSubmitting || isDemoLoading}
              className={`w-full sm:w-auto px-6 py-2.5 rounded-full border border-[#a63b17]/40 bg-white hover:bg-[#fff1ed] text-[#a63b17] font-bold text-sm flex items-center justify-center gap-2 shadow-2xs transition-all ${
                isSubmitting || isDemoLoading
                  ? 'opacity-60 cursor-not-allowed'
                  : 'cursor-pointer hover:border-[#a63b17] active:scale-98'
              }`}
            >
              {isDemoLoading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-[#a63b17] border-t-transparent rounded-full animate-spin"></span>
                  <span>Loading Demo Assessment...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">bolt</span>
                  <span>Try Demo Assessment</span>
                </>
              )}
            </button>
            <p className="text-[11px] text-[#57423b]/70 mt-2 max-w-xs">
              See how VedaAI maps handwritten answers to questions and highlights them on the original sheet.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
