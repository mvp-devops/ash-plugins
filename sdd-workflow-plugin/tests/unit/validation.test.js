/**
 * Unit-тесты трассируемости и отчёта валидации: покрытие критериев,
 * статусы covered/partial/uncovered, blocker-логика отчёта, coverage-проверки.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTraceability, TRACEABILITY_SCHEMA_VERSION } from '../../dist/core/traceability.js';
import { buildValidationReport, criterionCoverageInputs, isBlockingKind, parseValidationReport } from '../../dist/core/validation.js';
import { buildSpecAndBoard } from './fixtures.js';

const NOW = '2026-01-01T00:00:00.000Z';

test('матрица трассируемости: covered только при пройденном evidence', () => {
  const { spec, plan, board } = buildSpecAndBoard();
  const empty = buildTraceability(spec, plan, board, undefined, NOW);
  assert.equal(empty.schemaVersion, TRACEABILITY_SCHEMA_VERSION);
  assert.equal(empty.rows.length, 2);
  assert.equal(empty.summary.covered, 0);
  assert.equal(empty.summary.partial, 2);
  assert.equal(empty.summary.uncovered, 0);

  // Записали пройденный тест в задачу первого критерия.
  board.tasks[0].tests_to_add_or_update.push('tests/unit/a.test.js');
  board.tasks[0].evidence.push({ kind: 'test', reference: 'tests/unit/a.test.js', passed: true, recorded_at: NOW });
  const covered = buildTraceability(spec, plan, board, undefined, NOW);
  assert.equal(covered.rows[0].status, 'covered');
  assert.deepEqual(covered.rows[0].test_refs, ['tests/unit/a.test.js']);
  assert.equal(covered.rows[1].status, 'partial');
  assert.equal(covered.summary.covered, 1);
  assert.ok(covered.summary.coverage_ratio > 0 && covered.summary.coverage_ratio < 1);
});

test('критерий без задач и пунктов плана — uncovered', () => {
  const { spec, plan, board } = buildSpecAndBoard();
  board.tasks.length = 0;
  plan.items.length = 0;
  const matrix = buildTraceability(spec, plan, board, undefined, NOW);
  assert.equal(matrix.summary.uncovered, 2);
});

test('validation report: blocker-проверки запрещают feature_complete', () => {
  const report = buildValidationReport('FEAT-001', [
    { kind: 'build', status: 'failed', method: 'pnpm build', actual: 'TS5102', probable_cause: 'ошибка типов', minimal_fix: 'исправить импорт' },
    { kind: 'lint', status: 'passed', method: 'pnpm lint', actual: 'ok' },
  ], NOW);
  assert.equal(report.overall, 'failed');
  assert.equal(report.feature_complete, false);
  assert.equal(report.summary.failed, 1);
  const failed = report.checks.find((check) => check.status === 'failed');
  assert.equal(failed.blocking, true);
  assert.equal(failed.probable_cause, 'ошибка типов');
  assert.equal(failed.minimal_fix, 'исправить импорт');
});

test('не блокирующие провалы не мешают feature_complete, но overall = passed', () => {
  const report = buildValidationReport('FEAT-001', [
    { kind: 'build', status: 'passed', method: 'pnpm build', actual: 'ok' },
    { kind: 'contract', status: 'skipped', method: 'контракт DC-001', actual: 'нет задач', blocking: false },
  ], NOW);
  assert.equal(report.overall, 'passed');
  assert.equal(report.feature_complete, true);
});

test('blocked проверка переводит overall в blocked', () => {
  const report = buildValidationReport('FEAT-001', [
    { kind: 'unit', status: 'blocked', method: 'pnpm test', actual: 'subprocess недоступен', blocking: true },
  ], NOW);
  assert.equal(report.overall, 'blocked');
  assert.equal(report.feature_complete, false);
});

test('criterionCoverageInputs: passed по evidence, failed без него, skipped без задач', () => {
  const criteria = [
    { id: 'AC-001', requirement_id: 'FR-001', statement: 'a', verification: 'test' },
    { id: 'AC-002', requirement_id: 'FR-002', statement: 'b', verification: 'manual' },
    { id: 'AC-003', requirement_id: 'FR-003', statement: 'c', verification: 'integration' },
  ];
  const tasks = [
    { task_id: 'T-001', acceptance_criteria: ['AC-001'], evidence: [{ passed: true, kind: 'test', reference: 'x.test.js' }] },
    { task_id: 'T-002', acceptance_criteria: ['AC-002'], evidence: [{ passed: false, kind: 'test', reference: 'y.test.js' }] },
    { task_id: 'T-003', acceptance_criteria: [], evidence: [] },
  ];
  const inputs = criterionCoverageInputs(criteria, tasks);
  assert.equal(inputs.length, 3);
  assert.equal(inputs[0].status, 'passed');
  assert.equal(inputs[1].status, 'failed');
  assert.equal(inputs[1].blocking, false, 'ручная проверка не блокирует');
  assert.equal(inputs[2].status, 'skipped');
  assert.equal(inputs[2].blocking, true);
});

test('isBlockingKind: build/typecheck/unit блокируют по умолчанию, явное значение выигрывает', () => {
  assert.equal(isBlockingKind('build'), true);
  assert.equal(isBlockingKind('unit'), true);
  assert.equal(isBlockingKind('lint'), false);
  assert.equal(isBlockingKind('lint', true), true);
});

test('parseValidationReport читает сохранённый отчёт', () => {
  const report = buildValidationReport('FEAT-001', [{ kind: 'build', status: 'passed', method: 'pnpm build', actual: 'ok' }], NOW);
  const restored = parseValidationReport(JSON.parse(JSON.stringify(report)), '.sdd/validation-report.json');
  assert.equal(restored.overall, 'passed');
  assert.equal(restored.checks.length, 1);
  assert.throws(() => parseValidationReport('nope', '.sdd/validation-report.json'));
});
