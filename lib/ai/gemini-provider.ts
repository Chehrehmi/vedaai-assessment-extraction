import { GoogleGenAI, Type } from '@google/genai';
import { DocumentAIProvider, PageImageInput, RawQuestionExtraction } from './types';
import { RawQuestionExtractionArraySchema } from './schemas';

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

const GEMINI_RESPONSE_SCHEMA = {
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

export class GeminiDocumentAIProvider implements DocumentAIProvider {
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(options?: { apiKey?: string; modelName?: string }) {
    this.apiKey = options?.apiKey || process.env.LLM_API_KEY || '';
    this.modelName = options?.modelName || process.env.LLM_MODEL_NAME || 'gemini-2.5-flash';
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
    const maxAttempts = 2;

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
            responseSchema: GEMINI_RESPONSE_SCHEMA,
            temperature: 0.1,
          },
        });

        rawText = response.text || '';
        const parsedJson = JSON.parse(rawText);
        const validation = RawQuestionExtractionArraySchema.safeParse(parsedJson);

        if (validation.success) {
          // Clean nulls to undefined for optional fields
          return validation.data.map((q) => ({
            number: q.number,
            text: q.text,
            parentNumber: q.parentNumber || undefined,
            subPart: q.subPart || undefined,
          }));
        }

        if (attempt >= maxAttempts) {
          throw new Error(
            `Gemini question extraction schema validation failed: ${validation.error.message}`
          );
        }
      } catch (err: any) {
        if (attempt >= maxAttempts) {
          throw new Error(
            `Gemini question extraction failed on attempt ${attempt}: ${err?.message || String(err)}`
          );
        }
      }
    }

    throw new Error('Failed to extract questions from Gemini after multiple attempts');
  }
}
