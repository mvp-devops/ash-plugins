/**
 * `/sdd:status` — текущее состояние SDD-цикла: спецификация, план, задачи,
 * трассируемость, последние проверки, блокеры и рекомендуемое следующее
 * действие (машина состояний цикла).
 */

import { SddError } from '../core/errors.js';
import { sortIssues, summarizeIssues, validateSpec } from '../core/spec-validator.js';
import { buildTraceability, type TraceabilityMatrix } from '../core/traceability.js';
import { readyTasks } from '../core/task-generator.js';
import { summarizeBoard } from './tasks.js';
import { summarizeSpec } from './spec.js';
import { parseValidationReport, type ValidationReport } from '../core/validation.js';
import type { CommandContext } from './context.js';
import { loadPlan, loadSpec, loadTasks } from './context.js';

/** Состояние цикла SDD. */
export type CycleStage = 'not_initialized' | 'spec_draft' | 'spec_blocked' | 'spec_ready' | 'plan_missing' | 'tasks_missing' | 'implementing' | 'validation_required' | 'blocked_by_validation' | 'complete';

/** Вычислить рекомендуемое следующее действие. */
export function nextAction(args: {
  initialized: boolean;
  specBlockers: number;
  specStatus: string;
  hasPlan: boolean;
  hasTasks: boolean;
  pendingTasks: number;
  report?: ValidationReport;
  coverage?: TraceabilityMatrix['summary'];
}): { stage: CycleStage; action: string; blockers: string[] } {
  const blockers: string[] = [];
  if (!args.initialized) {
    return { stage: 'not_initialized', action: 'Выполните /sdd-init и ответьте на вопросы интервью.', blockers };
  }
  if (args.specBlockers > 0) {
    blockers.push(`спецификация: ${args.specBlockers} blocker-находок`);
    return { stage: 'spec_blocked', action: 'Исправьте blocker-находки спецификации (/sdd-spec validate).', blockers };
  }
  if (args.specStatus !== 'approved') {
    return { stage: 'spec_ready', action: 'Уточните спецификацию и утвердите её (/sdd-spec patch {"status":"approved"}).', blockers };
  }
  if (!args.hasPlan) {
    return { stage: 'plan_missing', action: 'Сгенерируйте план (/sdd-plan generate).', blockers };
  }
  if (!args.hasTasks) {
    return { stage: 'tasks_missing', action: 'Сгенерируйте задачи (/sdd-tasks generate).', blockers };
  }
  if (args.report && args.report.overall !== 'passed') {
    for (const check of args.report.checks) {
      if (check.blocking && (check.status === 'failed' || check.status === 'blocked')) {
        blockers.push(`${check.kind}: ${check.method} — ${check.actual}`);
      }
    }
    return { stage: 'blocked_by_validation', action: 'Устраните blocker-проверки (/sdd-validate покажет minimal_fix) и повторите валидацию.', blockers };
  }
  if (args.pendingTasks > 0) {
    return { stage: 'implementing', action: `Реализуйте задачи: /sdd-implement queue (осталось задач: ${args.pendingTasks}).`, blockers };
  }
  if ((args.coverage?.uncovered ?? 0) > 0) {
    return { stage: 'validation_required', action: 'Есть непокрытые acceptance criteria — повторите /sdd-validate после закрытия покрытия.', blockers: ['непокрытые acceptance criteria'] };
  }
  return { stage: 'complete', action: 'Фича соответствует спецификации. Изменения требований — через /sdd-spec patch, затем перегенерация затронутых артефактов.', blockers };
}

/** Выполнить `/sdd:status`. */
export async function runStatusCommand(ctx: CommandContext, _args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const initialized = await ctx.storage.isInitialized();
  if (!initialized) {
    return {
      ok: true,
      stage: 'not_initialized',
      action: 'Выполните /sdd-init и ответьте на вопросы интервью.',
      blockers: [],
    };
  }

  const spec = await loadSpec(ctx);
  if (!spec) {
    throw new SddError('SDD_NOT_INITIALIZED', 'Файл .sdd/spec.json не найден.', { file: '.sdd/spec.json', hint: 'Повторите /sdd-init.' });
  }
  const issues = sortIssues(validateSpec(spec));
  const specSummary = summarizeIssues(issues);
  const plan = await loadPlan(ctx);
  const board = await loadTasks(ctx);
  const report = await ctx.storage.readJson('validationReportJson', parseValidationReport).catch(() => undefined);
  const history = await ctx.storage.listHistory();

  let coverage: TraceabilityMatrix['summary'] | undefined;
  if (spec && plan && board) {
    coverage = buildTraceability(spec, plan, board, report, new Date().toISOString()).summary;
  }
  const pending = board ? board.tasks.filter((task) => task.status !== 'done').length : 0;
  // Пустой отчёт (созданный при init, без проверок) не считается результатом.
  const meaningfulReport = report && report.checks.length > 0 ? report : undefined;
  const ready = board ? readyTasks(board).ready.length : 0;
  const { stage, action, blockers } = nextAction({
    initialized,
    specBlockers: specSummary.blockers,
    specStatus: spec.status,
    hasPlan: plan !== undefined,
    hasTasks: board !== undefined && board.tasks.length > 0,
    pendingTasks: pending,
    report: meaningfulReport,
    coverage,
  });

  const uncovered = coverage ? coverage.total - coverage.covered : undefined;
  return {
    ok: true,
    stage,
    spec: summarizeSpec(spec),
    spec_issues: specSummary,
    plan: plan
      ? { items: plan.items.length, status: plan.status, generated_at: plan.generated_at }
      : undefined,
    tasks: board ? summarizeBoard(board) : undefined,
    ready_tasks: ready,
    traceability: coverage,
    uncovered_criteria: uncovered,
    last_validation: meaningfulReport
      ? { overall: meaningfulReport.overall, feature_complete: meaningfulReport.feature_complete, summary: meaningfulReport.summary, generated_at: meaningfulReport.generated_at }
      : undefined,
    blockers,
    recommended_next_action: action,
    history_snapshots: history.length,
  };
}
