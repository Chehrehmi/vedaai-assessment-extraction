import { randomUUID } from 'crypto';
import { Assessment, ProcessingStage } from '../domain/types.js';
import { AssessmentSchema } from '../validation/schemas.js';

export interface CreateAssessmentParams {
  id?: string;
  status?: ProcessingStage;
  questionPaper: Assessment['questionPaper'];
  answerSheet: Assessment['answerSheet'];
  questions?: Assessment['questions'];
  answers?: Assessment['answers'];
  mappings?: Assessment['mappings'];
  createdAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export type UpdateAssessmentPatch = Partial<Omit<Assessment, 'id' | 'createdAt'>>;

/**
 * In-memory assessment store (process-lifetime Map singleton).
 */
export class AssessmentStore {
  private readonly store = new Map<string, Assessment>();

  /**
   * Creates and stores a new Assessment record.
   * Enforces full schema validation before storage.
   */
  create(params: CreateAssessmentParams): Assessment {
    const id = params.id || randomUUID();
    const createdAt = params.createdAt || new Date().toISOString();

    const record: Assessment = {
      id,
      status: params.status || 'queued',
      questionPaper: params.questionPaper,
      answerSheet: params.answerSheet,
      questions: params.questions || [],
      answers: params.answers || [],
      mappings: params.mappings || [],
      createdAt,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    };

    // Strict validation before storing
    const validated = AssessmentSchema.parse(record);
    this.store.set(id, validated);
    return validated;
  }

  /**
   * Retrieves an assessment by ID.
   * Returns undefined if no assessment exists for the given ID.
   */
  get(id: string): Assessment | undefined {
    return this.store.get(id);
  }

  /**
   * Updates an existing assessment with patch fields.
   * Throws an Error if the assessment ID is not found.
   * Preserves id, createdAt, and all unpatched fields.
   */
  update(id: string, patch: UpdateAssessmentPatch): Assessment {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Assessment not found: cannot update non-existent assessment with id "${id}"`);
    }

    const updated: Assessment = {
      ...existing,
      ...patch,
      id: existing.id, // Immutable
      createdAt: existing.createdAt, // Immutable
    };

    // Strict validation on updated record
    const validated = AssessmentSchema.parse(updated);
    this.store.set(id, validated);
    return validated;
  }

  /**
   * Deletes an assessment by ID.
   * Returns true if the record was deleted, false if it did not exist.
   */
  delete(id: string): boolean {
    return this.store.delete(id);
  }

  /**
   * Clears all stored assessments. Used for test isolation.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Returns the count of assessments in the store.
   */
  count(): number {
    return this.store.size;
  }

  /**
   * Returns all stored assessments as an array.
   */
  getAll(): Assessment[] {
    return Array.from(this.store.values());
  }
}

/**
 * Singleton process-lifetime store instance.
 */
export const assessmentStore = new AssessmentStore();
