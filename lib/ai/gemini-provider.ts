import { GoogleGenAI, Type } from '@google/genai';
import {
  DocumentAIProvider,
  PageImageInput,
  RawQuestionExtraction,
  RawAnswerBlock,
} from './types';
import {
  RawQuestionExtractionArraySchema,
  RawAnswerBlockArraySchema,
} from './schemas';

const QUESTION_EXTRACTION_PROMPT = `
You are an expert document analysis vision AI specialized in academic exam papers.
Analyze the provided question paper page image(s).

Task:
Extract every printed exam question and labelled sub-part in the exact order they appear top-to-bottom across the pages.

Instructions:
1. Identify all questions and sub-questions (e.g., "1", "2", "11(a)", "11(b)", "12", "Section A - Q1").
2. For each question:
   - "number": The verbatim printed label (e.g. "1", "2", "11 (a)", "11(b)", "12").
   - "text": The complete text of the question, instructions, and marks if part of the question body.
   - "parentNumber": The parent question number if this is a sub-question (e.g. "11" for "11(a)"), or omit if top-level.
   - "subPart": The sub-part identifier (e.g. "a", "b", "i", "ii") if applicable, or omit if top-level.
3. Do NOT include administrative headers/footers (like "College Name", "Exam Date", "Max Marks: 100", "Page 1 of 2") as question text.
4. If a question spans multiple sub-parts (e.g. 11(a) and 11(b)), return them as distinct items in the array.
5. Return ONLY a valid JSON array matching the requested schema.
`;

const QUESTION_RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      number: {
        type: Type.STRING,
        description: 'Verbatim printed question number/label (e.g. "1", "11(a)", "11 (b)")',
      },
      text: {
        type: Type.STRING,
        description: 'Complete question text body',
      },
      parentNumber: {
        type: Type.STRING,
        description: 'Parent question number (e.g. "11") if this is a sub-part, otherwise null/omitted',
        nullable: true,
      },
      subPart: {
        type: Type.STRING,
        description: 'Sub-part identifier (e.g. "a", "b", "i") if applicable, otherwise null/omitted',
        nullable: true,
      },
    },
    required: ['number', 'text'],
  },
};

const ANSWER_EXTRACTION_PROMPT = `
You are an expert document analysis vision AI specialized in handwritten exam answer sheets.
Analyze this single page image from a student's handwritten answer sheet.

Task:
Identify all distinct handwritten answer blocks visible on this page.

Instructions:
1. Inspect ONLY the current page image.
2. Identify distinct handwritten answer blocks. If multiple separate questions are answered on this single page, return a separate block for each question.
3. Detect explicit question references if visibly written by the student (e.g. "Q1", "Q2", "1", "2", "11(a)", "11(b)", "Ans 1", "Question 1").
   - If an explicit reference is written, record it verbatim in detectedQuestionReference.
   - If NO question reference is written (e.g., it is an unlabeled continuation from a previous page or unlabeled handwriting), set detectedQuestionReference to null.
   - NEVER invent or guess a question reference that is not visibly written on the page. Do NOT solve the question or match questions by semantic similarity.
4. Distinguish student answer content from header metadata (such as Student Name, Registration Number, Subject Code, Exam Title at the top) and printed question text. Do NOT include header metadata or printed question-paper text in answer bounding boxes.
5. Include handwritten explanations, algorithms, pseudocode, equations, formulas, calculations, derivations, and diagrams that belong to the answer.
6. Provide spatial bounding boxes for each block using [ymin, xmin, ymax, xmax] integers scaled 0 to 1000 (where 0,0 is the top-left corner and 1000,1000 is the bottom-right corner).
   - The bounding box must reasonably enclose the complete handwritten content of that answer block.
7. Provide a best-effort transcription of the handwritten text in the block in "text".
8. Provide a confidence score between 0.0 and 1.0 indicating your confidence in the detection and spatial boundary.
9. If this page is blank or contains NO handwritten answers, return an empty JSON array [].
10. Return ONLY a valid JSON array matching the requested schema.
`;

const ANSWER_RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      detectedQuestionReference: {
        type: Type.STRING,
        description: 'Verbatim question reference like "Q1", "1", "11(a)", "Ans 2" if visibly written, or null if absent/continuation',
        nullable: true,
      },
      box_2d: {
        type: Type.ARRAY,
        items: { type: Type.INTEGER },
        description: '[ymin, xmin, ymax, xmax] integer bounding box on a 0 to 1000 coordinate scale',
      },
      text: {
        type: Type.STRING,
        description: 'Best-effort transcription of handwritten text in this answer block',
      },
      confidence: {
        type: Type.NUMBER,
        description: 'Detection and boundary confidence score between 0.0 and 1.0',
      },
    },
    required: ['box_2d', 'text', 'confidence'],
  },
};

export class GeminiDocumentAIProvider implements DocumentAIProvider {
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(options?: { apiKey?: string; modelName?: string }) {
    this.apiKey = options?.apiKey || process.env.LLM_API_KEY || '';
    this.modelName = options?.modelName || process.env.LLM_MODEL_NAME || 'gemini-3.6-flash';
  }

  async extractQuestionsFromImages(pages: PageImageInput[]): Promise<RawQuestionExtraction[]> {
    if (!this.apiKey) {
      throw new Error('LLM_API_KEY is not configured for GeminiDocumentAIProvider');
    }

    if (!pages || pages.length === 0) {
      return [];
    }

    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    const parts: any[] = pages.map((p) => ({
      inlineData: {
        mimeType: p.mimeType,
        data: p.imageBuffer.toString('base64'),
      },
    }));

    parts.push({ text: QUESTION_EXTRACTION_PROMPT });

    let rawText = '';
    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const response = await ai.models.generateContent({
          model: this.modelName,
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: QUESTION_RESPONSE_SCHEMA,
            temperature: 0.1,
          },
        });

        rawText = response.text || '';
        const parsedJson = JSON.parse(rawText);
        const validation = RawQuestionExtractionArraySchema.safeParse(parsedJson);

        if (validation.success) {
          return validation.data.map((q) => ({
            number: q.number,
            text: q.text,
            parentNumber: q.parentNumber || undefined,
            subPart: q.subPart || undefined,
            alternativeText: q.alternativeText || undefined,
            alternativeType: q.alternativeType || undefined,
          }));
        }

        if (attempt >= maxAttempts) {
          throw new Error(
            `Gemini question extraction schema validation failed: ${validation.error.message}`
          );
        }
      } catch (err: any) {
        if (err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        if (attempt >= maxAttempts) {
          throw new Error(
            `Gemini question extraction failed on attempt ${attempt}: ${err?.message || String(err)}`
          );
        }
      }
    }

    throw new Error('Failed to extract questions from Gemini after multiple attempts');
  }

  async extractAnswersFromImages(pages: PageImageInput[]): Promise<RawAnswerBlock[]> {
    if (!this.apiKey) {
      throw new Error('LLM_API_KEY is not configured for GeminiDocumentAIProvider');
    }

    if (!pages || pages.length === 0) {
      return [];
    }

    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const allBlocks: RawAnswerBlock[] = [];

    // Process page-by-page to ensure clear per-page spatial grounding
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const parts = [
        {
          inlineData: {
            mimeType: page.mimeType,
            data: page.imageBuffer.toString('base64'),
          },
        },
        { text: ANSWER_EXTRACTION_PROMPT },
      ];

      let rawText = '';
      let attempt = 0;
      const maxAttempts = 3;
      let pageBlocks: RawAnswerBlock[] = [];

      while (attempt < maxAttempts) {
        attempt++;
        try {
          const response = await ai.models.generateContent({
            model: this.modelName,
            contents: [
              {
                role: 'user',
                parts,
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: ANSWER_RESPONSE_SCHEMA,
              temperature: 0.1,
            },
          });

          rawText = response.text || '';
          const parsedJson = JSON.parse(rawText);

          // Add page number to each block before schema validation
          const enriched = Array.isArray(parsedJson)
            ? parsedJson.map((item) => ({
                page: page.pageNumber,
                detectedQuestionReference: item.detectedQuestionReference ?? null,
                text: item.text ?? '',
                transcription: item.text ?? '',
                confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
                box_2d: item.box_2d,
              }))
            : [];

          const validation = RawAnswerBlockArraySchema.safeParse(enriched);

          if (validation.success) {
            pageBlocks = validation.data.map((b) => ({
              page: b.page,
              detectedQuestionReference: b.detectedQuestionReference || null,
              text: b.text || b.transcription || '',
              transcription: b.transcription || b.text || '',
              confidence: b.confidence ?? 0.8,
              box_2d: b.box_2d as [number, number, number, number] | undefined,
              regions: b.regions,
            }));
            break;
          }

          if (attempt >= maxAttempts) {
            throw new Error(
              `Gemini answer extraction schema validation failed for page ${page.pageNumber}: ${validation.error.message}`
            );
          }
        } catch (err: any) {
          if (err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
            const match = err?.message?.match(/retry in ([0-9.]+)s/i);
            const waitSec = match ? Math.ceil(parseFloat(match[1])) + 2 : 15;
            await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
          }
          if (attempt >= maxAttempts) {
            throw new Error(
              `Gemini answer extraction failed for page ${page.pageNumber} on attempt ${attempt}: ${
                err?.message || String(err)
              }`
            );
          }
        }
      }

      allBlocks.push(...pageBlocks);
      if (i < pages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return allBlocks;
  }
}
