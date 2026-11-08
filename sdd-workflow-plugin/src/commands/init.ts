/**
 * `/sdd:init` — создание SDD-рабочего пространства проекта и интервью.
 *
 * Создаёт `.sdd/` со спецификацией-черновиком и фиксированными артефактами,
 * возвращает структурированный вопросник. Критические поля, не заполненные
 * из `answers`, помечаются `TBD` и попадают в открытые вопросы — до их
 * закрытия переход к плану заблокирован.
 */

import { SddError } from '../core/errors.js';
import { emptySpec, INTERVIEW_QUESTIONS, parseSpec, TBD, type OpenQuestion, type Spec } from '../core/spec-model.js';
import { renderSpecMarkdown, summarizeSpec } from './spec.js';
import type { CommandContext } from './context.js';
import { nowIso } from './context.js';

/** Поля спецификации, которые можно заполнить ответами интервью. */
const ANSWERABLE_STRING_FIELDS = ['id', 'title', 'owner', 'goal', 'scope'] as const;
const ANSWERABLE_LIST_FIELDS = [
  'out_of_scope',
  'definition_of_done',
] as const;
const ANSWERABLE_OBJECT_LIST_FIELDS = [
  'user_stories',
  'functional_requirements',
  'non_functional_requirements',
  'acceptance_criteria',
  'data_contracts',
  'api_contracts',
  'edge_cases',
  'constraints',
  'risks',
] as const;

/** Применить ответы интервью к черновику спецификации. */
export function applyAnswers(spec: Spec, answers: Record<string, unknown>, file = '.sdd/spec.json'): { applied: string[]; rejected: string[] } {
  const applied: string[] = [];
  const rejected: string[] = [];
  for (const [field, value] of Object.entries(answers)) {
    if ((ANSWERABLE_STRING_FIELDS as readonly string[]).includes(field)) {
      if (typeof value !== 'string') {
        rejected.push(`${field}: ожидалась строка`);
        continue;
      }
      (spec as unknown as Record<string, unknown>)[field] = value.trim();
      applied.push(field);
    } else if ((ANSWERABLE_LIST_FIELDS as readonly string[]).includes(field)) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        rejected.push(`${field}: ожидался массив строк`);
        continue;
      }
      (spec as unknown as Record<string, unknown>)[field] = value;
      applied.push(field);
    } else if ((ANSWERABLE_OBJECT_LIST_FIELDS as readonly string[]).includes(field)) {
      if (!Array.isArray(value)) {
        rejected.push(`${field}: ожидался массив`);
        continue;
      }
      (spec as unknown as Record<string, unknown>)[field] = value;
      applied.push(field);
    } else if (field === 'open_questions') {
      rejected.push('open_questions: управляется плагином, передавайте ответы через sdd-spec answer');
    } else {
      rejected.push(`${field}: неизвестное поле`);
    }
  }
  void file;
  return { applied, rejected };
}

/**
 * Выполнить `/sdd:init`. Идемпотентно: существующий workspace не
 * перезаписывается без явного `confirm_overwrite: true`.
 */
export async function runInit(ctx: CommandContext, args: { answers?: Record<string, unknown>; confirm_overwrite?: boolean } = {}): Promise<Record<string, unknown>> {
  const initialized = await ctx.storage.isInitialized();
  if (initialized && !args.confirm_overwrite) {
    const spec = await ctx.storage.readJson('specJson', parseSpec);
    return {
      ok: true,
      created: false,
      message: 'SDD workspace уже инициализирован; существующие артефакты не изменены (confirm_overwrite: true — чтобы переинициализировать).',
      spec: spec ? summarizeSpec(spec) : undefined,
      questionnaire: INTERVIEW_QUESTIONS,
    };
  }

  const now = nowIso();
  const spec = emptySpec(now);
  let applied: string[] = [];
  let rejected: string[] = [];
  if (args.answers && typeof args.answers === 'object' && !Array.isArray(args.answers)) {
    ({ applied, rejected } = applyAnswers(spec, args.answers as Record<string, unknown>));
  }

  // Критические поля, не заполненные ответами, → TBD + открытые вопросы.
  const openQuestions: OpenQuestion[] = [];
  for (const field of ['id', 'title', 'owner', 'goal', 'scope'] as const) {
    const value = spec[field];
    if (value.trim() === '' || value.trim() === TBD) {
      spec[field] = TBD;
      const interview = INTERVIEW_QUESTIONS.find((question) => question.field === field);
      openQuestions.push({
        id: `Q-${field}`,
        question: interview?.question ?? `Заполните поле ${field}.`,
        blocking: true,
        status: 'open',
      });
    }
  }
  spec.open_questions = openQuestions;
  spec.updated_at = now;

  const { created, existing } = await ctx.storage.ensureWorkspace();
  const specFile = await ctx.storage.writeJson('specJson', spec);
  await ctx.storage.writeArtifact('specMd', renderSpecMarkdown(spec));
  await ctx.storage.writeArtifact('changelogMd', `# SDD changelog\n\n- ${now}: инициализация SDD workspace (спецификация v${spec.version}).\n`);
  // Пустые артефакты остальных этапов (идемпотентно пересоздаются командами):
  await ctx.storage.writeArtifact('planMd', `# Технический план — ${spec.id}\n\nПлан ещё не сгенерирован. Выполните /sdd-plan generate после утверждения спецификации.\n`);
  await ctx.storage.writeJson('tasksJson', { schemaVersion: 1, spec_id: spec.id, plan_ref: '', tasks: [], updated_at: now });
  await ctx.storage.writeJson('traceabilityJson', {
    schemaVersion: 1,
    spec_id: spec.id,
    generated_at: now,
    rows: [],
    summary: { total: 0, covered: 0, partial: 0, uncovered: 0, coverage_ratio: 0 },
  });
  await ctx.storage.writeJson('validationReportJson', {
    schemaVersion: 1,
    spec_id: spec.id,
    generated_at: now,
    overall: 'blocked',
    feature_complete: false,
    checks: [],
    summary: { passed: 0, failed: 0, blocked: 0, skipped: 0, not_applicable: 0 },
  });

  ctx.logger.info(`sdd:init: создано файлов ${created.length}, уже существовало ${existing.length}`);
  return {
    ok: true,
    created: true,
    files: { created, existing, spec: specFile },
    answers_applied: applied,
    answers_rejected: rejected,
    next_step: 'Ответьте на вопросы интервью и передайте их: /sdd-init {"answers": {...}}, затем /sdd-spec validate.',
    questionnaire: INTERVIEW_QUESTIONS,
    open_questions: openQuestions,
  };
}

/** Ответ на открытый вопрос интервью (через sdd-spec answer). */
export function answerQuestion(spec: Spec, questionId: string, answer: string, now: string): Spec {
  const question = spec.open_questions.find((item) => item.id === questionId);
  if (!question) {
    throw new SddError('SDD_UNKNOWN_REFERENCE', `Вопрос «${questionId}» не найден в спецификации.`, {
      file: '.sdd/spec.json',
      field: 'open_questions',
      hint: `Доступные вопросы: ${spec.open_questions.map((item) => item.id).join(', ') || '—'}`,
    });
  }
  question.answer = answer;
  question.status = 'answered';
  spec.updated_at = now;
  return spec;
}
