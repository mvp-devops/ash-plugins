/**
 * Unit-тесты: ошибки (код, файл, поле, подсказка), runner (определение
 * команд проекта, fake-subprocess, деградация без службы), экспорт
 * (Markdown-рендеры, changelog).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SddError, ArtifactValidationError, FsOperationError, toSddError } from '../../dist/core/errors.js';
import { detectProjectCommands, runProjectChecks, runCheck } from '../../dist/core/runner.js';
import { renderTraceabilityMarkdown, renderReportMarkdown, renderChangelog } from '../../dist/commands/export.js';
import { buildValidationReport } from '../../dist/core/validation.js';
import { makeFakeSubprocess } from '../helpers.js';

const NOW = '2026-01-01T00:00:00.000Z';

test('SddError несёт код/файл/поле/подсказку и форматирует их', () => {
  const error = new SddError('SDD_MISSING_FIELD', 'Поле не заполнено', { file: '.sdd/spec.json', field: 'goal', hint: 'заполните goal' });
  assert.equal(error.code, 'SDD_MISSING_FIELD');
  assert.match(error.formatted(), /\.sdd\/spec\.json/);
  assert.match(error.formatted(), /goal/);
  assert.match(error.formatted(), /заполните goal/);
});

test('toSddError оборачивает неизвестные ошибки и сохраняет SddError', () => {
  const wrapped = toSddError(new Error('boom'), '.sdd/x.json');
  assert.equal(wrapped.code, 'SDD_COMMAND_ERROR');
  assert.equal(wrapped.file, '.sdd/x.json');
  const original = new SddError('SDD_EVIDENCE_REQUIRED', 'нужен evidence');
  assert.equal(toSddError(original), original);
});

test('иерархия ошибок согласована', () => {
  assert.ok(new ArtifactValidationError('x', { file: 'f' }) instanceof SddError);
  assert.ok(new FsOperationError('x', { file: 'f' }) instanceof SddError);
});

test('detectProjectCommands определяет скрипты по имени', () => {
  const commands = detectProjectCommands({ scripts: { build: 'tsc', 'type-check': 'tsc --noEmit', lint: 'eslint .', test: 'node --test' } });
  assert.deepEqual(commands, { packageManager: 'pnpm', build: 'build', typecheck: 'type-check', lint: 'lint', test: 'test' });
  const missing = detectProjectCommands({});
  assert.equal(missing.build, undefined);
  assert.equal(missing.typecheck, undefined);
});

test('runCheck маппит код выхода в passed/failed с выводом', async () => {
  const subprocess = makeFakeSubprocess({ test: 0, lint: 1 });
  const ok = await runCheck(subprocess, '/ws', 'unit', 'test', '/fake/pnpm', 'pnpm');
  assert.equal(ok.status, 'passed');
  assert.match(ok.actual, /ok: test/);
  const bad = await runCheck(subprocess, '/ws', 'lint', 'lint', '/fake/pnpm', 'pnpm');
  assert.equal(bad.status, 'failed');
  assert.match(bad.actual, /код выхода 1/);
  assert.ok(bad.minimal_fix);
});

test('runProjectChecks: отсутствующие скрипты — not_applicable, ошибки запуска — blocked', async () => {
  const commands = { packageManager: 'pnpm', test: 'test' };
  const results = await runProjectChecks(makeFakeSubprocess({}), '/ws', commands);
  const byKind = Object.fromEntries(results.map((check) => [check.kind, check]));
  assert.equal(byKind.build.status, 'not_applicable');
  assert.equal(byKind.unit.status, 'passed');
  const broken = {
    async resolveExecutable() {
      throw new Error('нет pnpm');
    },
    spawn() {
      throw new Error('spawn failed');
    },
  };
  const degraded = await runProjectChecks(broken, '/ws', { packageManager: 'npm', test: 'test' });
  assert.ok(degraded.every((check) => check.status === 'blocked'), 'ошибка resolveExecutable должна деградировать в blocked');
});

test('runProjectChecks без subprocess — все проверки blocked без имитации успеха', async () => {
  const results = await runProjectChecks(undefined, '/ws', { packageManager: 'pnpm', test: 'test' });
  assert.equal(results.length, 4);
  assert.ok(results.every((check) => check.status === 'blocked'));
  assert.match(results[0].actual, /subprocess недоступна/);
});

test('renderTraceabilityMarkdown и renderReportMarkdown содержат ключевые разделы', () => {
  const matrix = {
    schemaVersion: 1,
    spec_id: 'FEAT-001',
    generated_at: NOW,
    rows: [
      {
        requirement_id: 'FR-001',
        criterion_id: 'AC-001',
        criterion: 'Условие',
        verification: 'test',
        plan_item_ids: ['P-001'],
        task_ids: ['T-001'],
        test_refs: ['tests/a.test.js'],
        validation_status: 'passed',
        status: 'covered',
      },
    ],
    summary: { total: 1, covered: 1, partial: 0, uncovered: 0, coverage_ratio: 1 },
  };
  const matrixMarkdown = renderTraceabilityMarkdown(matrix);
  assert.match(matrixMarkdown, /\| FR-001 \| AC-001 \|/);
  assert.match(matrixMarkdown, /Итого: всего 1, покрыто 1/);

  const report = buildValidationReport('FEAT-001', [
    { kind: 'build', status: 'failed', method: 'pnpm build', actual: 'ошибка | в выводе', probable_cause: 'импорт', minimal_fix: 'фикс' },
  ], NOW);
  const reportMarkdown = renderReportMarkdown(report);
  assert.match(reportMarkdown, /Итог: \*\*failed\*\*/);
  assert.match(reportMarkdown, /Непройденные проверки/);
  assert.match(reportMarkdown, /минимальный fix/);
  assert.ok(!reportMarkdown.includes('ошибка | в выводе'), 'вертикальная черта должна экранироваться в таблице');
});

test('renderChangelog формирует список или пометку об отсутствии изменений', () => {
  assert.match(renderChangelog([], NOW), /Изменения не зафиксированы/);
  assert.match(renderChangelog(['specJson-2026.json'], NOW), /specJson-2026\.json/);
});
