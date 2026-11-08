/**
 * `/sdd:spec` — создание/обновление спецификации и отчёт валидации.
 *
 * Поддерживает поля id/title/version/status/owner, goal/scope/out_of_scope,
 * user_stories, functional/non_functional_requirements, acceptance_criteria,
 * data_contracts/api_contracts, edge_cases, constraints, risks,
 * definition_of_done. Обновление пишется атомарно, предыдущая версия
 * уходит в `.sdd/history/`, после записи выполняется полная валидация
 * с отчётом по severity: blocker | major | minor | info.
 */

import { ArtifactValidationError } from '../core/errors.js';
import { parseSpec, SPEC_SCHEMA_VERSION, type Spec, type SpecStatus } from '../core/spec-model.js';
import { sortIssues, summarizeIssues, validateSpec, type SpecIssue } from '../core/spec-validator.js';
import { stampOf } from '../core/storage.js';
import type { CommandContext } from './context.js';
import { nowIso, requireInitialized, requireSpec } from './context.js';

const SPEC_STATUSES: readonly SpecStatus[] = ['draft', 'review', 'approved', 'deprecated'];

/** Экспорт спецификации в человекочитаемый Markdown (`.sdd/spec.md`). */
export function renderSpecMarkdown(spec: Spec): string {
  const lines: string[] = [];
  lines.push(`# Спецификация: ${spec.title}`);
  lines.push('');
  lines.push(`- **ID**: ${spec.id}`);
  lines.push(`- **Версия**: ${spec.version}`);
  lines.push(`- **Статус**: ${spec.status}`);
  lines.push(`- **Владелец**: ${spec.owner}`);
  lines.push(`- **Обновлена**: ${spec.updated_at}`);
  lines.push('');
  lines.push('## Цель');
  lines.push('');
  lines.push(spec.goal);
  lines.push('');
  lines.push('## Объём (scope)');
  lines.push('');
  lines.push(spec.scope);
  lines.push('');
  if (spec.out_of_scope.length > 0) {
    lines.push('## Вне объёма');
    lines.push('');
    for (const item of spec.out_of_scope) lines.push(`- ${item}`);
    lines.push('');
  }
  if (spec.user_stories.length > 0) {
    lines.push('## Пользовательские истории');
    lines.push('');
    for (const story of spec.user_stories) {
      lines.push(`- **${story.id}** (${story.priority}): Как ${story.as_a}, я хочу ${story.i_want}, чтобы ${story.so_that}.`);
    }
    lines.push('');
  }
  const renderRequirements = (title: string, requirements: Spec['functional_requirements']): void => {
    if (requirements.length === 0) return;
    lines.push(`## ${title}`);
    lines.push('');
    for (const requirement of requirements) {
      lines.push(`### ${requirement.id} — ${requirement.title} (${requirement.priority})`);
      lines.push('');
      lines.push(requirement.description);
      lines.push('');
    }
  };
  renderRequirements('Функциональные требования', spec.functional_requirements);
  renderRequirements('Нефункциональные требования', spec.non_functional_requirements);
  if (spec.acceptance_criteria.length > 0) {
    lines.push('## Критерии приёмки');
    lines.push('');
    for (const criterion of spec.acceptance_criteria) {
      lines.push(`- **${criterion.id}** (требование ${criterion.requirement_id}, проверка: ${criterion.verification}): ${criterion.statement}`);
    }
    lines.push('');
  }
  const renderContracts = (title: string, contracts: Spec['data_contracts']): void => {
    if (contracts.length === 0) return;
    lines.push(`## ${title}`);
    lines.push('');
    for (const contract of contracts) {
      lines.push(`- **${contract.id}** ${contract.name}: ${contract.description}${contract.requirement_ids.length > 0 ? ` (требования: ${contract.requirement_ids.join(', ')})` : ''}`);
    }
    lines.push('');
  };
  renderContracts('Контракты API', spec.api_contracts);
  renderContracts('Контракты данных', spec.data_contracts);
  if (spec.edge_cases.length > 0) {
    lines.push('## Edge cases');
    lines.push('');
    for (const edgeCase of spec.edge_cases) {
      lines.push(`- **${edgeCase.id}**: ${edgeCase.description} → ожидаемо: ${edgeCase.expected_behavior}`);
    }
    lines.push('');
  }
  if (spec.constraints.length > 0) {
    lines.push('## Ограничения');
    lines.push('');
    for (const constraint of spec.constraints) lines.push(`- **${constraint.id}**: ${constraint.description}`);
    lines.push('');
  }
  if (spec.risks.length > 0) {
    lines.push('## Риски');
    lines.push('');
    for (const risk of spec.risks) lines.push(`- **${risk.id}**: ${risk.description}${risk.mitigation ? ` (смягчение: ${risk.mitigation})` : ''}`);
    lines.push('');
  }
  if (spec.definition_of_done.length > 0) {
    lines.push('## Definition of done');
    lines.push('');
    for (const item of spec.definition_of_done) lines.push(`- [ ] ${item}`);
    lines.push('');
  }
  if (spec.open_questions.length > 0) {
    lines.push('## Открытые вопросы');
    lines.push('');
    for (const question of spec.open_questions) {
      const status = question.status === 'answered' ? `отвечен: ${question.answer ?? ''}` : question.status;
      lines.push(`- **${question.id}**${question.blocking ? ' (блокирующий)' : ''}: ${question.question} — ${status}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Краткая сводка по спецификации (для ответов команд). */
export function summarizeSpec(spec: Spec): Record<string, unknown> {
  return {
    id: spec.id,
    title: spec.title,
    version: spec.version,
    status: spec.status,
    owner: spec.owner,
    counts: {
      user_stories: spec.user_stories.length,
      functional_requirements: spec.functional_requirements.length,
      non_functional_requirements: spec.non_functional_requirements.length,
      acceptance_criteria: spec.acceptance_criteria.length,
      edge_cases: spec.edge_cases.length,
      constraints: spec.constraints.length,
      open_questions: spec.open_questions.filter((question) => question.status !== 'answered').length,
    },
    updated_at: spec.updated_at,
  };
}

/**
 * Применить пользовательский патч к спецификации: известные поля заменяются,
 * неизвестные — отвергаются. Возвращает новый объект (иммутабельно).
 */
export function patchSpec(spec: Spec, patch: Record<string, unknown>, now: string): { spec: Spec; applied: string[]; rejected: string[] } {
  const applied: string[] = [];
  const rejected: string[] = [];
  const next: Spec = structuredClone(spec);
  const simpleFields = ['id', 'title', 'owner', 'goal', 'scope'] as const;
  for (const field of simpleFields) {
    if (field in patch) {
      const value = patch[field];
      if (typeof value !== 'string') {
        rejected.push(`${field}: ожидалась строка`);
      } else {
        next[field] = value.trim();
        applied.push(field);
      }
    }
  }
  if ('version' in patch) {
    const value = patch.version;
    if (typeof value !== 'string' || !/^\d+\.\d+\.\d+/.test(value)) rejected.push('version: ожидался semver (например 1.2.0)');
    else {
      next.version = value;
      applied.push('version');
    }
  }
  if ('status' in patch) {
    const value = patch.status;
    if (typeof value !== 'string' || !SPEC_STATUSES.includes(value as SpecStatus)) {
      rejected.push(`status: ожидалось одно из ${SPEC_STATUSES.join(' | ')}`);
    } else {
      next.status = value as SpecStatus;
      applied.push('status');
    }
  }
  const listFields = ['out_of_scope', 'definition_of_done', 'user_stories', 'functional_requirements', 'non_functional_requirements', 'acceptance_criteria', 'data_contracts', 'api_contracts', 'edge_cases', 'constraints', 'risks', 'open_questions'] as const;
  for (const field of listFields) {
    if (field in patch) {
      if (!Array.isArray(patch[field])) {
        rejected.push(`${field}: ожидался массив`);
      } else {
        (next as unknown as Record<string, unknown>)[field] = patch[field];
        applied.push(field);
      }
    }
  }
  next.updated_at = now;
  return { spec: next, applied, rejected };
}

/**
 * Проверить целостность после патча: parseSpec повторно разбирает объект и
 * бросает ошибку с файлом/полем при структурных нарушениях.
 */
export function ensureParsable(spec: Spec): Spec {
  return parseSpec(structuredClone(spec), '.sdd/spec.json');
}

/** Записать спецификацию (spec.json + spec.md + снимок истории). */
export async function writeSpec(ctx: CommandContext, spec: Spec, previousRaw?: string): Promise<void> {
  if (previousRaw !== undefined) {
    await ctx.storage.snapshotToHistory('specJson', previousRaw, stampOf());
  }
  await ctx.storage.writeJson('specJson', spec);
  await ctx.storage.writeArtifact('specMd', renderSpecMarkdown(spec));
}

/** Выполнить `/sdd:spec` с операциями set | patch | validate | get | answer. */
export async function runSpecCommand(
  ctx: CommandContext,
  args: { op?: string; patch?: Record<string, unknown>; answers?: Record<string, unknown>; question_id?: string; answer?: string } = {},
): Promise<Record<string, unknown>> {
  await requireInitialized(ctx);
  const op = args.op ?? 'patch';

  if (op === 'get') {
    const spec = await requireSpec(ctx);
    return { ok: true, spec, markdown_file: '.sdd/spec.md' };
  }

  if (op === 'validate') {
    const spec = await requireSpec(ctx);
    const issues = sortIssues(validateSpec(spec));
    return { ok: true, summary: summarizeIssues(issues), issues, spec: summarizeSpec(spec) };
  }

  if (op === 'answer') {
    if (!args.question_id || typeof args.answer !== 'string') {
      throw new ArtifactValidationError('Операция answer требует question_id и answer.', {
        file: '.sdd/spec.json',
        hint: 'Пример: /sdd-spec answer {"question_id":"Q-goal","answer":"…"}',
      });
    }
    const { answerQuestion } = await import('./init.js');
    const previous = await ctx.storage.readArtifact('specJson');
    const spec = await requireSpec(ctx);
    const updated = answerQuestion(spec, args.question_id, args.answer, nowIso());
    await writeSpec(ctx, updated, previous);
    const issues = sortIssues(validateSpec(updated));
    return { ok: true, summary: summarizeIssues(issues), issues, spec: summarizeSpec(updated) };
  }

  // set | patch: объединяем патч, затем ответы интервью (обратная совместимость).
  const previous = await ctx.storage.readArtifact('specJson');
  const current = await requireSpec(ctx);
  let { spec: updated, applied, rejected } = patchSpec(current, args.patch ?? {}, nowIso());
  if (args.answers && typeof args.answers === 'object') {
    const { applyAnswers } = await import('./init.js');
    const result = applyAnswers(updated, args.answers as Record<string, unknown>);
    applied = [...applied, ...result.applied];
    rejected = [...rejected, ...result.rejected];
    updated = ensureParsable(updated);
  }
  updated = ensureParsable(updated);
  await writeSpec(ctx, updated, previous);
  const issues: SpecIssue[] = sortIssues(validateSpec(updated));
  ctx.logger.info(`sdd:spec: применены поля ${applied.join(', ') || '—'}; отклонены ${rejected.length}`);
  return {
    ok: true,
    applied,
    rejected,
    schema_version: SPEC_SCHEMA_VERSION,
    summary: summarizeIssues(issues),
    issues,
    spec: summarizeSpec(updated),
    note: issues.some((issue) => issue.severity === 'blocker')
      ? 'Есть blocker-находки: /sdd-plan откажется генерировать план, пока они не устранены.'
      : undefined,
  };
}
