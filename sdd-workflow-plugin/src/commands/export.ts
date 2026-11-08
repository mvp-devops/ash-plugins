/**
 * `/sdd:export` — экспорт SDD-пакета: спецификация, план, задачи,
 * traceability-матрица, validation report и changelog в Markdown + JSON.
 * Файлы пишутся в `.sdd/export/`; всё содержимое также возвращается командой.
 */

import { renderPlanMarkdown } from '../core/plan-generator.js';
import { buildTraceability, type TraceabilityMatrix } from '../core/traceability.js';
import { parseValidationReport, type ValidationReport } from '../core/validation.js';
import type { CommandContext } from './context.js';
import { loadPlan, loadTasks, nowIso, requireInitialized, requireSpec } from './context.js';
import { renderSpecMarkdown } from './spec.js';

const EXPORT_DIR = '.sdd/export';

/** Построить changelog из истории спецификации и артефактов. */
export function renderChangelog(entries: string[], generatedAt: string): string {
  const lines = ['# SDD changelog', '', `Сформирован: ${generatedAt}`, ''];
  if (entries.length === 0) {
    lines.push('Изменения не зафиксированы.');
  } else {
    for (const entry of entries) lines.push(`- ${entry}`);
  }
  return lines.join('\n');
}

/** Экспорт трассируемости в Markdown-таблицу. */
export function renderTraceabilityMarkdown(matrix: TraceabilityMatrix): string {
  const lines: string[] = [];
  lines.push(`# Traceability matrix — ${matrix.spec_id}`);
  lines.push('');
  lines.push('| Требование | Критерий | Проверка | Пункты плана | Задачи | Тесты | Валидация | Статус |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of matrix.rows) {
    lines.push(
      `| ${row.requirement_id} | ${row.criterion_id} | ${row.verification} | ${row.plan_item_ids.join(', ') || '—'} | ${row.task_ids.join(', ') || '—'} | ${row.test_refs.join(', ') || '—'} | ${row.validation_status ?? '—'} | ${row.status} |`,
    );
  }
  lines.push('');
  lines.push(
    `Итого: всего ${matrix.summary.total}, покрыто ${matrix.summary.covered}, частично ${matrix.summary.partial}, не покрыто ${matrix.summary.uncovered}.`,
  );
  lines.push('');
  return lines.join('\n');
}

/** Экспорт validation report в Markdown. */
export function renderReportMarkdown(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`# Validation report — ${report.spec_id}`);
  lines.push('');
  lines.push(`Итог: **${report.overall}**; фича завершена: ${report.feature_complete ? 'да' : 'нет'} (${report.generated_at}).`);
  lines.push('');
  lines.push('| Проверка | Вид | Статус | Способ | Фактический результат |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const check of report.checks) {
    lines.push(`| ${check.check_id} | ${check.kind} | ${check.status} | ${check.method} | ${check.actual.replace(/\|/g, '\\|')} |`);
  }
  const failures = report.checks.filter((check) => check.status === 'failed' || check.status === 'blocked');
  if (failures.length > 0) {
    lines.push('');
    lines.push('## Непройденные проверки');
    lines.push('');
    for (const check of failures) {
      lines.push(`- **${check.check_id}** (${check.kind}, ${check.blocking ? 'blocker' : 'не блокирует'}): ${check.method}`);
      if (check.requirement_id) lines.push(`  - требование: ${check.requirement_id}${check.criterion_id ? `, критерий: ${check.criterion_id}` : ''}`);
      if (check.probable_cause) lines.push(`  - причина: ${check.probable_cause}`);
      if (check.minimal_fix) lines.push(`  - минимальный fix: ${check.minimal_fix}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Выполнить `/sdd:export`. */
export async function runExportCommand(ctx: CommandContext, _args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await requireInitialized(ctx);
  const spec = await requireSpec(ctx);
  const plan = await loadPlan(ctx);
  const board = await loadTasks(ctx);
  const report = await ctx.storage.readJson('validationReportJson', parseValidationReport).catch(() => undefined);
  const matrix: TraceabilityMatrix | undefined =
    spec && plan && board ? buildTraceability(spec, plan, board, report, nowIso()) : undefined;

  const stamp = nowIso().replace(/[:.]/g, '-');
  const files: { name: string; markdown?: string; json?: unknown }[] = [
    { name: 'spec.md', markdown: renderSpecMarkdown(spec) },
    { name: 'spec.json', json: spec },
  ];
  if (plan) {
    files.push({ name: 'plan.md', markdown: renderPlanMarkdown(plan) }, { name: 'plan.json', json: plan });
  }
  if (board) files.push({ name: 'tasks.json', json: board });
  if (matrix) {
    files.push({ name: 'traceability.json', json: matrix }, { name: 'traceability.md', markdown: renderTraceabilityMarkdown(matrix) });
  }
  if (report) {
    files.push({ name: 'validation-report.json', json: report }, { name: 'validation-report.md', markdown: renderReportMarkdown(report) });
  }
  const history = await ctx.storage.listHistory();
  files.push({ name: 'changelog.md', markdown: renderChangelog(history, nowIso()) });

  const written: string[] = [];
  for (const file of files) {
    const target = `${EXPORT_DIR}/${stamp}/${file.name}`;
    if (file.markdown !== undefined) await ctx.fs.writeText(target, file.markdown);
    else await ctx.fs.writeText(target, `${JSON.stringify(file.json, null, 2)}\n`);
    written.push(target);
  }

  ctx.logger.info(`sdd:export: записано файлов ${written.length}`);
  return {
    ok: true,
    export_dir: `${EXPORT_DIR}/${stamp}`,
    files: written,
    summary: {
      spec_id: spec.id,
      has_plan: plan !== undefined,
      tasks: board?.tasks.length ?? 0,
      traceability_total: matrix?.summary.total ?? 0,
      validation_overall: report?.overall ?? null,
    },
  };
}
