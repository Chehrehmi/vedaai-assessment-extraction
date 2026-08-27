# VedaAI — AI Assessment Extraction & Answer Mapping

VedaAI is an AI-powered academic assessment review application that ingests printed question papers and handwritten student answer sheets, extracts question structures and handwritten student answers, deterministically aligns answers to questions with semantic AI fallback, and renders an interactive dual-pane review workspace with spatial bounding-box highlights.

---

## Live Demo

- **Live Deployed Application:** [https://vedaai-assessment-6k51.onrender.com/](https://vedaai-assessment-6k51.onrender.com/)
- **One-Click Demo:** Click **"Try Demo Assessment"** on the upload page to instantly explore the complete review workspace with pre-processed CBSE Mathematics exam data without needing to upload files or configure API keys.

---

## What It Does

```text
Question Paper + Handwritten Answer Sheet
  ↓
Question Extraction
  ↓
Answer Extraction
  ↓
Answer Mapping Engine
  ↓
Spatial Highlighting
  ↓
Review Workspace & Grading Summary
```

VedaAI eliminates manual answer lookup for educators. When a teacher selects a question in the review workspace, the application immediately reveals whether the student attempted the question, which page(s) contain the answer, and draws an interactive bounding-box highlight over the exact handwritten region on the student's answer sheet.

---

## Key Capabilities

- **Multi-Format Ingestion:** Accepts PDF, PNG, and JPEG files (up to 10MB per document) for both question papers and answer sheets.
- **Ordered Question Extraction:** Extracts printed exam questions in sequential order, preserving original numbering (`1`, `2`, `11(a)`, `11(b)`) and sub-question hierarchy.
- **Handwritten Answer Detection:** Identifies student handwritten blocks, extracts raw handwriting text, and records 2D spatial bounding boxes (`[ymin, xmin, ymax, xmax]` normalized to `[0..1]` fractions).
- **Out-of-Order Answer Alignment:** Maps student responses accurately even when questions were answered out of sequence.
- **Three-Tier Mapping Engine:** Aligns answers using explicit references, structural sequence matching, and semantic AI fallback.
- **Confidence & Status Classification:** Categorizes mappings into `Matched` (high confidence), `Needs Review` (ambiguous/heuristic), and `Unanswered`.
- **Unanswered Question Detection:** Correctly identifies unattempted questions without false-positive mappings or hallucinated answers.
- **Unmatched Answer Preservation:** Retains unrecognized student answers in an accessible "Unmatched Answers" panel without corrupting question alignment.
- **Multi-Page Answer Support:** Seamlessly links answers spanning multiple pages (e.g., Page 1 to Page 2) with multi-page jump affordances.
- **Spatial Answer Highlighting:** Renders responsive bounding-box overlays that remain precisely aligned across zoom levels, panning, and viewport resizing.
- **Dual-Document Viewer:** Allows instant toggling between the student's Answer Sheet and the original Question Paper with page navigation and zoom controls (`-`, `%`, `+`).
- **Responsive Mobile Layout:** Provides a mobile-optimized experience with a segmented navigation bar (`Questions` / `Answer Sheet`) and return-to-list workflows.
- **Real-Time Progress & Sanitized Errors:** Displays stage-by-stage pipeline progress (`rasterizing` → `extracting_questions` → `extracting_answers` → `mapping` → `finalizing`) with graceful error handling.
- **Assessment Summary & Marks:** Provides a compact grading summary showing question tallies, maximum marks, awarded marks, and pedagogical feedback.
- **Deterministic Sample Demo:** Bundles a pre-validated 16-question CBSE Mathematics sample assessment with zero external API dependencies.

---

## How It Works

1. **Upload & Validation:** Files are validated for MIME type, file size, and non-empty content before processing starts.
2. **Page Rasterization:** Documents are rendered into high-resolution PNG canvases via `pdfjs-dist` and `@napi-rs/canvas`, preserving embedded standard font glyphs.
3. **Question Extraction:** Printed questions are extracted deterministically from PDF text streams (or via vision AI for scanned question papers).
4. **Answer Detection:** Handwritten answer blocks, student-written question references (e.g. `"Ans 1"`), and bounding coordinates are detected via vision AI.
5. **Answer Mapping:** The mapping engine pairs questions to student answers using deterministic rules first, falling back to semantic candidate evaluation for ambiguous cases.
6. **Coordinate Normalization:** Pixel coordinates are converted into fractional `[0..1]` bounds, decoupling spatial grounding from image resolution.
7. **Interactive Review:** The workspace renders questions alongside the answer sheet canvas, dynamically drawing highlight boxes around active answers.
8. **Edge-Case Surfacing:** Unanswered questions and unmatched answers are surfaced with clear status badges and explanatory feedback.
9. **Assessment Summary:** Aggregates marks and review statuses into a top-level summary banner.

---

## Answer Mapping Strategy

The mapping engine uses a three-tier decision hierarchy to maximize accuracy and eliminate false positives:

| Tier | Method | Criteria | Resulting Status |
|---|---|---|---|
| **Tier 1** | **Explicit Reference** | Student wrote an explicit label matching question number (e.g., `"Ans 1"`, `"Q.2"`, `"11(a)"`). | `Matched` (Confidence: 0.95) |
| **Tier 2** | **Structural Sequence** | Single unlabeled answer with single candidate question (1:1 correspondence). | `Matched` (Confidence: 0.80) |
| **Tier 3** | **Semantic Fallback** | Unlabeled or out-of-order answers resolved by vision AI candidate evaluation. Matches with confidence < 0.85 are flagged. | `Matched` (≥0.85) or `Needs Review` (<0.85) |

- **Conservative Review Policy:** When an answer is ambiguous, conflicting, or mapped with low confidence, the engine assigns `status: needs_review` rather than presenting an uncertain match as definitive.
- **Resolution-Independent Coordinates:** Normalized `[0..1]` fractions ensure spatial highlights remain pixel-accurate at any display resolution or zoom setting.

---

## AI & Model Approach

- **Vision AI Provider:** Google Gemini API (`@google/genai`), configured by default to `gemini-2.5-flash` / `gemini-3.6-flash`.
- **Hybrid Extraction:** Question paper extraction prioritizes deterministic text-layer extraction for digital PDFs, reserving vision model calls for handwritten answer sheets or scanned documents.
- **Structured Schema Output:** All Gemini API responses use strict JSON Schema enforcement and are validated at runtime with Zod schemas (`RawQuestionExtractionArraySchema`, `RawAnswerBlockArraySchema`, `SemanticMappingResponseSchema`).
- **Provider Abstraction:** The AI layer is decoupled behind the `DocumentAIProvider` interface, facilitating testing and alternative model integrations.
- **Security:** API keys are restricted entirely to server-side operations and are never exposed to client-side bundles.

---

## Grading & Evaluation

The grading layer is designed to be truthful, conservative, and assignment-aligned:

- **Maximum Marks:** Section A CBSE Class XII Mathematics questions carry 1 mark each (16 marks total for the 16-question exam).
- **Unanswered Questions:** Confirmed unattempted questions are awarded **0 marks** with the feedback: `"Question was not attempted."`
- **Answered Questions:** Mapped answers where an automated solution key is not present are marked as **`— / 1 Marks (Awaiting Teacher Scoring)`** under `status: needs_review`. The system provides the exact answer location: `"Student response identified on Page(s) 1, 2 (Ref: "1"). Awaiting teacher scoring."`
- **Assessment Summary Banner:** Displays Total Questions (16), Answered (2), Unanswered (14), Needs Review (2), and Total Marks (`— / 16 Marks (Awaiting Review)`).

---

## Architecture

```text
Browser / Mobile Client
       ↓
Next.js 16 App Router (React 19)
       ↓
Assessment REST API (/api/assessment/*)
       ↓
Persistent Node.js Process
       ↓
Processing Pipeline (Async Serial Queue)
  ├─ Rasterization (pdfjs-dist + @napi-rs/canvas)
  ├─ Question Extraction (Text Parser / Gemini Vision)
  ├─ Answer Extraction (Gemini Multimodal Vision)
  ├─ Answer Mapping Engine (Explicit → Structural → Semantic)
  └─ Grading Evaluator & Finalization
       ↓
In-Memory Store (AssessmentStore + RasterStore)
       ↓
Dual-Pane Review Workspace (Canvas Spatial Overlay)
```

- **Hosting Model:** Deployed as a persistent Node.js web service on Render. The async processing pipeline and raster caches operate within the long-lived process memory.

---

## Engineering Decisions

- **In-Memory Store:** Uses process-lifetime `Map` collections (`assessmentStore`, `rasterStore`) for instant access and zero external database overhead.
- **Persistent Service over Serverless:** PDF rasterization, image encoding, and multi-stage pipeline orchestration run inside a persistent Node.js service to avoid serverless execution timeouts and state fragmentation.
- **Serial Execution Queue:** Upload processing jobs are processed sequentially in-memory to prevent simultaneous high-DPI rasterization from exceeding memory limits on resource-constrained hosting tiers.
- **Memory Management:** Canvas buffers and page references are cleaned up after serving to maintain low memory footprints.
- **Zod Runtime Validation:** Every data boundary (API payloads, Gemini AI outputs, domain models, grading summaries) is strictly validated at runtime.
- **Normalized Geometry:** Storing spatial coordinates as fractional bounding boxes eliminates distortion when switching between desktop and mobile viewport sizes.
- **Conservative Scoring:** Does not hallucinate artificial grades or fake 100% scores when a reference rubric is unavailable.

---

## Demo Assessment

The application includes a deterministic demo assessment accessible via the **"Try Demo Assessment"** button:

- **Question Paper Source:** `Maths-SQP-shorter-edited.pdf` (16 questions, Section A)
- **Answer Sheet Source:** `ANS_SHEET.pdf` (Handwritten answers for Q1 & Q2 across 3 pages)
- **Characteristics:** Completely deterministic, instant (<20ms response time), operates without live Gemini API calls, and is clearly designated as **Sample / Demo Data**.

---

## Mobile Experience

- **Responsive Viewport:** Adapts the desktop dual-pane layout into a focused single-pane mobile workspace.
- **Segmented Tab Switcher:** Allows seamless switching between **Questions** and **Answer Sheet** views.
- **Contextual Navigation:** Selecting any question automatically opens the Answer Sheet with its bounding box highlighted, with a top bar button to return to the question list.
- **Touch-Friendly Controls:** Full support for pinch/tap zooming and panning on mobile screens.

---

## Known Limitations

- **Vision Transcription:** Handwriting transcription fidelity depends on the underlying vision model and student handwriting legibility.
- **Bounding Box Granularity:** Bounding boxes provide answer-region spatial grounding rather than character-level OCR segmentation.
- **State Volatility:** Assessment records and raster caches reside in process memory and are reset when the server restarts or redeploys.
- **Single-Student Scope:** Optimized for single-assessment review sessions per submission.
- **Processing Time:** Live PDF processing for multi-page documents typically takes 20–45 seconds depending on Gemini API latency.

---

## Local Setup

### Prerequisites
- Node.js 20+
- npm 10+

### Installation

```bash
# Clone repository
git clone https://github.com/Chehrehmi/vedaai-assessment-extraction.git
cd vedaai-assessment-extraction

# Install dependencies
npm install
```

### Running Locally

```bash
# Start development server
npm run dev

# Start production server
npm run build
npm start
```
The application will be accessible at `http://localhost:3000`.

### Running Tests & Verification

```bash
# Run unit and integration test suite
npm test

# Run TypeScript typecheck
npm run typecheck

# Run production build
npm run build
```

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Google Gemini API Key (Server-side secret — do NOT prefix with NEXT_PUBLIC_)
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: Supported fallback key variable
# LLM_API_KEY=your_gemini_api_key_here

# Optional: Gemini model override (defaults to gemini-2.5-flash / gemini-3.6-flash)
# GEMINI_MODEL_NAME=gemini-2.5-flash
```

---

## Testing & Quality Assurance

- **Automated Tests:** **205 / 205 passing** across 13 test suites.
- **TypeScript Typecheck:** **0 errors** (`tsc --noEmit`).
- **Production Build:** Clean Next.js 16 build with Turbopack.
- **Test Coverage Areas:** PDF rasterization, font glyph rendering, question parser, answer bounding normalization, explicit/structural/semantic mapping, pipeline error recovery, grading summaries, demo workflows, and 8 canonical end-to-end QA journeys.

---

## Submission Summary

- **Live Deployed Demo:** [https://vedaai-assessment-6k51.onrender.com/](https://vedaai-assessment-6k51.onrender.com/)
- **Repository:** [https://github.com/Chehrehmi/vedaai-assessment-extraction](https://github.com/Chehrehmi/vedaai-assessment-extraction)
- **Primary Focus:** High-fidelity document rasterization, deterministic and semantic answer mapping, spatial bounding-box grounding, and edge-case handling (unanswered questions, out-of-order answers, multi-page spans).
