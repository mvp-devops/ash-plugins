/**
 * Smoke-тест сквозного SDD-цикла на mock-контексте Harness:
 * init → спецификация → план → задачи → трассируемость → реализация с
 * evidence → валидация с fake-subprocess → status complete → export.
 * Дополнительно проверяет валидность всех обязательных JSON-файлов и
 * соответствие JSON Schema-структурам (собственные структурные разборы).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { apply } from '../../dist/index.js';
import { parseSpec } from '../../dist/core/spec-model.js';
import { parsePlan } from '../../dist/core/plan-generator.js';
import { parseTaskBoard } from '../../dist/core/task-generator.js';
import { parseValidationReport } from '../../dist/core/validation.js';
import { makeHarness, makeWorkspace, runCommand, makeFakeSubprocess } from '../helpers.js';

async function readJson(workspace, file) {
  return JSON.parse(await fsp.readFile(path.join(workspace, '.sdd', file), 'utf8'));
}

test('E2E: полный цикл SDD от init до export с валидными JSON-артефактами', async () => {
  const workspace = await makeWorkspace({ scripts: { test: 'node --test tests/', lint: 'eslint .' } });
  const subprocess = makeFakeSubprocess({ test: 0, lint: 0 });
  const { ctx, registered } = makeHarness({ workspace, subprocess });
  apply(ctx);

  // 1. Инициализация + интервью.
  const init = await runCommand(registered, 'sdd-init', {
    answers: {
      id: 'FEAT-001',
      title: 'Сводка статуса проекта',
      owner: 'anna',
      goal: 'Дать пользователю сводку статуса SDD-цикла',
      scope: 'Команда sdd-status и панель',
    },
  });
  assert.equal(init.payload.created, true);
  assert.deepEqual(init.payload.answers_rejected, []);

  // 2. Спецификация: требования, критерии, edge cases, DoD → approved.
  const spec = await runCommand(registered, 'sdd-spec', {
    op: 'set',
    patch: {
      user_stories: [{ id: 'US-001', as_a: 'разработчик', i_want: 'видеть статус SDD', so_that: 'понимать следующий шаг', priority: 'must' }],
      functional_requirements: [
        { id: 'FR-001', title: 'Сводка статуса', description: 'Команда sdd-status выводит стадию, счётчики и следующее действие', priority: 'must' },
      ],
      non_functional_requirements: [],
      acceptance_criteria: [
        { id: 'AC-001', requirement_id: 'FR-001', statement: 'sdd-status возвращает stage и recommended_next_action', verification: 'test' },
      ],
      edge_cases: [{ id: 'EC-001', description: 'SDD workspace не инициализирован', expected_behavior: 'stage not_initialized и подсказка sdd-init', requirement_ids: ['FR-001'] }],
      constraints: [{ id: 'C-001', description: 'Без сетевых запросов: только локальные файлы' }],
      definition_of_done: ['Все критерии покрыты тестами', 'Валидация overall=passed'],
    },
  });
  assert.equal(spec.kind, 'success');
  assert.equal(spec.payload.summary.blockers, 0, `blockers: ${JSON.stringify(spec.payload.issues)}`);

  const approved = await runCommand(registered, 'sdd-spec', { op: 'set', patch: { status: 'approved' } });
  assert.equal(approved.kind, 'success');

  // 3. План (с анализом кодовой базы).
  const plan = await runCommand(registered, 'sdd-plan', {
    op: 'generate',
    plan: {
      codebase_analysis: 'TypeScript ESM, node:test, ESLint; артефакты в .sdd/.',
      modules: [{ path: 'src/commands', description: 'Команды SDD', requirement_ids: ['FR-001'] }],
      extra_items: [{ title: 'Тесты smoke-цикла', files: ['tests/integration/smoke.test.js'] }],
    },
  });
  assert.equal(plan.kind, 'success');
  assert.ok(plan.payload.items >= 2);
  const planArtifact = parsePlan(await readJson(workspace, 'plan.json'), '.sdd/plan.json');
  assert.ok(planArtifact.items.every((item) => item.requirement_ids.length > 0 || item.title.includes('Тесты')), 'пункты плана трассируемы к требованиям');

  // 4. Задачи.
  const tasks = await runCommand(registered, 'sdd-tasks', { op: 'generate' });
  assert.equal(tasks.kind, 'success');
  const board = parseTaskBoard(await readJson(workspace, 'tasks.json'), '.sdd/tasks.json');
  assert.ok(board.tasks.length >= 2);
  const mainTask = board.tasks[0];
  assert.deepEqual(mainTask.acceptance_criteria, ['AC-001']);

  // 5. Трассируемость: до реализации критерий не покрыт.
  const before = await runCommand(registered, 'sdd-status', {});
  assert.equal(before.payload.traceability.covered, 0);

  // 6. Реализация: очередь → evidence → done.
  const queue = await runCommand(registered, 'sdd-implement', { op: 'queue' });
  assert.equal(queue.kind, 'success');
  assert.ok(queue.payload.queue.length >= 1);
  assert.ok(queue.payload.rules.some((rule) => rule.includes('тесты')), 'правила требуют тестов');

  const taskDone = board.tasks.find((task) => task.acceptance_criteria.includes('AC-001')).task_id;
  const recorded = await runCommand(registered, 'sdd-implement', {
    op: 'record',
    task_id: taskDone,
    tests_to_add_or_update: ['tests/unit/status.test.js'],
    evidence: { kind: 'test', reference: 'tests/unit/status.test.js', passed: true, detail: '5 passed' },
    status: 'done',
  });
  assert.equal(recorded.kind, 'success');
  assert.equal(recorded.payload.task.status, 'done');

  // Пометить остальные задачи done с evidence (фиктивные тесты smoke-фикстуры).
  for (const task of board.tasks.filter((item) => item.task_id !== taskDone)) {
    await runCommand(registered, 'sdd-tasks', {
      op: 'update',
      task_id: task.task_id,
      status: 'done',
      evidence: { kind: 'test', reference: 'tests/integration/smoke.test.js', passed: true, detail: 'smoke' },
    });
  }

  // 7. Полная валидация (fake-subprocess: тесты и lint зелёные).
  const validation = await runCommand(registered, 'sdd-validate', {});
  assert.equal(validation.kind, 'success');
  assert.equal(validation.payload.overall, 'passed', `checks: ${JSON.stringify(validation.payload.checks)}`);
  assert.equal(validation.payload.feature_complete, true);

  const report = parseValidationReport(await readJson(workspace, 'validation-report.json'), '.sdd/validation-report.json');
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.overall, 'passed');
  assert.ok(report.checks.some((check) => check.kind === 'unit' && check.status === 'passed'));
  assert.ok(report.checks.some((check) => check.kind === 'criterion' && check.status === 'passed'));

  // 8. Финальная трассируемость: все критерии покрыты.
  const finalStatus = await runCommand(registered, 'sdd-status', {});
  assert.equal(finalStatus.payload.stage, 'complete', `stage: ${finalStatus.payload.stage}, action: ${finalStatus.payload.recommended_next_action}`);
  assert.equal(finalStatus.payload.traceability.uncovered, 0);

  // 9. Экспорт пакета.
  const exported = await runCommand(registered, 'sdd-export', {});
  assert.equal(exported.kind, 'success');
  assert.ok(exported.payload.files.length >= 7);
  const exportDir = path.join(workspace, '.sdd', 'export');
  const stamps = await fsp.readdir(exportDir);
  assert.equal(stamps.length, 1);
  const exportedFiles = await fsp.readdir(path.join(exportDir, stamps[0]));
  for (const file of ['spec.md', 'spec.json', 'plan.md', 'tasks.json', 'traceability.json', 'validation-report.md', 'changelog.md']) {
    assert.ok(exportedFiles.includes(file), `в экспорте нет ${file}`);
  }

  // 10. Все обязательные JSON-артефакты валидны (структурные разборы плагина).
  const specArtifact = parseSpec(await readJson(workspace, 'spec.json'), '.sdd/spec.json');
  assert.equal(specArtifact.status, 'approved');
  const traceability = await readJson(workspace, 'traceability.json');
  assert.equal(traceability.schemaVersion, 1);
  assert.equal(traceability.summary.total, 1);
  assert.equal(traceability.rows[0].status, 'covered');
});

test('E2E: blocker в спецификации блокирует план, done без evidence запрещён', async () => {
  const workspace = await makeWorkspace();
  const { ctx, registered } = makeHarness({ workspace });
  apply(ctx);
  await runCommand(registered, 'sdd-init', {});

  // Спецификация остаётся черновиком с незакрытыми вопросами — план отказывает.
  const planAttempt = await runCommand(registered, 'sdd-plan', { op: 'generate', plan: { codebase_analysis: 'анализ' } });
  assert.equal(planAttempt.kind, 'error');
  assert.equal(planAttempt.payload.code, 'SDD_BLOCKERS_PRESENT');

  // Заполняем спецификацию (включая критические поля init-черновика),
  // закрываем открытые вопросы init и не утверждаем — план требует approved.
  await runCommand(registered, 'sdd-spec', {
    op: 'set',
    patch: {
      id: 'FEAT-002',
      title: 'Вторая фича',
      owner: 'anna',
      goal: 'Цель',
      scope: 'Объём',
      status: 'review',
      user_stories: [],
      functional_requirements: [{ id: 'FR-001', title: 'Требование', description: 'Описание', priority: 'must' }],
      non_functional_requirements: [],
      acceptance_criteria: [{ id: 'AC-001', requirement_id: 'FR-001', statement: 'Условие', verification: 'test' }],
      edge_cases: [],
      constraints: [],
      definition_of_done: ['Готово'],
      open_questions: [],
    },
  });
  const planDraft = await runCommand(registered, 'sdd-plan', { op: 'generate', plan: { codebase_analysis: 'анализ' } });
  assert.equal(planDraft.kind, 'error');
  assert.match(planDraft.payload.error, /approved/);

  await runCommand(registered, 'sdd-spec', { op: 'set', patch: { status: 'approved' } });
  const planOk = await runCommand(registered, 'sdd-plan', { op: 'generate', plan: { codebase_analysis: 'анализ' } });
  assert.equal(planOk.kind, 'success');

  await runCommand(registered, 'sdd-tasks', { op: 'generate' });
  const doneAttempt = await runCommand(registered, 'sdd-tasks', { op: 'update', task_id: 'T-001', status: 'done' });
  assert.equal(doneAttempt.kind, 'error');
  assert.equal(doneAttempt.payload.code, 'SDD_EVIDENCE_REQUIRED');
});
