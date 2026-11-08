/**
 * `/sdd:validate` — полная проверка соответствия реализации спецификации.
 *
 * Запускает (через ctx.subprocess): сборку, type-check, lint, unit-тесты;
 * добавляет проверки покрытия acceptance criteria, контрактов и edge cases,
 * а также проверку регрессий (состояние unit-тестов). Формирует
 * validation-report.json; фича не считается завершённой при наличии
 * failed/blocked проверок уровня blocker.
 */

import { SddError } from '../core/errors.js';
import { detectProjectCommands, runProjectChecks } from '../core/runner.js';
import { buildValidationReport, criterionCoverageInputs, parseValidationReport, type CheckInput, type ValidationReport } from '../core/validation.js';
import { buildTraceability, type TraceabilityMatrix } from '../core/traceability.js';
import type { CommandContext } from './context.js';
import { loadPlan, loadTasks, nowIso, requireInitialized, requireSpec } from './context.js';

/** Выполнить `/sdd:validate`. */
export async function runValidateCommand(ctx: CommandContext, _args: { op?: string } = {}): Promise<Record<string, unknown>> {
  await requireInitialized(ctx);
  const spec = await requireSpec(ctx);
  const board = await loadTasks(ctx);
  const plan = await loadPlan(ctx);

  // 1. Автоматические проверки проекта (build/typecheck/lint/unit).
  const commands = await detectCommands(ctx);
  const checkInputs: CheckInput[] = await runProjectChecks(ctx.subprocess, ctx.workspaceRoot, commands);

  // 2. Регрессии: состояние unit-тестов.
  const unitCheck = checkInputs.find((check) => check.kind === 'unit');
  if (unitCheck) {
    checkInputs.push({
      kind: 'regression',
      status: unitCheck.status === 'passed' ? 'passed' : unitCheck.status === 'failed' ? 'failed' : 'skipped',
      method: 'существующие тесты не должны падать после изменений',
      actual: unitCheck.actual,
      probable_cause: unitCheck.status === 'failed' ? 'изменения нарушили существующее поведение' : undefined,
      minimal_fix: unitCheck.status === 'failed' ? 'исправьте регрессию, отмеченную в выводе unit-тестов' : undefined,
      blocking: true,
    });
  }

  // 3. Покрытие acceptance criteria (только при наличии задач).
  if (board) {
    checkInputs.push(...criterionCoverageInputs(spec.acceptance_criteria, board.tasks));
  } else {
    checkInputs.push({
      kind: 'coverage',
      status: 'skipped',
      method: 'покрытие acceptance criteria задачами',
      actual: 'задачи не сгенерированы',
      minimal_fix: 'выполните /sdd-tasks generate',
      blocking: false,
    });
  }

  // 4. Контракты и edge cases: фиксируются как criterion-проверки через задачи.
  if (board && plan) {
    for (const contract of [...spec.api_contracts, ...spec.data_contracts]) {
      const covered = board.tasks.some((task) => task.requirement_ids.some((requirementId) => contract.requirement_ids.includes(requirementId)));
      checkInputs.push({
        kind: 'contract',
        status: covered ? 'passed' : 'skipped',
        requirement_id: contract.requirement_ids[0],
        method: `контракт ${contract.id} (${contract.name})`,
        actual: covered ? 'есть задачи, покрывающие связанные требования' : 'нет задач, покрывающих контракт',
        minimal_fix: covered ? undefined : 'добавьте задачи с этим требованием',
        blocking: false,
      });
    }
    for (const edgeCase of spec.edge_cases) {
      const covered = board.tasks.some((task) => task.requirement_ids.some((requirementId) => edgeCase.requirement_ids.includes(requirementId)) && task.tests_to_add_or_update.length > 0);
      checkInputs.push({
        kind: 'edge_case',
        status: covered ? 'passed' : 'skipped',
        requirement_id: edgeCase.requirement_ids[0],
        method: `edge case ${edgeCase.id}: ${edgeCase.description}`,
        actual: covered ? 'есть задача с тестами для связанного требования' : 'нет задачи с тестами для edge case',
        minimal_fix: covered ? undefined : 'добавьте тест для edge case в tests_to_add_or_update соответствующей задачи',
        blocking: false,
      });
    }
  }

  const report: ValidationReport = buildValidationReport(spec.id, checkInputs, nowIso());
  await ctx.storage.writeJson('validationReportJson', report);

  let matrix: TraceabilityMatrix | undefined;
  if (board && plan) {
    matrix = buildTraceability(spec, plan, board, report, nowIso());
    await ctx.storage.writeJson('traceabilityJson', matrix);
  }

  const blockers = report.checks.filter((check) => check.blocking && (check.status === 'failed' || check.status === 'blocked'));
  ctx.logger[report.overall === 'passed' ? 'info' : 'warn'](`sdd:validate: overall=${report.overall}, blockers=${blockers.length}`);
  return {
    ok: true,
    overall: report.overall,
    feature_complete: report.feature_complete,
    summary: report.summary,
    checks: report.checks,
    blockers: blockers.map((check) => ({
      check_id: check.check_id,
      kind: check.kind,
      requirement_id: check.requirement_id ?? null,
      criterion: check.criterion_id ?? null,
      method: check.method,
      actual: check.actual,
      probable_cause: check.probable_cause ?? null,
      minimal_fix: check.minimal_fix ?? null,
    })),
    verdict:
      blockers.length > 0
        ? 'Фича НЕ завершена: есть blocker-проверки со статусом failed/blocked.'
        : report.feature_complete
          ? 'Все проверки пройдены: фича соответствует спецификации.'
          : 'Блокирующих проверок нет, но не все критерии подтверждены.',
    traceability: matrix?.summary,
  };
}

/** Прочитать package.json рабочего пространства и определить скрипты проверок. */
async function detectCommands(ctx: CommandContext) {
  const raw = await ctx.fs.readText('package.json');
  if (raw === undefined) {
    throw new SddError('SDD_NOT_INITIALIZED', 'В корне рабочего пространства нет package.json — нечего проверять автоматически.', {
      file: 'package.json',
      hint: 'sdd:validate запускает проверки проекта; выполните её в каталоге проекта с package.json.',
    });
  }
  try {
    return detectProjectCommands(JSON.parse(raw) as unknown);
  } catch (error) {
    throw new SddError('SDD_INVALID_JSON', `package.json повреждён: ${(error as Error).message}`, {
      file: 'package.json',
      hint: 'исправьте синтаксис package.json',
    });
  }
}

/** Прочитать сохранённый отчёт (используется статусом и тестами). */
export async function readReport(ctx: CommandContext): Promise<ValidationReport | undefined> {
  return ctx.storage.readJson('validationReportJson', parseValidationReport);
}
