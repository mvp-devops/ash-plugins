/**
 * Unit-тесты модели спецификации: структурный разбор spec.json, ошибки
 * с указанием файла/поля, пустая спецификация, ответы интервью.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSpec, emptySpec, SPEC_SCHEMA_VERSION, TBD, INTERVIEW_QUESTIONS } from '../../dist/core/spec-model.js';
import { ArtifactValidationError } from '../../dist/core/errors.js';

const FILE = '.sdd/spec.json';

function validSpecRaw() {
  return {
    schemaVersion: 1,
    id: 'FEAT-001',
    title: 'Проверка спецификации',
    version: '1.0.0',
    status: 'approved',
    owner: 'team',
    goal: 'Цель',
    scope: 'Объём',
    out_of_scope: [],
    user_stories: [{ id: 'US-001', as_a: 'разработчик', i_want: 'валидатор', so_that: 'качество', priority: 'must' }],
    functional_requirements: [{ id: 'FR-001', title: 'Валидация', description: 'Проверять поля', priority: 'must' }],
    non_functional_requirements: [],
    acceptance_criteria: [{ id: 'AC-001', requirement_id: 'FR-001', statement: 'Валидатор находит пустые поля', verification: 'test' }],
    data_contracts: [],
    api_contracts: [],
    edge_cases: [{ id: 'EC-001', description: 'Пустой JSON', expected_behavior: 'ошибка с полем', requirement_ids: ['FR-001'] }],
    constraints: [{ id: 'C-001', description: 'Без внешних зависимостей' }],
    risks: [{ id: 'R-001', description: 'Ложные срабатывания', mitigation: 'настройка эвристик' }],
    definition_of_done: ['Все критерии покрыты тестами'],
    open_questions: [],
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

test('parseSpec разбирает корректную спецификацию в типизированную модель', () => {
  const spec = parseSpec(validSpecRaw(), FILE);
  assert.equal(spec.schemaVersion, SPEC_SCHEMA_VERSION);
  assert.equal(spec.id, 'FEAT-001');
  assert.equal(spec.status, 'approved');
  assert.equal(spec.functional_requirements[0].id, 'FR-001');
  assert.equal(spec.acceptance_criteria[0].verification, 'test');
  assert.equal(spec.open_questions.length, 0);
});

test('parseSpec отклоняет не-объект, неверную schemaVersion и битые поля с указанием файла и поля', () => {
  assert.throws(() => parseSpec('not an object', FILE), (error) => {
    assert.ok(error instanceof ArtifactValidationError);
    assert.equal(error.file, FILE);
    return true;
  });
  assert.throws(() => parseSpec({ ...validSpecRaw(), schemaVersion: 99 }, FILE), (error) => {
    assert.ok(error instanceof ArtifactValidationError);
    assert.match(error.message, /schemaVersion/);
    return true;
  });
  assert.throws(() => parseSpec({ ...validSpecRaw(), goal: 42 }, FILE), (error) => {
    assert.ok(error instanceof ArtifactValidationError);
    assert.equal(error.field, 'goal');
    assert.match(error.message, /goal/);
    return true;
  });
  assert.throws(() => parseSpec({ ...validSpecRaw(), acceptance_criteria: [{ id: 'AC-001', requirement_id: 'FR-001', statement: 'x', verification: 'telepathy' }] }, FILE), (error) => {
    assert.ok(error instanceof ArtifactValidationError);
    assert.equal(error.field, 'acceptance_criteria[0].verification');
    return true;
  });
  assert.throws(() => parseSpec({ ...validSpecRaw(), user_stories: [{ id: 'US-001', as_a: 'a', i_want: 'b', so_that: 'c', priority: 'urgent' }] }, FILE), (error) => {
    assert.ok(error instanceof ArtifactValidationError);
    assert.equal(error.field, 'user_stories[0].priority');
    return true;
  });
});

test('emptySpec создаёт черновик с TBD в критических полях и пустыми коллекциями', () => {
  const spec = emptySpec('2026-01-01T00:00:00.000Z');
  assert.equal(spec.status, 'draft');
  assert.equal(spec.id, TBD);
  assert.equal(spec.title, TBD);
  assert.equal(spec.goal, TBD);
  assert.deepEqual(spec.functional_requirements, []);
  assert.deepEqual(spec.open_questions, []);
});

test('INTERVIEW_QUESTIONS покрывает критические поля и структуры SDD', () => {
  const fields = INTERVIEW_QUESTIONS.map((question) => question.field);
  for (const field of ['id', 'title', 'goal', 'scope', 'user_stories', 'acceptance_criteria', 'constraints', 'definition_of_done']) {
    assert.ok(fields.includes(field), `интервью должно спрашивать ${field}`);
  }
});
