/**
 * Unit-тесты задач: генерация из плана, наследование acceptance criteria,
 * запрет done без evidence, зависимости, топологический порядок готовых
 * задач, парсинг и разбор evidence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSpec } from '../../dist/core/spec-model.js';
import { generatePlan, resetItemCounter } from '../../dist/core/plan-generator.js';
import { generateTasks, parseTaskBoard, updateTaskStatus, readyTasks, resetTaskCounter, TASKS_SCHEMA_VERSION } from '../../dist/core/task-generator.js';
import { SddError } from '../../dist/core/errors.js';
import { parseEvidence } from '../../dist/commands/tasks.js';

const NOW = '2026-01-01T00:00:00.000Z';

function buildFixture() {
  const spec = parseSpec(
    {
      schemaVersion: 1,
      id: 'FEAT-001',
      title: 'Фича',
      version: '1.0.0',
      status: 'approved',
      owner: 'team',
      goal: 'Цель',
      scope: 'Объём',
      out_of_scope: [],
      user_stories: [],
      functional_requirements: [
        { id: 'FR-001', title: 'Первое', description: 'Описание', priority: 'must' },
        { id: 'FR-002', title: 'Второе', description: 'Описание', priority: 'must' },
      ],
      non_functional_requirements: [],
      acceptance_criteria: [
        { id: 'AC-001', requirement_id: 'FR-001', statement: 'Условие 1', verification: 'test' },
        { id: 'AC-002', requirement_id: 'FR-002', statement: 'Условие 2', verification: 'build' },
      ],
      data_contracts: [],
      api_contracts: [],
      edge_cases: [],
      constraints: [],
      risks: [],
      definition_of_done: [],
      open_questions: [],
      updated_at: NOW,
    },
    '.sdd/spec.json',
  );
  resetItemCounter(0);
  const plan = generatePlan(spec, { codebase_analysis: 'Анализ', now: NOW });
  resetTaskCounter(0);
  const board = generateTasks(spec, plan, NOW);
  return { spec, plan, board };
}

test('generateTasks создаёт задачу на пункт плана с трассировкой и критериями', () => {
  const { board } = buildFixture();
  assert.equal(board.schemaVersion, TASKS_SCHEMA_VERSION);
  assert.equal(board.tasks.length, 2);
  assert.deepEqual(board.tasks.map((task) => task.task_id), ['T-001', 'T-002']);
  const first = board.tasks[0];
  assert.deepEqual(first.requirement_ids, ['FR-001']);
  assert.deepEqual(first.plan_item_ids, ['P-001']);
  assert.deepEqual(first.acceptance_criteria, ['AC-001']);
  assert.equal(first.status, 'todo');
  assert.deepEqual(first.evidence, []);
});

test('updateTaskStatus запрещает done без evidence (SDD_EVIDENCE_REQUIRED)', () => {
  const { board } = buildFixture();
  assert.throws(() => updateTaskStatus(board, 'T-001', 'done', NOW), (error) => {
    assert.ok(error instanceof SddError);
    assert.equal(error.code, 'SDD_EVIDENCE_REQUIRED');
    assert.equal(error.file, '.sdd/tasks.json');
    return true;
  });
});

test('updateTaskStatus принимает done с пройденным evidence и записывает его', () => {
  const { board } = buildFixture();
  const { task } = updateTaskStatus(board, 'T-001', 'done', NOW, {
    evidence: { kind: 'test', reference: 'tests/unit/x.test.js', passed: true, recorded_at: NOW },
  });
  assert.equal(task.status, 'done');
  assert.equal(task.evidence.length, 1);
  assert.equal(task.evidence[0].reference, 'tests/unit/x.test.js');
});

test('updateTaskStatus не даёт завершить задачу с незавершённой зависимостью', () => {
  const { board } = buildFixture();
  board.tasks[1].dependencies = ['T-001'];
  assert.throws(() => updateTaskStatus(board, 'T-002', 'done', NOW, { evidence: { kind: 'test', reference: 't', passed: true, recorded_at: NOW } }), (error) => {
    assert.equal(error.code, 'SDD_BLOCKERS_PRESENT');
    return true;
  });
  // Сначала завершаем зависимость — тогда T-002 завершается.
  updateTaskStatus(board, 'T-001', 'done', NOW, { evidence: { kind: 'test', reference: 't', passed: true, recorded_at: NOW } });
  const { task } = updateTaskStatus(board, 'T-002', 'done', NOW, { evidence: { kind: 'test', reference: 't2', passed: true, recorded_at: NOW } });
  assert.equal(task.status, 'done');
});

test('updateTaskStatus по несуществующей задаче — ошибка со списком доступных', () => {
  const { board } = buildFixture();
  assert.throws(() => updateTaskStatus(board, 'T-999', 'in_progress', NOW), (error) => {
    assert.equal(error.code, 'SDD_UNKNOWN_REFERENCE');
    assert.match(error.hint ?? '', /T-001/);
    return true;
  });
});

test('readyTasks возвращает топологический порядок и блокировки', () => {
  const { board } = buildFixture();
  board.tasks[0].dependencies = ['T-002'];
  const { ready, blocked } = readyTasks(board);
  assert.deepEqual(ready.map((task) => task.task_id), ['T-002']);
  assert.deepEqual(blocked.map(({ task }) => task.task_id), ['T-001']);
  assert.match(blocked[0].reason, /T-002/);
});

test('readyTasks обнаруживает циклические зависимости', () => {
  const { board } = buildFixture();
  board.tasks[0].dependencies = ['T-002'];
  board.tasks[1].dependencies = ['T-001'];
  const { blocked } = readyTasks(board);
  const cyclic = blocked.filter(({ task }) => task.task_id === 'T-001' || task.task_id === 'T-002');
  assert.equal(cyclic.length, 2);
  assert.match(cyclic[0].reason, /циклическая/);
});

test('parseTaskBoard восстанавливает доску и нормализует неизвестные статусы', () => {
  const { board } = buildFixture();
  const restored = parseTaskBoard(JSON.parse(JSON.stringify(board)), '.sdd/tasks.json');
  assert.equal(restored.tasks.length, board.tasks.length);
  const weird = parseTaskBoard({ schemaVersion: 1, tasks: [{ task_id: 'T-001', status: 'weird', evidence: [{ garbage: true }] }] }, '.sdd/tasks.json');
  assert.equal(weird.tasks[0].status, 'todo');
  assert.deepEqual(weird.tasks[0].evidence, []);
  assert.throws(() => parseTaskBoard({ schemaVersion: 3 }, '.sdd/tasks.json'), (error) => error instanceof Error && /schemaVersion/.test(error.message));
});

test('parseEvidence валидирует kind, reference и возвращает нормализованный объект', () => {
  const evidence = parseEvidence({ kind: 'lint', reference: 'pnpm lint', passed: true, detail: '0 ошибок' }, NOW);
  assert.equal(evidence.kind, 'lint');
  assert.equal(evidence.recorded_at, NOW);
  assert.equal(evidence.detail, '0 ошибок');
  assert.equal(parseEvidence(undefined, NOW), undefined);
  assert.throws(() => parseEvidence({ kind: 'vibes', reference: 'x', passed: true }, NOW), /evidence\.kind/);
  assert.throws(() => parseEvidence({ kind: 'test', reference: '  ', passed: true }, NOW), /evidence\.reference/);
  assert.throws(() => parseEvidence('string', NOW), /evidence должен быть объектом/);
});
