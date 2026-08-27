# VedaAI — AI-Powered Assessment Extraction & Answer Mapping

An AI-powered academic assessment review system that extracts printed question papers and handwritten student answer sheets, deterministically aligns student answers to exam questions (with semantic AI fallback), and renders an interactive review workspace with spatial bounding-box highlights.

---

## 🚀 Live Deployment
- **Production URL:** [https://vedaai-assessment-6k51.onrender.com/](https://vedaai-assessment-6k51.onrender.com/)
- **Deployment Platform:** Render (Persistent Node.js Web Service)

---

## 🛠️ Key Features

- **Document Ingestion & High-Fidelity Rasterization:** Accepts PDF/PNG/JPEG question papers and handwritten answer sheets (up to 10MB each), converting pages to high-resolution viewable canvases with embedded font preservation.
- **Hybrid Question Extraction:** Deterministically extracts questions and sub-parts from PDF text layers; falls back to Gemini 3.6 Vision AI for scanned papers.
- **Handwritten Answer Detection & Spatial Grounding:** Extracts student handwriting regions and normalizes 2D bounding boxes (`[ymin, xmin, ymax, xmax]` normalized to `[0..1]` fractions).
- **Two-Tier Answer Mapping Engine:**
  - **Tier 1 (Deterministic):** Explicit question references (e.g., `"Ans 1"`, `"Q.2"`, `"11(a)"`) and structural sequence alignment (Case A/B/C).
  - **Tier 2 (Semantic AI Fallback):** Unambiguous semantic candidate matching with confidence scoring.
- **Teacher Review Workspace:**
  - Dual-pane layout (desktop) and full-width segmented tab switcher (mobile).
  - Interactive question list with filtering (`All`, `Matched`, `Needs Review`, `Unanswered`) and search.
  - Multi-page answer navigation affordances (`Go to P.2 →`).
  - Zoom controls (`-`, `%`, `+`) and document switcher (`Answer Sheet` / `Question Paper`).
  - Spatial bounding-box highlighting over student handwriting.

---

## 📋 Environment Configuration

Create a `.env` file in the project root:

```env
# Google Gemini API Key (Server-side only — never exposed to client bundles)
GEMINI_API_KEY=your_gemini_api_key_here
```

*(Note: `LLM_API_KEY` is also supported for backward compatibility)*

---

## 💻 Local Setup & Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Test Suite
```bash
npm test
```

### 3. Typecheck
```bash
npm run typecheck
```

### 4. Build Production Bundle
```bash
npm run build
```

### 5. Start Production Server
```bash
npm start
```
The server will start at `http://localhost:3000` (or the port specified by `$PORT`).

---

## 🏗️ Architecture & Deployment

- **Framework:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS.
- **Rendering & Vision:** `@napi-rs/canvas`, `pdfjs-dist`, `@google/genai`.
- **Hosting Model:** Persistent Node.js container service (Render Web Service). In-memory `assessmentStore` and `rasterStore` handle single-assessment processing with serial queue concurrency protection.
