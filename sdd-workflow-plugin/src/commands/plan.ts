/**
 * `/sdd:plan` — генерация технического плана из спецификации.
 *
 * Правила:
 * - план не создаётся, если спецификация содержит blocker-проблемы;
 * - по умолчанию требуется статус спецификации `approved` (явно разрешить
 *   черновик можно `allow_draft: true`);
 * - каждый пункт плана получает ID и ссылается на requirement ID;
 * - повторная генерация перезаписывает план только с `confirm_overwrite`.
 */

import { SddError } from '../core/errors.js';
import { generatePlan, parsePlan, renderPlanMarkdown, resetItemCounter, type Plan, type PlanInput } from '../core/plan-generator.js';
import { sortIssues, validateSpec } from '../core/spec-validator.js';
import { stampOf } from '../core/storage.js';
import type { CommandContext } from './context.js';
import { loadPlan, nowIso, requireInitialized, requireSpec } from './context.js';

/** Выполнить `/sdd:plan` (операции generate | get). */
export async function runPlanCommand(
  ctx: CommandContext,
  args: { op?: string; plan?: Partial<PlanInput>; confirm_overwrite?: boolean; allow_draft?: boolean } = {},
): Promise<Record<string, unknown>> {
  await requireInitialized(ctx);
  const op = args.op ?? 'generate';

  if (op === 'get') {
    const plan = await loadPlan(ctx);
    if (!plan) {
      throw new SddError('SDD_NOT_INITIALIZED', 'План ещё не сгенерирован.', { file: '.sdd/plan.json', hint: 'Выполните /sdd-plan generate.' });
    }
    return { ok: true, plan, markdown_file: '.sdd/plan.md' };
  }

  const spec = await requireSpec(ctx);
  const issues = sortIssues(validateSpec(spec));
  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  if (blockers.length > 0) {
    throw new SddError('SDD_BLOCKERS_PRESENT', `Спецификация содержит ${blockers.length} blocker-проблем(ы) — генерация плана заблокирована.`, {
      file: '.sdd/spec.json',
      hint: 'Исправьте blocker-находки (поле/фикс указаны в issues) и повторите /sdd-plan generate.',
    });
  }
  if (spec.status !== 'approved' && !args.allow_draft) {
    throw new SddError('SDD_BLOCKERS_PRESENT', `Статус спецификации — «${spec.status}»; план генерируется по утверждённой (approved) спецификации.`, {
      file: '.sdd/spec.json',
      field: 'status',
      hint: 'Утвердите спецификацию (/sdd-spec patch {"status":"approved"}) или передайте allow_draft: true осознанно.',
    });
  }

  const existing = await loadPlan(ctx);
  if (existing && !args.confirm_overwrite) {
    throw new SddError('SDD_OVERWRITE_DECLINED', 'План уже существует; повторная генерация перезапишет пункты и статусы задач.', {
      file: '.sdd/plan.json',
      hint: 'Передайте confirm_overwrite: true, чтобы перегенерировать план.',
    });
  }

  const input = (args.plan ?? {}) as PlanInput;
  resetItemCounter(0);
  const plan: Plan = generatePlan(spec, { ...input, now: nowIso() });
  await ctx.storage.writeJson('planJson', plan);
  await ctx.storage.writeArtifact('planMd', renderPlanMarkdown(plan));
  ctx.logger.info(`sdd:plan: план содержит ${plan.items.length} пунктов`);
  return {
    ok: true,
    plan,
    items: plan.items.length,
    next_step: 'Преобразуйте план в задачи: /sdd-tasks generate.',
  };
}

/** Разобрать план из сохранённого JSON (используется тестами). */
export function parsePlanArtifact(raw: unknown): Plan {
  return parsePlan(raw, '.sdd/plan.json');
}

/** Метка времени для снимков истории плана. */
export function planStamp(): string {
  return stampOf();
}
