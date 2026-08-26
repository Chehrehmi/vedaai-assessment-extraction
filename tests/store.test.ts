import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AssessmentStore, assessmentStore } from '../lib/store/index.js';

const mockDocQP = {
  id: 'doc-qp-1',
  filename: 'question_paper.pdf',
  mimeType: 'application/pdf',
  pageCount: 2,
};

const mockDocAS = {
  id: 'doc-as-1',
  filename: 'answer_sheet.pdf',
  mimeType: 'application/pdf',
  pageCount: 6,
};

beforeEach(() => {
  assessmentStore.clear();
});

test('16. create stores and returns an assessment', () => {
  const store = new AssessmentStore();
  const created = store.create({
    questionPaper: mockDocQP,
    answerSheet: mockDocAS,
  });

  assert.ok(created.id);
  assert.equal(created.status, 'queued');
  assert.equal(created.questionPaper.filename, 'question_paper.pdf');
  assert.equal(created.questions.length, 0);
  assert.equal(store.count(), 1);
});

test('17. get retrieves the same assessment', () => {
  const store = new AssessmentStore();
  const created = store.create({
    id: 'test-assessment-123',
    questionPaper: mockDocQP,
    answerSheet: mockDocAS,
  });

  const retrieved = store.get('test-assessment-123');
  assert.ok(retrieved);
  assert.equal(retrieved.id, 'test-assessment-123');
  assert.equal(retrieved.questionPaper.id, 'doc-qp-1');
});

test('18. get unknown ID returns undefined', () => {
  const store = new AssessmentStore();
  const result = store.get('non-existent-id');
  assert.equal(result, undefined);
});

test('19. update changes only intended fields and preserves others', () => {
  const store = new AssessmentStore();
  const created = store.create({
    id: 'test-assessment-456',
    questionPaper: mockDocQP,
    answerSheet: mockDocAS,
    questions: [
      { id: 'q-1', number: '1', text: 'Define Big-O', order: 1 }
    ],
  });

  const updated = store.update('test-assessment-456', {
    status: 'extracting_questions',
  });

  assert.equal(updated.status, 'extracting_questions');
  assert.equal(updated.id, 'test-assessment-456');
  assert.equal(updated.questions.length, 1);
  assert.equal(updated.questionPaper.filename, 'question_paper.pdf');
});

test('20. update unknown ID throws an error and does not silently create record', () => {
  const store = new AssessmentStore();
  assert.throws(() => {
    store.update('unknown-id', { status: 'completed' });
  }, /Assessment not found/);

  assert.equal(store.count(), 0);
});

test('21. store clear works for test isolation', () => {
  const store = new AssessmentStore();
  store.create({ questionPaper: mockDocQP, answerSheet: mockDocAS });
  store.create({ questionPaper: mockDocQP, answerSheet: mockDocAS });
  assert.equal(store.count(), 2);

  store.clear();
  assert.equal(store.count(), 0);
});

test('22. delete removes record and returns true/false', () => {
  const store = new AssessmentStore();
  const created = store.create({ id: 'to-delete', questionPaper: mockDocQP, answerSheet: mockDocAS });
  assert.equal(store.count(), 1);

  const deleted = store.delete('to-delete');
  assert.equal(deleted, true);
  assert.equal(store.count(), 0);

  const deletedAgain = store.delete('to-delete');
  assert.equal(deletedAgain, false);
});
