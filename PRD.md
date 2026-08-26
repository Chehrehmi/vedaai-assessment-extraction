# PRD — AI Assessment Extraction & Answer Mapping (VedaAI)

**Status:** Ready for implementation
**Owner:** Candidate (this document is the spec handed to the coding agent)
**Deadline:** 28 August 2026 (~12–16 focused engineering hours)
**Stack recommendation:** Next.js (App Router) monorepo, TypeScript, in-memory store, Gemini Flash (current generation, e.g. Gemini 3.5/3.6 Flash — see §21) for document AI

---

## 0. How to read this document

Priority order when anything conflicts (per the assignment brief itself):

1. **Explicit assignment requirement** (the brief text)
2. **Existing working UI/behavior** (the attached Stitch code — do not fight it)
3. **Figma/reference screenshots**
4. **Reasonable engineering inference**

Every inference is labeled **Assumption** with a reason. Every truly undetermined choice is labeled **Open Decision** with a recommended default so the coding agent never has to stop and ask.

---

## 1. Executive Summary

Teachers currently grade handwritten answer sheets by manually flipping between a printed question paper and a student's script, hunting for which page holds the answer to Q7. This product removes that hunt: a teacher uploads a question paper and one student's answer sheet, the system extracts the questions (in printed order, with sub-parts like `11(a)`/`11(b)` preserved), extracts and locates the student's answers on the scanned/photographed sheet, maps answers to questions, and — on click — jumps the document viewer to the exact page and highlights the exact handwritten region.

Grading/AI feedback is explicitly **optional** per the brief and is treated as P2 in this spec. The graded, demo-critical path is **extraction → mapping → highlighting**, because that's what's evaluated.

The existing Stitch-generated frontend (uploaded as source code) is ~92% aligned to the Figma reference and is treated as the **baseline UI**. This PRD describes the product/data behavior that must be wired into that UI — it does not redesign it.

---

## 2. Problem Statement

Given:
- A question paper (PDF or images), likely a clean, machine-printed/typed document.
- A single student's handwritten answer sheet (PDF or images), which may be a scan or phone photos, multi-page, with answers not necessarily in question order.

The system must let a teacher answer, per question, in under a second: *Was this answered? By what? Where exactly on the sheet?* — without them reading the whole script.

## 3. Product Goal

> A teacher should be able to select any question and immediately see: whether it was answered, what the answer says, and the exact highlighted region on the exact page of the answer sheet where that answer lives — and immediately see which questions were skipped entirely.

Every requirement in this document exists to serve this one interaction.

## 4. Target User

**Primary persona:** A single teacher/evaluator reviewing **one student's** assessment, in one sitting, in one browser tab.

Explicitly **not** modeled: student accounts, teacher accounts, multi-student batches, institution/admin roles, grading history across time. (The sidebar "Delhi Public School / Bokaro Steel City" branding and the "Madhur Rastogi" profile chip in the existing UI are static/decorative — **Assumption:** they are not tied to a real auth system and should stay hardcoded exactly as they are in the current code.)

---

## 5. Scope

### 5.1 MUST HAVE (P0 — graded, demo-critical)

| # | Requirement |
|---|---|
| 1 | Upload question paper (PDF or image) |
| 2 | Upload answer sheet (PDF or image) |
| 3 | Client + server file validation (type, size ≤ 10MB per the existing UI copy) |
| 4 | "Start Mapping" triggers processing |
| 5 | Processing progress shown via staged status (matches existing stepper UI) |
| 6 | Extract every question in correct printed order |
| 7 | Preserve original question numbering (not array index) |
| 8 | Detect labelled sub-parts (`11(a)`, `11(b)`) as **independent** question entries |
| 9 | Extract student answers from the answer sheet |
| 10 | Identify spatial answer regions (bounding boxes) per page |
| 11 | Support answers written out of printed order |
| 12 | Map each answer to a question with a defensible method + confidence |
| 13 | Detect and surface unanswered questions |
| 14 | Detect and surface answers that match no question |
| 15 | Support a single answer spanning multiple pages |
| 16 | Store page + normalized region coordinates per answer |
| 17 | Clicking a question selects its mapped answer |
| 18 | Selecting an answer navigates the viewer to the correct page |
| 19 | Viewer highlights the exact region(s) for that answer |
| 20 | Confidence tiers surfaced to the teacher (high / needs review / unmatched / unanswered) |
| 21 | Graceful handling of extraction/mapping failures (no silent crashes) |
| 22 | Deployed to a live URL |

### 5.2 NICE TO HAVE (P1/P2 — only after P0 is solid)

- Per-question marks/score and correct/incorrect evaluation
- Per-question AI feedback text (the existing UI already has an "AI Feedback" card slot in the review screen — reuse it, don't build a new component)
- An overall grading summary

### 5.3 EXPLICITLY DO NOT BUILD

Authentication · user accounts · a database (Postgres/Mongo/etc.) · persistent history across sessions · multi-student dashboards · batch processing of many students · an admin panel · complex analytics · a custom OCR model · microservices · containers/Kubernetes · granular permissions · a generalized state-management library (Redux/Zustand) beyond React state/context · an elaborate grading rubric engine.

**Assumption:** "In-memory storage is sufficient" (per brief) means a single process-lifetime store (e.g., a `Map<assessmentId, Assessment>` module singleton on the server). Data does not need to survive a server restart. This is explicitly acceptable for a hiring-assignment demo.

---

## 6. Non-Goals

- Grading accuracy/pedagogical correctness of AI feedback is not evaluated (per the brief's "What We Evaluate" list) — do not over-invest here.
- Perfect handwriting OCR is not achievable and not required; the evaluation is on **mapping and highlighting correctness**, not transcription fidelity.
- Supporting many students/answer sheets in one run is out of scope (brief says "one student handwritten answer sheet").

---

## 7. User Journey

```text
Upload question paper + answer sheet
        │
        ▼
Client-side validate (type, size) ──fail──▶ inline error, stays on Upload
        │ pass
        ▼
"Start Mapping" enabled → POST /api/assessment
        │
        ▼
Server: create Assessment record (status=queued) → return assessmentId immediately
        │
        ▼
Client redirects to Processing screen, polls GET /api/assessment/:id/status
        │
        ▼
Stage: uploading → reading question paper → extracting questions →
        reading answer sheet → detecting answer regions → mapping answers →
        finalizing
        │
        ├─ any stage fails ──▶ status=failed, reason surfaced, retry action offered
        │
        ▼ all stages succeed
status=completed → client fetches GET /api/assessment/:id (full payload)
        │
        ▼
Review screen loads: question list (left) + document viewer (right)
        │
        ▼
Teacher clicks a question
        │
        ▼
Look up AnswerMapping for questionId
        │
        ├─ status=unanswered ──▶ show "Not answered" state, no viewer navigation
        ├─ status=unmatched (n/a here — unmatched is answer-side) 
        ├─ status=needs_review ──▶ show best-guess answer + confidence badge + navigate
        └─ status=matched ──▶ navigate viewer to answer's first region's page,
                               render highlight overlay(s) for all regions
```

**Failure branch (any stage):** status flips to `failed` with a machine-readable `errorCode` and human message; the UI shows a retry affordable action ("Try again") that re-POSTs `/api/assessment` with the same two files still held client-side (files are kept in browser memory/state until the flow completes, so retry doesn't require re-upload if the failure was on our side — **Assumption**, since re-selecting files on every retry would be poor UX and nothing in the brief forbids client-side file retention pre-completion).

---

## 8. Screen / State Map

### 8.1 Audit of the existing UI (baseline — do not redesign)

The attached code + screenshots show four screens, each already implemented with desktop and mobile variants:

| Screen | File(s) in provided export | Purpose | User action available | Data currently hardcoded |
|---|---|---|---|---|
| **Upload — Empty** | "Design System" doc, "Upload - Empty (Desktop)" doc | Entry point for the Exams flow | Click/drag into either dropzone | None — genuinely empty state |
| **Upload — Filled** | "Upload - Filled (Desktop)" doc (mobile-styled), "Upload - Filled (Mobile)" doc | Confirm both files before mapping | Remove a file (✕), click "Start Mapping" (enabled only when both present) | Filenames/sizes/page-counts (`Class_10_maths_unit_test.pdf`, `student_1_answer_sheet.pdf`) are hardcoded strings |
| **Processing** | doc titled "Assessment Review - VedaAI" (mislabeled; content is the `Extracting…` spinner) and "Processing (Desktop)" doc's loading variant | Show progress while the pipeline runs | None (non-interactive) | Stepper list items are static text: "Uploading document" (done), "Reading paper & identifying questions" (active/pulsing), "Mapping answers to rubric" (pending), "Generating AI feedback" (pending) |
| **Review / Mapping** | "Processing (Desktop)" doc (the large dual-pane implementation) | Core value screen: question list + answer-sheet viewer with highlighting | Select a question, expand/collapse a question card, zoom/paginate the viewer, switch mobile tabs (Questions ⇄ Answer Sheet) | Questions, scores (`2/2`, `0/2`), AI feedback text, and the Q2 highlight box are all hardcoded sample content |

**Key existing structural facts to preserve exactly:**
- Design tokens (Tailwind config: colors, radii, spacing, fonts) are shared across all screens verbatim — **do not** introduce a second theme.
- Left sidebar nav (Home / My Classroom / Assignments / Exams-active / My Library) and top app bar are shared chrome across all four screens.
- Review screen desktop layout: **left pane ~5/12 width** = extracted-questions list (scrollable, each item collapsible, status pill shows `x/y` score styling — for MVP this pill is repurposed as a **status pill**, see §8.3); **right pane ~7/12** = document viewer with zoom control, page indicator (`Page 1 of 4`), prev/next controls, and an absolutely-positioned highlight `<div>` overlay already coded as a proof of concept over "Q2".
- Mobile review layout uses a **segmented control** ("Questions" / "Answer Sheet") with a `translate-x-full` slide transition (`switchTab()` JS already present) instead of a side-by-side pane. Reuse this exact mechanism.
- The highlight overlay in the existing code is a hand-placed `absolute -inset-4` div with fixed Tailwind offsets — this must be replaced by **computed** positioning driven by normalized coordinates (see §18), not deleted or redesigned structurally.

### 8.2 Gaps between existing UI and a working submission

| Gap | Needed for | Notes |
|---|---|---|
| Real file upload (drag/drop + input) wired to state | Upload screens | Dropzone `<button>` elements exist but have no `onChange`/drop handlers |
| Client-side validation (type/size) | Upload screens | "Max 10MB" is only a label today |
| API layer (`/api/assessment/*`) | All screens | No fetch calls exist in the exported HTML |
| PDF/image → per-page raster images | Processing, Review | Viewer currently renders one static placeholder image |
| Question extraction (AI or text-layer parsing) | Review left pane | Questions are hardcoded JSX |
| Handwritten answer extraction + region detection | Review right pane | Highlight box is hand-coded, not data-driven |
| Answer segmentation & out-of-order handling | Review | No logic exists at all today |
| Sub-question (`11(a)`/`11(b)`) modeling | Review left pane | Existing sample data has no sub-question example |
| Mapping engine + confidence | Review | Score pills (`2/2`) must be reinterpreted as **status pills**, not marks, unless grading (P2) is implemented |
| Coordinate system + responsive scaling | Review viewer | No normalization exists; box is pixel-hardcoded |
| Real processing-stage polling | Processing screen | Stepper is static; needs to reflect true async state |
| Error/empty/failure states | Upload, Processing, Review | None of the four screens render an error variant today |
| Deployment | — | N/A in provided code |

**None of these gaps require a new screen.** They are all data/behavior wired into the four existing screens.

### 8.3 Reinterpreting the existing "score pill"

**Open Decision:** The Figma/Stitch review screen displays a fraction (`2/2`, `0/2`) next to each question, which visually implies grading. Since grading is P2, MVP should **repurpose this exact pill component** to show mapping status instead, using equivalent visual weight:

| MVP status | Pill text | Pill color token (existing) |
|---|---|---|
| `matched`, high confidence | `✓ Matched` | `tertiary-container` / `tertiary` (existing green — already used for the `2/2` pill) |
| `needs_review` | `⚠ Review · 62%` | `primary-container` (existing orange — already used for the `0/2` pill, which reads as "attention") |
| `unanswered` | `— Not answered` | `secondary-container` / `on-surface-variant` (neutral gray) |
| `unmatched` (surfaced in a separate "Unmatched Answers" list, not on a question card) | `? Unmatched` | `error-container` |

If P2 grading is implemented, the pill can show `score + status` together (e.g. `2/2 ✓`), which is a superset of the MVP pill and requires no structural change — this is why the existing component is reused rather than replaced.

### 8.4 Full State Machine

#### Upload screen states
| State | Trigger to enter | Visual (existing component) | Exit transition |
|---|---|---|---|
| `empty` | Initial load | Both dashed dropzones, "Start Mapping" disabled | User selects a file → `partially_filled` |
| `partially_filled` | One file selected | One dropzone becomes a filled card, other stays dashed | Second file selected → `both_filled`; remove → `empty` |
| `both_filled` | Both files selected & valid | Both filled cards, "Start Mapping" enabled | Click Start Mapping → `submitting`; remove either → `partially_filled` |
| `invalid_file` | Wrong MIME type selected | Inline error text under the offending dropzone, file rejected (not stored) | Re-select → back to prior fill state |
| `oversized_file` | File > 10MB | Inline error "File exceeds 10MB", file rejected | Re-select → back to prior fill state |
| `submitting` | Start Mapping clicked | Button shows spinner/disabled | Success → navigate to Processing screen; network failure → `upload_failed` |
| `upload_failed` | POST /api/assessment errors | Both_filled state restored + toast/inline error, "Try again" | Retry → `submitting` |

#### Processing screen states
Mapped 1:1 to the existing 4-item stepper (`Uploading document` / `Reading paper & identifying questions` / `Mapping answers to rubric` / `Generating AI feedback`). **Assumption:** the 4th stepper item ("Generating AI feedback") is relabeled to **"Finalizing results"** for MVP builds that skip grading, and reused as-is for builds that include P2 feedback — a one-line copy change, no structural change.

| State | Meaning | UI |
|---|---|---|
| `queued` | Assessment created, pipeline not yet started | Step 1 pulsing |
| `uploading` | Files persisted server-side / rasterized | Step 1 pulsing |
| `reading_question_paper` | Question-paper pages rasterized/parsed | Step 1 done, step 2 pulsing |
| `extracting_questions` | AI/text-layer question extraction running | Step 2 pulsing |
| `reading_answer_sheet` | Answer-sheet pages rasterized | Step 2 done, step 3 pulsing (label covers both reading + region detection) |
| `detecting_answers` | Vision extraction of answer text + regions | Step 3 pulsing |
| `mapping_answers` | Mapping algorithm running | Step 3 pulsing |
| `finalizing` | Assembling response payload | Step 4 pulsing |
| `completed` | Done | Auto-navigate to Review |
| `failed` | Any stage threw / validation failed | Replace stepper area with error card: message + "Try again" + "Upload different files" |

#### Review screen states
| State | Meaning | UI |
|---|---|---|
| `loaded` | Data fetched, nothing selected | Left list shows all questions with status pills; viewer shows page 1 of answer sheet, no highlight |
| `question_selected:matched` | Teacher clicked a matched question | Card expands (existing expand/collapse pattern), viewer navigates + highlights |
| `question_selected:needs_review` | Low/medium confidence match | Card expands with a visible confidence badge; viewer still navigates + highlights, but overlay uses a dashed/amber style instead of solid green (**Assumption**: reuse the existing amber (`primary-container`) tokens already in the palette) |
| `question_selected:unanswered` | No mapping exists for this question | Card expands showing "No answer detected for this question." Viewer does **not** navigate (stays where it was) |
| `unmatched_answers_panel` | Optional/secondary — a collapsible section below the question list listing answers with no question match | Each entry, when clicked, navigates + highlights on the viewer exactly like a matched answer, but is not attached to any question card |
| `page_loading` | Viewer fetching/rendering a page image | Skeleton/blur over document pane |
| `multi_page_answer_selected` | Selected answer's regions span >1 page | Viewer shows current page's region + a small "This answer continues on page N" affordance with a jump control |
| `processing_error_recovered` | Data loaded but some questions/answers list is empty (e.g., 0 answers extracted) | Empty-state illustration in the relevant pane + explanatory copy, rest of UI still usable |

---

## 9. Functional Requirements

FR-1. The system MUST accept PDF, PNG, and JPEG for both uploads. **Assumption:** brief says "PDF or images"; JPEG/PNG cover "images." HEIC is out of scope (not a web-standard renderable type without conversion) — reject with a clear message.

FR-2. The system MUST reject files >10MB client-side before upload and MUST re-validate server-side (never trust the client).

FR-3. The system MUST NOT proceed to processing until both files are present and valid.

FR-4. The system MUST convert every page of both documents into raster images server-side, because: (a) the viewer needs to render pages regardless of source format, and (b) the vision AI step needs images, not raw PDF bytes, for the answer sheet.

FR-5. The system MUST extract questions preserving printed order via an explicit `order` field — the array index of `Assessment.questions` is never assumed to reflect print order in code that consumes it (always sort by `order` before rendering, even though in practice extraction will already emit them in order).

FR-6. The system MUST assign each labelled sub-part (`(a)`, `(b)`, roman numerals, etc.) its own `Question` record with a `parentNumber` back-reference, and MUST assign it its own position in `order` immediately after its parent/siblings in print sequence.

FR-7. The system MUST extract every discernible block of handwritten answer content into one or more `Answer` records, each carrying page(s) and region(s) — never text alone.

FR-8. The system MUST run a three-tier mapping strategy (explicit reference → structural/sequential → semantic) per §15, and MUST record which method produced each mapping.

FR-9. The system MUST classify every mapping into exactly one status: `matched`, `needs_review`, `unanswered`, `unmatched` (§16), and the UI MUST visibly distinguish all four.

FR-10. The system MUST support an `Answer` whose `pages` array has length >1, and the viewer MUST let the teacher move between those pages while keeping the same answer "selected."

FR-11. The system MUST validate every AI response against a Zod schema before it touches the domain model; a validation failure MUST trigger the documented retry/fallback (§22), never a silent pass-through of malformed data.

FR-12. The system MUST NOT crash the app on any single-stage failure; it MUST surface a scoped error and offer recovery (§26).

---

## 10. Document Processing Requirements

1. **Ingestion:** accept `multipart/form-data` with two file fields (`questionPaper`, `answerSheet`).
2. **Normalization:** for a PDF, render each page to a PNG at a fixed max dimension (**Assumption:** 1600px on the long edge — enough resolution for handwriting legibility and vision-model accuracy, small enough to keep base64 payloads and memory reasonable). For an image upload, treat it as a 1-page document and still run it through the same resize/normalize step for consistent coordinate math.
3. **Page metadata:** record `pageNumber`, `width`, `height` (post-normalization, in pixels) for every page — this is the denominator for coordinate normalization (§18).
4. **Storage:** normalized page images are held in the in-memory store alongside the `Assessment` record and served through a dedicated image endpoint (§20) rather than embedded as base64 in the main JSON payload (keeps the status/result payload small and lets the browser cache page images).
5. **Document type detection matters for extraction strategy:**
   - *Question paper:* usually a clean, machine-generated or typed document. **Prefer deterministic text-layer extraction** (via a PDF text-extraction library) when the PDF has an embedded text layer, because this gives pixel-exact positions for free and is far more reliable than any model. **Fall back to vision-AI extraction** when the question paper is itself an image/scan with no text layer. See §11.
   - *Answer sheet:* handwritten — there is no reliable text layer. **Always use vision-AI extraction** for the answer sheet (§13). This is the single highest-risk component of the whole system (§ARCHITECTURE risk section).

---

## 11. Question Extraction

**Inputs:** normalized page images of the question paper (+ raw PDF text layer + per-character/word bounding boxes, when available).

**Two extraction paths, chosen automatically per document:**

**Path A — Text-layer PDF (preferred):**
1. Extract the full text stream with positions (word/line bounding boxes in PDF points).
2. Run a **rule-based segmenter** over the text using numbering patterns: `^\d+\.`, `^\d+\)`, `^Q\d+`, `^\d+\s*\([a-z]\)`, `^\([a-z]\)` (as a continuation of the preceding numbered question), etc.
3. For each detected boundary, capture the question text up to the next boundary, and the union bounding box of its lines (kept only for potential future "show me on the question paper" feature — not required for MVP highlighting, which is answer-sheet-only, but cheap to keep since we already have it).
4. Assign `order` sequentially as boundaries are found top-to-bottom, page-to-page.
5. **Sub-part detection:** if a line matches `^\(?[a-z]\)?\s` immediately following (or nested under) a numbered question with no new leading number, create a child `Question` with `parentNumber` set and `subPart` set to the letter, and give it its own `order` value between its parent and the next top-level question.

**Path B — Image-only question paper (fallback):**
1. Send each page image to the vision model with a structured-output prompt: *"List every question and labelled sub-part in this exam page, in the exact order they appear top-to-bottom. Preserve the original numbering exactly as printed."*
2. Response is validated against `QuestionExtractionSchema` (§22).
3. `order` is assigned by the model's array order for that page, then globally sequenced by page number.

**Numbering normalization rule (applies to both paths):** the printed label (`"11 (a)"`, `"Q.11(a)"`, `"11a"`, …) is stored verbatim in `Question.number` for display, and parsed into `parentNumber="11"`, `subPart="a"` for logic/grouping. A top-level question has `parentNumber = undefined`.

**Acceptance criteria:**
- AC-Q1: Given a question paper with items `9, 10, 11(a), 11(b), 12`, extraction yields 5 `Question` records, with `11(a)` and `11(b)` each having `parentNumber: "11"` and distinct `id`s.
- AC-Q2: Given the same paper, sorting `questions` by `order` reproduces the exact printed sequence, independent of the order the array was JSON-serialized in.
- AC-Q3: Given a text-layer PDF, no vision-AI call is made for question extraction (verified by pipeline logs / mock call count in tests).

---

## 12. Answer Extraction

**Inputs:** normalized page images of the answer sheet.

**Method:** For every page, call the vision model once with a prompt requesting: a list of distinct handwritten answer blocks visible on that page, each with (a) transcribed text (best-effort), (b) a normalized bounding box, (c) an explicit question reference if the student wrote one (`"Q5"`, `"5."`, `"11(b)"`, underlines, boxed numbers, margin annotations), and (d) a confidence score for the transcription/segmentation itself.

**Per-page, not whole-document-in-one-call — why:** a single call across many images increases hallucination risk and makes bounding boxes page-relative rather than ambiguous across pages (**Assumption**, made explicit because it affects cost: N pages = N calls, acceptable for a single answer sheet of a few pages in a demo).

**Each block becomes (or extends) an `Answer` record:**
- If the block carries a clear explicit reference, it seeds a new `Answer` for that reference (or appends to an existing `Answer` for the same reference found on an earlier page → multi-page support, §14).
- If it carries no reference, it still becomes an `Answer` (with `detectedQuestionReference: undefined`) — it is **never dropped**, because it may still be resolved at the structural or semantic mapping tier, or legitimately end up `unmatched` (which the brief explicitly requires the product to show, not hide).

**Acceptance criteria:**
- AC-A1: Every page of the answer sheet produces at least an empty-but-valid array from the model (schema-checked), never an unhandled exception.
- AC-A2: An `Answer` with `pages.length > 1` exists in the model whenever the same explicit reference is detected on two different pages.
- AC-A3: A handwritten block with no legible reference still produces an `Answer` record (not silently discarded).

---

## 13. Answer Segmentation

Boundaries between answers are determined by, in priority order:

1. **Explicit reference lines/labels** the student wrote (strongest signal — also feeds mapping tier 1).
2. **Visual whitespace gaps** the vision model is asked to respect ("treat a clear vertical gap or ruled line as a boundary between two answers").
3. **Change in detected reference** — if block N says "Q5" and the very next block says "Q6", that's a boundary even with no visible gap.
4. **Page boundaries never force a new answer** — a page break alone does not start a new `Answer`; it only appends a new region + page to the current one if content clearly continues (e.g., a fresh page starts mid-sentence, or the model is asked "does this page's first block look like a continuation of the previous page's last open answer?" and answers yes/no with a reason).

Handled explicitly:
- **Multiple answers on one page:** each becomes its own region within its own `Answer` (or a new `Answer` if a new reference is detected).
- **Headers/roll number boxes/margins:** the prompt explicitly instructs the model to ignore administrative page furniture (name, roll number, page number, printed rulings) and only return content blocks that look like actual answers.
- **Blank space:** pages/regions with no handwritten content produce zero blocks for that page — this is valid and expected, not an error.
- **Out-of-order questions:** segmentation does **not** assume physical order equals question order — it just finds blocks and (optionally) their self-reported reference; ordering resolution happens entirely in mapping (§15), never in segmentation.

---

## 14. Answer Mapping

Three-tier waterfall, run once per unmapped `Question`/`Answer`, in this order — a lower tier is only consulted if a higher tier produced no confident result:

### Tier 1 — Explicit reference (highest confidence, ~0.9–1.0)
If any `Answer.detectedQuestionReference` normalizes (same rule as §11's numbering normalization) to exactly one `Question.number`, create/confirm that `AnswerMapping` with `method: "explicit_reference"`. If it normalizes ambiguously (matches a parent when a sub-part exists, e.g., student wrote just "11" but the paper has `11(a)`/`11(b)`) — treat as `needs_review` and let the teacher's context (viewer + both candidate questions surfaced) resolve it; **do not guess** which sub-part.

### Tier 2 — Structural / sequential evidence (medium confidence, ~0.6–0.85)
For any `Answer` with no usable explicit reference, and for any `Question` still unmapped after Tier 1:
- Build the sequence of *unmapped* answers in the order they physically appear (page, then top-to-bottom position) and the sequence of *unmapped* questions in printed order.
- Attempt a **local alignment**: if answer *k* sits immediately after an answer confidently mapped (Tier 1) to question *i*, and question *i+1* is still unmapped, propose answer *k* → question *i+1* (i.e., "the next unclaimed answer likely continues in printed order from the last confidently-placed one"). This directly supports the common real-world pattern where a student answers sequentially except for a few explicitly-labelled jumps.
- This tier never produces `matched`; its ceiling is `needs_review`, because it is a heuristic, not a stated fact.

### Tier 3 — Semantic similarity (lowest confidence, variable)
For anything still unresolved: send the remaining unmapped questions' text and remaining unmapped answers' transcribed text to the AI in one batched call, asking for a best-guess pairing with a 0–1 confidence per pair (`MappingSuggestionSchema`, §22). Apply a threshold:
- confidence ≥ 0.75 → `needs_review` (never auto-promoted to `matched` — semantic guesses always require a human glance, by design)
- confidence < 0.75 → leave unresolved

### Final classification (after all 3 tiers)
- `Question` with a Tier-1 mapping → `matched`.
- `Question` with a Tier-2/3 mapping → `needs_review`.
- `Question` with no mapping at all → `unanswered`.
- `Answer` with no mapping at all → surfaced separately as `unmatched` (in the "Unmatched Answers" panel, §8.4).

**Never** silently force a low-confidence pairing into `matched`. This is a hard rule (the brief explicitly grades "handling of edge cases," and a wrong-but-confident-looking match is worse than an honest "needs review").

**Acceptance criteria:**
- AC-M1: Given an answer explicitly labelled "Q5" and a question numbered `5`, the mapping has `status: "matched"`, `method: "explicit_reference"`, `confidence >= 0.9`.
- AC-M2: Given an answer with no reference sitting immediately after a Tier-1-matched answer, in a document where the next question is otherwise unmapped, the mapping (if produced) has `status: "needs_review"`, never `"matched"`.
- AC-M3: Given a question with zero candidate answers after all 3 tiers, it is classified `unanswered` and appears as such in the review list.
- AC-M4: Given an answer that cannot be resolved to any question after all 3 tiers, it appears in the Unmatched Answers panel and is never attached to an unrelated question card.

---

## 15. Confidence Model

| Tier | Confidence band | UI label | Meaning to the teacher |
|---|---|---|---|
| High | ≥ 0.9 (Tier 1 only) | `✓ Matched` | "Trust this, the student labelled it." |
| Medium | 0.75–0.89 | `⚠ Needs review · NN%` | "Probably right, glance at it." |
| Low / none | < 0.75 or absent | `— Not answered` / `? Unmatched` | "No defensible pairing exists." |

Confidence is stored per-`AnswerMapping` (`confidence: number`, 0–1) and is **not** decorative: it directly determines badge color/label, whether the overlay renders solid vs. dashed, and whether the mapping is eligible to be called `matched` at all (Tier 2/3 results are structurally capped at `needs_review` regardless of numeric confidence — see §15 rule above).

---

## 16. Coordinate / Highlighting Specification

This is the mechanism the whole demo hinges on — specified precisely so there is no ambiguity for the implementer.

### 16.1 Coordinate system
- **Origin:** top-left corner of the page, `(0,0)`.
- **Normalization:** every `AnswerRegion` stores `x, y, width, height` as **fractions of the page's normalized dimensions** (`0.0`–`1.0`), *not* raw pixels. `x,y` = top-left of the box; `width,height` extend right/down from there.
- **Why normalized, not pixel:** the same region must render correctly at any zoom level (`100%` control already exists in the UI) and any viewport size (desktop dual-pane vs. mobile full-width tab) without re-deriving coordinates. Rendering is simply: `pixelX = x * renderedPageWidthPx`, etc.
- **Source of truth for denominator:** `DocumentPage.width` / `DocumentPage.height` (the normalized raster dimensions produced at ingestion, §10) are what the AI's returned pixel/0–1000-scale coordinates are divided by to produce the 0–1 fraction stored on the domain model. This conversion happens once, server-side, immediately after the AI call — the frontend never sees or needs to know the AI's native coordinate scale.
- **Validation:** any region where `x<0 or y<0 or x+width>1 or y+height>1` (with a small epsilon tolerance, e.g., 0.02, for near-edge boxes) is clamped to the page bounds rather than rejected outright — a slightly clamped box is still useful to the teacher; a rejected one shows nothing.

### 16.2 Selection → highlight interaction
```text
Teacher clicks Question Q
   → look up AnswerMapping where questionId === Q.id
   → if none or status === "unanswered": show "not answered" state, viewer untouched
   → else resolve Answer via mapping.answerId
      → take Answer.regions, group by page
      → set viewer.currentPage = regions[0].page   (first region in reading order)
      → render one highlight overlay per region on that page
      → if Answer.pages.length > 1: render a small
        "Continues on page N →" affordance; clicking it sets
        viewer.currentPage to the next page that has a region for this answer
```

### 16.3 Multi-region rendering
An `Answer` may have >1 `AnswerRegion` on the **same** page (e.g., the student's answer wraps around a diagram) — render each as its own overlay `<div>` with identical styling, all visible simultaneously. This requires the highlight layer to map over `regions.filter(r => r.page === currentPage)`, not assume a single box.

### 16.4 Responsive scaling
The overlay container MUST be positioned `absolute` inside a wrapper that is exactly the rendered `<img>`'s box (matching the existing code's approach of nesting the highlight `div` inside the paper-mockup `div`), so that `%`-based inline styles (`left: ${x*100}%`, `top: ${y*100}%`, `width: ${width*100}%`, `height: ${height*100}%`) scale automatically with zoom/resize — **no JS resize listeners required**, this is a pure-CSS solution given percentage units.

### 16.5 Visual style by confidence
- `matched` → solid 2px border, existing `tertiary`/green tokens (already used for the sample Q2 box in the provided code).
- `needs_review` → dashed border, existing `primary-container`/orange token.
- Both reuse the **existing** highlight box component; only the border style/color and an optional badge (`Q5` label chip, already coded) change based on confidence.

**Acceptance criteria:**
- AC-H1: Given a mapped answer whose first region is on page 3, selecting its question sets the viewer's current page to 3 and renders that region's overlay at the position implied by its normalized coordinates (verified by a snapshot/DOM test checking computed `style.left/top/width/height` percentages match the stored fractions).
- AC-H2: Given an answer with regions on pages 2 and 4, the viewer shows page 2 first and offers a control to jump to page 4, which then shows that page's region.
- AC-H3: Resizing the viewport (desktop → mobile breakpoint) does not require any coordinate recomputation — the same stored fractions render correctly at both sizes.

---

## 17. Document Viewer Requirements

- Page navigation (prev/next, and a direct page indicator `Page X of N`) — **already coded**, needs to be wired to real page count/state.
- Zoom control (`100%`, `+`/`-`) — **already coded** as a static display; MVP may keep it non-functional or wire it to real CSS `transform: scale()` (**Open Decision** — recommend wiring it if time allows, P1, since it's visually present and trivial to implement, but it is not required for the graded flow).
- Selected-page state owned by the Review screen's top-level component, passed down to both the viewer and the "jump to page" affordance from §16.2.
- Loading state: while a page image is being fetched, show a blur/skeleton over the paper mockup (reuse existing `bg-[#2D2D2D]` dark viewer chrome as the loading backdrop).
- Missing region: if a selected `Answer` somehow has zero regions (should not happen given AC-A1/AC-A2, but must be handled defensively), show the correct page with no overlay and a small inline note "Exact region unavailable — showing full page."
- Invalid page: if `currentPage` is set beyond `pageCount` (defensive only — should be prevented upstream), clamp to the last valid page.

---

## 18. Required Edge Cases — Specified Behavior

| # | Case | Required behavior |
|---|---|---|
| 1 | Sequential answers | Tier 1/2 mapping resolves cleanly; all `matched` or `needs_review`, none `unmatched`. |
| 2 | Out-of-order answers | Physical position is ignored for correctness; Tier 1 explicit references (or Tier 3 semantic fallback) still resolve correct pairing regardless of page/position order. |
| 3 | `11(a)` / `11(b)` | Two distinct `Question` records, both correctly targetable by their own explicit references; an answer labelled just "11" with no sub-letter is `needs_review` against both candidates, never silently assigned to one. |
| 4 | Unanswered question | `status: "unanswered"`, shown distinctly in the list, viewer does not navigate when selected. |
| 5 | Answer exists but can't be matched | Appears in "Unmatched Answers" panel with `status: "unmatched"`; still fully viewable/highlightable from that panel. |
| 6 | Answer continues on another page | Single `Answer` record, `pages: [n, n+1, …]`, multiple `regions`; viewer offers page-jump affordance (§16.2/16.4). |
| 7 | Explicit reference unreadable | Treated as "no reference" (falls through to Tier 2/3), not as an error. |
| 8 | No explicit reference exists anywhere on a block | Falls straight to Tier 2/3; never blocks the pipeline. |
| 9 | AI returns malformed output | Zod validation fails → one automatic retry with a stricter/repair prompt → if still invalid, that stage is marked `failed` for the smallest possible scope (e.g., just that page's answer extraction) and the pipeline continues with what it has, flagging the gap rather than aborting the whole assessment (**Assumption**: partial results are more useful to a teacher than a hard failure — see §26 for exact scoping). |
| 10 | No questions extracted at all | Processing completes with `status: "completed_with_warnings"` (or simplest: `completed` + an empty-state banner in the Review screen: "We couldn't detect any questions in this document. Try a clearer scan.") — pipeline does not hard-fail, since the answer sheet may still be independently viewable. |
| 11 | No answers extracted at all | Every question becomes `unanswered`; Review screen shows this plainly rather than looking broken. |
| 12 | Only some questions confidently mapped | Perfectly normal steady-state — no special handling needed beyond the four status categories already defined. |

---

## 19. Error Handling

| Failure | Technical cause | User-facing message | Recovery | Retryable? |
|---|---|---|---|---|
| Unsupported file type | MIME not in `{pdf, png, jpg, jpeg}` | "Please upload a PDF, PNG, or JPG file." | Re-select file | Yes, immediately |
| File too large | Size > 10MB | "File exceeds the 10MB limit." | Re-select a smaller file | Yes, immediately |
| Upload transport failure | Network error / server 5xx on POST | "Upload failed — check your connection and try again." | "Try again" button (files retained client-side) | Yes |
| PDF render/conversion failure | Corrupt PDF or unsupported PDF feature | "We couldn't open this PDF. Try re-exporting or uploading images instead." | Re-upload | Yes |
| Question extraction failure (both paths exhausted) | Text layer absent AND vision call failed/invalid after retry | Non-fatal — Review screen shows empty question list + explanatory banner (Edge Case 10) | Continue viewing answer sheet; optionally re-run | Yes (re-run whole assessment) |
| Answer extraction failure for a specific page | Vision call failed/invalid after retry for that page | That page contributes zero `Answer` blocks; a small badge on the page-N control notes "Extraction incomplete for this page" | Continue with remaining pages | Partial — whole-assessment re-run is the only retry granularity for MVP |
| AI timeout | Provider latency/outage | "The AI service is taking too long — please try again in a moment." | "Try again" | Yes |
| Invalid AI JSON after retry | Model deviates from schema twice | Scoped failure per Edge Case 9 | Automatic (bounded retry already attempted) | N/A (already retried) |
| Assessment not found | Bad/expired in-memory id (e.g., server restarted) | "This assessment session has expired — please start again." | Return to Upload | No — start over |

**Global rule:** no failure ever produces a blank screen or an unhandled JS exception reaching the user; every catch boundary renders one of the states in §8.4/§17/this table.

---

## 20. Frontend Integration (wiring domain data into the existing UI)

```text
Assessment.questions (sorted by order)
        ↓
QuestionList (existing left-pane component)
   each item ← Question.number/text + its AnswerMapping status pill (§8.3)

Assessment.mappings
        ↓
QuestionList item expand state
   expanded card shows: mapped Answer's rawText (or "No answer detected"),
   confidence badge, and (if P2) AI feedback slot — reuses the exact
   existing "AI Feedback" card markup/classes

Assessment.answers[].regions
        ↓
HighlightOverlay (new small component, styled with existing highlight-box
   classes) rendered inside the existing viewer's paper-mockup container

Assessment.answers[].pages
        ↓
PageNavigator (existing prev/next + "Page X of N" chrome) — driven by
   real pageCount from the relevant Document, and by currentPage state
   owned by the Review screen

Assessment.answers not present in any mapping (unmatched)
        ↓
"Unmatched Answers" panel — a new, small, collapsible section appended
   below the existing question list, using the same card visual language
```

**State ownership (kept intentionally minimal, no external state library):**
- `AssessmentContext` (React Context + `useReducer`, colocated with the Review route) holds: `assessment` (fetched data), `selectedQuestionId`, `selectedAnswerId`, `currentPage`, `currentDocType` ("questionPaper" | "answerSheet"), and `viewerZoom`.
- Upload and Processing screens need only local component state (`files`, `uploadError`, `assessmentId`, `pollingStatus`) — no shared context required across route boundaries beyond passing `assessmentId` via the URL (`/exams/[assessmentId]/review`).

**Loading/selection rules:**
- Nothing is auto-selected on Review load (`loaded` state, §8.4) — matches the existing screenshot where no question card is pre-expanded except the sample.
- Selecting a new question always resets any "continues on page N" affordance from a previous selection.

---

## 21. AI Provider Architecture

**Recommendation: Google Gemini, current-generation Flash-tier model, via the Google AI Studio API.**

**Note on model naming (verify at implementation time):** Google's Flash line moves fast — `gemini-2.0-flash` was retired by Google in mid-2026, superseded by `gemini-2.5-flash`, then `gemini-3.5-flash` / `gemini-3.6-flash`, with `gemini-3.7-flash` the newest flagship Flash model as of this writing. **Assumption/Open Decision:** since the exact model id in production will depend on whatever is current and free-tier-eligible on the build date, the codebase should read the model id from an environment variable (e.g. `GEMINI_MODEL_ID`, defaulting to the latest stable Flash model available at build time — `gemini-2.5-flash` is a safe, well-established baseline if the newest model's free-tier terms are unclear) rather than hardcoding a model string anywhere in application code. This is exactly why the `DocumentAIProvider` abstraction (below) exists — the model id is a config detail of `GeminiDocumentAIProvider`, not a fact baked into business logic.

Reasoning against the stated optimization criteria (actual capability, handwriting, structured output, image/PDF input, region extraction, free tier, simplicity, speed) — these properties have held across every Flash-generation release to date, so the recommendation is for the **Flash tier of whichever Gemini generation is current**, not a specific frozen version:
- Free tier is generous and requires no billing setup — fastest path to a working demo before the deadline.
- Native multimodal input: accepts images directly (and PDFs in current SDK versions) without a separate OCR step.
- Reasonably strong handwriting transcription and instruction-following for structured JSON output (`responseMimeType: "application/json"` / response schema mode).
- Has demonstrated (documented) spatial/bounding-box grounding ability on images, which is exactly the capability this product depends on for the answer sheet — no other free-tier multimodal API currently offers this as a first-class, prompt-accessible feature as reliably.

**Alternatives considered and rejected (see ARCHITECTURE.md §"Alternatives Rejected" for detail):** OpenAI GPT-4o/4o-mini vision (good text QA, weaker/less consistent native bounding-box grounding, free tier is trial-credit-based not ongoing-free), Anthropic Claude vision (excellent reasoning, no first-class bounding-box primitive, paid only), a classic OCR engine like Tesseract/EasyOCR (fast/free but handwriting accuracy is poor and produces no semantic understanding of "which question is this," so it would need an LLM stage anyway — no savings).

**Provider abstraction (mandatory):** business logic never calls the Gemini SDK directly. All AI access goes through:

```ts
interface DocumentAIProvider {
  extractQuestionsFromImages(pages: PageImage[]): Promise<RawQuestionExtraction[]>;
  extractAnswerBlocks(page: PageImage): Promise<RawAnswerBlock[]>;
  suggestSemanticMappings(
    unmappedQuestions: Question[],
    unmappedAnswers: Answer[]
  ): Promise<RawMappingSuggestion[]>;
}
```

A `GeminiDocumentAIProvider` implements this interface; every method's return type is the **provider-agnostic raw shape**, immediately passed through Zod validation (§22) before any domain object is constructed. Swapping providers later means writing one new class, touching zero business logic.

---

## 22. AI Output Validation (Zod)

Every AI call's output MUST be parsed with `.safeParse()` before use. Sketch of the schemas (final field set may be refined during implementation, but the validation boundary itself is non-negotiable):

```ts
const QuestionExtractionSchema = z.array(z.object({
  number: z.string().min(1),          // verbatim printed label, e.g. "11 (a)"
  text: z.string().min(1),
  parentNumber: z.string().optional(),
  subPart: z.string().optional(),
}));

const AnswerBlockSchema = z.array(z.object({
  text: z.string(),                    // best-effort transcription, may be ""
  boundingBox: z.object({
    x: z.number().min(0), y: z.number().min(0),
    width: z.number().min(0), height: z.number().min(0),
  }),
  detectedQuestionReference: z.string().optional(),
  confidence: z.number().min(0).max(1),
}));

const MappingSuggestionSchema = z.array(z.object({
  questionId: z.string(),
  answerId: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
}));
```

**On validation failure:**
1. Retry once with an augmented prompt appending: "Your previous response was invalid. Return ONLY valid JSON matching this exact shape: …" plus the Zod-derived JSON schema description.
2. If the retry also fails validation, scope the failure to the smallest unit possible (one page's answer extraction, or the whole semantic-mapping batch) per Edge Case 9 (§18) — never let bad AI output reach the domain model or the UI.
3. Log the raw offending response server-side (console is sufficient for this assignment) for post-mortem/debugging, but never surface raw model output to the teacher.

---

## 23. Data Model

```ts
type ProcessingStage =
  | "queued" | "uploading" | "reading_question_paper" | "extracting_questions"
  | "reading_answer_sheet" | "detecting_answers" | "mapping_answers"
  | "finalizing" | "completed" | "failed";

type Assessment = {
  id: string;
  status: ProcessingStage;
  errorCode?: string;
  errorMessage?: string;
  questionPaper: Document;
  answerSheet: Document;
  questions: Question[];       // NOT guaranteed array-sorted; sort by `order` before display
  answers: Answer[];
  mappings: AnswerMapping[];
  createdAt: string;
};

type Document = {
  id: string;
  filename: string;
  mimeType: string;
  pageCount: number;
  pages: DocumentPage[];
};

type DocumentPage = {
  pageNumber: number;      // 1-indexed
  width: number;           // normalized raster width in px — coordinate denominator
  height: number;          // normalized raster height in px — coordinate denominator
  imageUrl: string;        // served via GET /api/assessment/:id/page/:docType/:n
};

type Question = {
  id: string;               // stable uuid — NEVER derived from array position
  number: string;           // verbatim printed label, e.g. "11 (a)"
  text: string;
  order: number;            // printed sequence — always sort by this for display
  parentNumber?: string;    // e.g. "11" for a sub-part
  subPart?: string;         // e.g. "a"
};

type AnswerRegion = {
  page: number;
  x: number; y: number; width: number; height: number; // normalized 0–1 fractions
  extractionConfidence?: number;
};

type Answer = {
  id: string;
  rawText?: string;
  pages: number[];                       // sorted ascending, len > 1 = multi-page
  regions: AnswerRegion[];               // one or more, possibly across pages
  detectedQuestionReference?: string;    // verbatim as written by the student, if legible
};

type AnswerMapping = {
  questionId: string;
  answerId?: string;                     // absent only when status === "unanswered"
  confidence: number;                    // 0–1
  status: "matched" | "needs_review" | "unanswered" | "unmatched";
  method?: "explicit_reference" | "structural" | "semantic";
};
```

This model satisfies every requirement in the assignment's own domain-model checklist (independent question/sub-question identity, answer identity/text/pages/regions, mapping confidence/status/method) with one addition (`AnswerRegion.extractionConfidence`, `Question.order`, `ProcessingStage`) justified above inline.

**Unmatched answers** are simply `Answer` records with `id` not referenced by any `AnswerMapping.answerId` — no separate type needed; the "Unmatched Answers" UI panel is derived by filtering, not a new domain concept.

---

## 24. API Contracts

### `POST /api/assessment`
Multipart form: `questionPaper` (file), `answerSheet` (file).
- **202 Accepted** → `{ assessmentId: string, status: "queued" }` — processing kicked off asynchronously server-side (fire-and-forget within the same Node process; no external queue for this scope, see ARCHITECTURE.md).
- **400** → `{ error: { code: "INVALID_FILE_TYPE" | "FILE_TOO_LARGE" | "MISSING_FILE", message } }`

### `GET /api/assessment/:id/status`
Polled every ~1s by the Processing screen.
- **200** → `{ status: ProcessingStage, errorCode?: string, errorMessage?: string }`
- **404** → `{ error: { code: "NOT_FOUND", message: "Assessment session expired." } }`

### `GET /api/assessment/:id`
Fetched once by the Review screen after `status === "completed"`.
- **200** → the full `Assessment` object (§23), minus raw page image bytes (those are referenced by URL).
- **409** → `{ error: { code: "NOT_READY", message } }` if called before completion (defensive; UI should not call it early, but the API guards anyway).
- **404** → same as above.

### `GET /api/assessment/:id/page/:docType/:pageNumber`
`docType` ∈ `{questionPaper, answerSheet}`.
- **200** → `image/png` binary of that normalized page.
- **404** → page/assessment not found.

**Assumption on async model:** given "no database, in-memory storage is sufficient" and the tight timebox, the simplest defensible approach is: `POST /api/assessment` stores the uploaded files, immediately returns the id, and calls an async pipeline function **without awaiting it**, updating a mutable in-memory status field as each stage completes. This avoids building a job queue while still giving the UI real, non-blocked progress to poll — which is exactly what the existing Processing screen needs. **Open Decision:** if the chosen deployment target does not support long-running background work in a single request/response cycle (e.g., certain serverless platforms), the simplest fallback is a single long-lived Node server (e.g., deployed on Render/Railway/Fly.io/a VM) rather than pure serverless functions — recommended default for this assignment given the timebox.

---

## 25. Testing Strategy

**Unit**
- Question numbering normalization (`"11 (a)"` → `{parentNumber:"11", subPart:"a"}`) across representative formats.
- Sub-question boundary detection on a synthetic text-layer input.
- Mapping tier logic in isolation (feed synthetic questions/answers, assert status/method/confidence per §14/AC-M1–M4).
- Coordinate normalization + clamping (§16.1) on boundary values (0, 1, slightly negative, slightly >1).
- Confidence → UI label mapping (§15 table).

**Integration**
- Full `POST /api/assessment` → poll `/status` → `GET /api/assessment/:id` happy path with a small fixture PDF pair, asserting final `mappings` array shape.
- A stage-specific failure (mock the AI provider to throw on answer extraction for one page) results in `status: "completed"` with that page's `Answer` set empty and no unhandled rejection.
- Zod validation rejection triggers exactly one retry (assert provider call count).

**End-to-end (browser)**
Cover all 8 journeys the brief effectively asks for: (1) sequential answers, (2) out-of-order answers, (3) `11(a)`/`11(b)` sub-questions, (4) an unanswered question, (5) an unmatched answer, (6) a multi-page answer, (7) a low-confidence/needs-review match, (8) a processing failure and recovery. Each should assert both the **data state** (correct status/labels) and the **visual outcome** (correct page + highlight position for the matched/needs-review cases).

**Assumption:** given the 12–16 hour timebox, unit tests on the mapping/coordinate logic (highest-risk, most testable-in-isolation code) are P0; integration/E2E coverage of all 8 journeys is P1 (do as many as time allows, prioritizing #3 sub-questions, #6 multi-page, and #4/#5 unanswered/unmatched since these are explicitly named in the brief's requirements list).

---

## 26. Acceptance Criteria (consolidated)

All criteria from §11–§18 apply. Additional cross-cutting criteria:

- AC-G1: Given both files uploaded and valid, clicking "Start Mapping" navigates to the Processing screen within the same interaction (no dead click).
- AC-G2: The Processing screen's visible stage always matches the server's current `ProcessingStage` within one polling interval (~1s).
- AC-G3: On `status: "failed"`, the teacher can retry without re-selecting files from disk (files retained client-side per §7).
- AC-G4: The Review screen never shows a question whose `order` would place it out of printed sequence relative to its neighbors.
- AC-G5: Every `Answer` referenced by any `AnswerMapping.answerId` exists in `Assessment.answers` (referential integrity, checkable at the API boundary).
- AC-G6: The app is reachable at a public deployed URL with no login wall.

---

## 27. MVP Priority Matrix

| Feature | Priority | Reason | Risk | Est. time |
|---|---|---|---|---|
| Upload + validation wiring | P0 | Entry point, brief-mandated | Low | 1h |
| Async pipeline + status polling | P0 | Needed for any real processing feedback | Low–Med | 1.5h |
| Page rasterization (PDF→image) | P0 | Everything downstream needs it | Med | 1.5h |
| Question extraction (text-layer path) | P0 | Highest-accuracy path for typed papers, graded criterion | Med | 1.5h |
| Question extraction (vision fallback) | P0 | Required if question paper is scanned | Med | 1h (shares prompt infra with answer extraction) |
| Sub-question (`11(a)`/`11(b)`) handling | P0 | Explicitly named in brief | Med | included above |
| Answer extraction + regions (vision) | P0 | Core graded criterion, highest technical risk | **High** | 2.5h |
| Answer segmentation (multi-page, blocks) | P0 | Explicitly named in brief | High | included above |
| Mapping engine (3-tier) | P0 | Core graded criterion | Med–High | 2h |
| Coordinate normalization + Zod validation | P0 | Prevents garbage-in/garbage-out; enables highlighting | Med | 1h |
| Viewer wiring: page nav + highlight overlay | P0 | The literal demo moment | Med | 1.5h |
| Question list wiring (status pills, expand) | P0 | Needed to select anything | Low | 1h |
| Unmatched-answers panel | P0 | Explicitly named edge case in brief | Low | 0.5h |
| Error/empty states across all screens | P0 | Graded ("handling of edge cases") | Low–Med | 1h |
| Deployment | P0 | Mandatory for submission | Low | 0.5h |
| Grading / scores | P2 | Explicitly optional in brief | Low | 1–2h if time remains |
| AI per-question feedback | P2 | Explicitly optional; UI slot already exists | Low | 0.5–1h if time remains |
| Zoom control wiring | P1 | Visually present already; polish only | Low | 0.25h |
| Overall grading summary | P2 | Optional, only with scores | Low | 0.5h |

**Total P0 estimate: ~15h**, consistent with the 12–16h timebox — meaning P1/P2 items are genuinely stretch goals, not padding. If time pressure hits, cut in this order: zoom control → AI feedback → grading/scores → grading summary. Never cut anything in the P0 table above; it is the graded surface area.

---

## 28. Known Limitations (to disclose in the submission form)

- Handwriting transcription accuracy is bounded by the vision model's OCR capability on cursive/messy handwriting; the product optimizes for **correct mapping and region location**, which is more robust to transcription noise than exact-text accuracy (a fuzzy-but-correctly-located answer still serves the product goal).
- Tier-2 (structural/sequential) mapping is a heuristic and can mis-order answers in pathological cases (e.g., a student who both skips around **and** never labels anything) — such cases will correctly surface as `needs_review` rather than a wrong `matched`, by design, but will require more manual glances from the teacher than a labelled script would.
- Bounding-box precision from a general-purpose vision model is "good enough for a highlight box around a paragraph," not pixel-perfect character-level grounding — acceptable given the product goal is "where roughly is this on the page," not OCR-grade layout analysis.
- No persistence: refreshing after a server restart loses in-memory assessments (explicitly acceptable per the brief's own constraints).
- Single-student scope only, per the brief; not a batch-grading tool.
- Zoom control (if left unwired per the P1 cut order) is visual-only in the initial submission.