/**
 * Unit-тесты валидатора спецификации: критические поля, дубликаты ID,
 * требования без критериев, непроверяемые критерии, битые ссылки,
 * незакрытые вопросы, конфликты, сортировка по severity.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSpec, emptySpec, TBD } from '../../dist/core/spec-model.js';
import { validateSpec, summarizeIssues, hasBlockers, sortIssues } from '../../dist/core/spec-validator.js';

function buildSpec(overrides = {}) {
  const base = {
    schemaVersion: 1,
    id: 'FEAT-001',
    title: 'Фича',
    version: '1.0.0',
    status: 'approved',
    owner: 'team',
    goal: 'Цель фичи',
    scope: 'Объём работ',
    out_of_scope: [],
    user_stories: [],
    functional_requirements: [{ id: 'FR-001', title: 'Требование', description: 'Описание требования', priority: 'must' }],
    non_functional_requirements: [],
    acceptance_criteria: [{ id: 'AC-001', requirement_id: 'FR-001', statement: 'Проверяемое условие: выполняется', verification: 'test' }],
    data_contracts: [],
    api_contracts: [],
    edge_cases: [],
    constraints: [],
    risks: [],
    definition_of_done: ['Готово'],
    open_questions: [],
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  return parseSpec({ ...base, ...overrides }, '.sdd/spec.json');
}

test('корректная спецификация не даёт blocker-находок', () => {
  const issues = validateSpec(buildSpec());
  const summary = summarizeIssues(issues);
  assert.equal(summary.blockers, 0);
  assert.equal(hasBlockers(issues), false);
});

test('пустые критические поля (TBD) — blocker', () => {
  const spec = emptySpec('2026-01-01T00:00:00.000Z');
  const issues = validateSpec(spec);
  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  assert.ok(blockers.length >= 4, `ожидались blockers для id/title/goal/scope, получено: ${blockers.length}`);
  for (const field of ['id', 'title', 'goal', 'scope']) {
    assert.ok(blockers.some((issue) => issue.field === field), `нет blocker для ${field}`);
  }
  assert.ok(blockers.every((issue) => issue.file === '.sdd/spec.json' && issue.fix.length > 0));
});

test('дубликат идентификатора — blocker', () => {
  const spec = buildSpec({
    non_functional_requirements: [{ id: 'FR-001', title: 'Дубль', description: '', priority: 'should' }],
  });
  const issues = validateSpec(spec);
  const duplicates = issues.filter((issue) => issue.code === 'spec.duplicate-id');
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].severity, 'blocker');
});

test('требование без acceptance criteria — major с подсказкой', () => {
  const spec = buildSpec({
    acceptance_criteria: [],
  });
  const issues = validateSpec(spec);
  const orphan = issues.find((issue) => issue.code === 'spec.requirement-without-criteria');
  assert.ok(orphan);
  assert.equal(orphan.severity, 'major');
  assert.match(orphan.fix, /FR-001/);
});

test('критерий с непроверяемой формулировкой — major; ручная проверка — info', () => {
  const spec = buildSpec({
    acceptance_criteria: [
      { id: 'AC-001', requirement_id: 'FR-001', statement: 'Всё работает удобно', verification: 'test' },
      { id: 'AC-002', requirement_id: 'FR-001', statement: 'Инспектор видит отчёт в интерфейсе', verification: 'manual' },
    ],
  });
  const issues = validateSpec(spec);
  assert.ok(issues.some((issue) => issue.code === 'spec.criterion-not-verifiable' && issue.field.includes('AC-001')));
  assert.ok(issues.some((issue) => issue.code === 'spec.criterion-manual' && issue.severity === 'info'));
});

test('битые ссылки критериев, контрактов и edge cases — major', () => {
  const spec = buildSpec({
    acceptance_criteria: [{ id: 'AC-001', requirement_id: 'FR-999', statement: 'условие', verification: 'test' }],
    api_contracts: [{ id: 'API-001', name: 'API', description: 'd', requirement_ids: ['FR-404'] }],
    edge_cases: [{ id: 'EC-001', description: 'd', expected_behavior: 'b', requirement_ids: ['FR-404'] }],
  });
  const issues = validateSpec(spec);
  for (const code of ['spec.criterion-unknown-requirement', 'spec.contract-unknown-requirement', 'spec.edge-case-unknown-requirement']) {
    assert.ok(issues.some((issue) => issue.code === code), `нет находки ${code}`);
  }
});

test('edge case без ожидаемого поведения — major', () => {
  const spec = buildSpec({
    edge_cases: [{ id: 'EC-001', description: 'сломанный ввод', expected_behavior: '', requirement_ids: ['FR-001'] }],
  });
  const issues = validateSpec(spec);
  assert.ok(issues.some((issue) => issue.code === 'spec.edge-case-no-expected'));
});

test('конфликт ограничения и требования (запрещено/добавить) — major', () => {
  const spec = buildSpec({
    constraints: [{ id: 'C-001', description: 'Запрещено добавлять новые зависимости в проект' }],
    functional_requirements: [
      { id: 'FR-001', title: 'Требование', description: 'Добавить зависимости для проверки', priority: 'must' },
    ],
  });
  const issues = validateSpec(spec);
  const conflicts = issues.filter((issue) => issue.code === 'spec.requirement-constraint-conflict');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, 'major');
  assert.match(conflicts[0].message, /FR-001/);
});

test('незакрытые блокирующие вопросы — blocker, неблокирующие — major', () => {
  const spec = buildSpec({
    open_questions: [
      { id: 'Q-1', question: 'Какая версия API?', blocking: true, status: 'open' },
      { id: 'Q-2', question: 'Какой цвет кнопки?', blocking: false, status: 'open' },
      { id: 'Q-3', question: 'Отвеченный без текста', blocking: false, status: 'answered' },
    ],
  });
  const issues = validateSpec(spec);
  const q1 = issues.find((issue) => issue.code === 'spec.open-question' && issue.field.includes('Q-1'));
  const q2 = issues.find((issue) => issue.code === 'spec.open-question' && issue.field.includes('Q-2'));
  assert.equal(q1.severity, 'blocker');
  assert.equal(q2.severity, 'major');
  assert.ok(issues.some((issue) => issue.code === 'spec.question-answered-without-answer' && issue.field.includes('Q-3')));
});

test('неоднозначные формулировки и пересечение scope/out_of_scope — minor', () => {
  const spec = buildSpec({
    functional_requirements: [{ id: 'FR-001', title: 'Требование', description: 'Должно работать быстро и т. д.', priority: 'must' }],
    out_of_scope: ['Объём работ не включает телеметрию'],
  });
  const issues = validateSpec(spec);
  assert.ok(issues.some((issue) => issue.code === 'spec.ambiguous-wording' && issue.severity === 'minor'));
  assert.ok(issues.some((issue) => issue.code === 'spec.scope-overlap' && issue.severity === 'minor'));
});

test('сортировка стабильна: blocker перед major перед minor перед info', () => {
  const ordered = sortIssues([
    { code: 'a', severity: 'info', message: '', file: 'f', field: 'x', fix: '' },
    { code: 'b', severity: 'blocker', message: '', file: 'f', field: 'x', fix: '' },
    { code: 'c', severity: 'major', message: '', file: 'f', field: 'x', fix: '' },
    { code: 'd', severity: 'minor', message: '', file: 'f', field: 'x', fix: '' },
  ]);
  assert.deepEqual(ordered.map((issue) => issue.severity), ['blocker', 'major', 'minor', 'info']);
});

test('hasBlockers и summarizeIssues согласованы', () => {
  const spec = emptySpec('2026-01-01T00:00:00.000Z');
  spec.open_questions = [{ id: TBD + '-q', question: '?', blocking: false, status: 'open' }];
  const issues = validateSpec(spec);
  const summary = summarizeIssues(issues);
  assert.equal(summary.ok, !hasBlockers(issues));
  assert.equal(summary.blockers + summary.majors + summary.minors + summary.infos, issues.length);
});
