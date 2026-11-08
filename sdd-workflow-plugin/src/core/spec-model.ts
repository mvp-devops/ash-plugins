/**
 * Модель спецификации SDD и структурный (типизированный) разбор spec.json.
 *
 * Спецификация — первичный артефакт и источник истины. Модель фиксирована
 * схемой `schemas/spec.schema.json`; разбор здесь — структурная проверка
 * без внешних зависимостей (ajv не нужен).
 */

import { ArtifactValidationError } from './errors.js';

/** Версия схемы spec.json. */
export const SPEC_SCHEMA_VERSION = 1;

export type SpecStatus = 'draft' | 'review' | 'approved' | 'deprecated';
export type Priority = 'must' | 'should' | 'could';
export type VerificationMethod = 'test' | 'build' | 'lint' | 'typecheck' | 'integration' | 'manual';
export type QuestionStatus = 'open' | 'answered' | 'tbd';
export type IssueSeverity = 'blocker' | 'major' | 'minor' | 'info';

export interface UserStory {
  id: string;
  as_a: string;
  i_want: string;
  so_that: string;
  priority: Priority;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  priority: Priority;
}

export interface AcceptanceCriterion {
  id: string;
  requirement_id: string;
  statement: string;
  verification: VerificationMethod;
}

export interface Contract {
  id: string;
  name: string;
  description: string;
  requirement_ids: string[];
}

export interface EdgeCase {
  id: string;
  description: string;
  expected_behavior: string;
  requirement_ids: string[];
}

export interface Constraint {
  id: string;
  description: string;
}

export interface Risk {
  id: string;
  description: string;
  mitigation: string;
}

export interface OpenQuestion {
  id: string;
  question: string;
  blocking: boolean;
  status: QuestionStatus;
  answer?: string;
}

/** Машиночитаемая спецификация фичи (`.sdd/spec.json`). */
export interface Spec {
  schemaVersion: typeof SPEC_SCHEMA_VERSION;
  id: string;
  title: string;
  version: string;
  status: SpecStatus;
  owner: string;
  goal: string;
  scope: string;
  out_of_scope: string[];
  user_stories: UserStory[];
  functional_requirements: Requirement[];
  non_functional_requirements: Requirement[];
  acceptance_criteria: AcceptanceCriterion[];
  data_contracts: Contract[];
  api_contracts: Contract[];
  edge_cases: EdgeCase[];
  constraints: Constraint[];
  risks: Risk[];
  definition_of_done: string[];
  open_questions: OpenQuestion[];
  updated_at: string;
}

/** Поля, обязательные для перехода к плану (или явно помеченные TBD). */
export const CRITICAL_SPEC_FIELDS = [
  'id',
  'title',
  'goal',
  'scope',
] as const;

export const TBD = 'TBD';

/** Пустая спецификация-черновик (идемпотентная инициализация). */
export function emptySpec(now: string): Spec {
  return {
    schemaVersion: SPEC_SCHEMA_VERSION,
    id: TBD,
    title: TBD,
    version: '0.1.0',
    status: 'draft',
    owner: TBD,
    goal: TBD,
    scope: TBD,
    out_of_scope: [],
    user_stories: [],
    functional_requirements: [],
    non_functional_requirements: [],
    acceptance_criteria: [],
    data_contracts: [],
    api_contracts: [],
    edge_cases: [],
    constraints: [],
    risks: [],
    definition_of_done: [],
    open_questions: [],
    updated_at: now,
  };
}

const PRIORITIES: readonly Priority[] = ['must', 'should', 'could'];
const VERIFICATIONS: readonly VerificationMethod[] = ['test', 'build', 'lint', 'typecheck', 'integration', 'manual'];
const STATUSES: readonly SpecStatus[] = ['draft', 'review', 'approved', 'deprecated'];
const QUESTION_STATUSES: readonly QuestionStatus[] = ['open', 'answered', 'tbd'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(file: string, field: string, expected: string, actual: unknown): never {
  throw new ArtifactValidationError(
    `Некорректное значение поля «${field}»: ожидалось ${expected}, получено ${describe(actual)}.`,
    { file, field, hint: `Приведите поле «${field}» к типу ${expected} или перегенерируйте артефакт.` },
  );
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'массив';
  return `${typeof value} (${JSON.stringify(value)?.slice(0, 60) ?? '?'})`;
}

function readString(input: Record<string, unknown>, field: string, file: string): string {
  const value = input[field];
  if (typeof value !== 'string') fail(file, field, 'строка', value);
  return value;
}

function readStringArray(input: Record<string, unknown>, field: string, file: string): string[] {
  const value = input[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(file, field, 'массив строк', value);
  }
  return value as string[];
}

function readEnum<T extends string>(input: Record<string, unknown>, field: string, allowed: readonly T[], file: string): T {
  const value = input[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(file, field, `одно из: ${allowed.join(' | ')}`, value);
  }
  return value as T;
}

function readRecordArray(
  input: Record<string, unknown>,
  field: string,
  file: string,
  readItem: (item: Record<string, unknown>, index: number) => unknown,
): unknown[] {
  const value = input[field];
  if (!Array.isArray(value)) fail(file, field, 'массив объектов', value);
  return (value as unknown[]).map((item, index) => {
    if (!isRecord(item)) fail(file, `${field}[${index}]`, 'объект', item);
    return readItem(item, index);
  });
}

function readId(item: Record<string, unknown>, field: string, file: string, index: number): string {
  const value = item.id;
  if (typeof value !== 'string' || value.trim() === '') {
    fail(file, `${field}[${index}].id`, 'непустая строка', value);
  }
  return value;
}

function readPriority(item: Record<string, unknown>, kindLabel: string, index: number): Priority {
  const value = item.priority ?? 'must';
  if (typeof value !== 'string' || !PRIORITIES.includes(value as Priority)) {
    fail(kindLabel === 'user_stories' ? '.sdd/spec.json' : '.sdd/spec.json', `${kindLabel}[${index}].priority`, `одно из: ${PRIORITIES.join(' | ')}`, value);
  }
  return value as Priority;
}

/**
 * Структурный разбор spec.json в типизированную модель.
 * Бросает {@link ArtifactValidationError} с указанием файла и поля.
 */
export function parseSpec(raw: unknown, file = '.sdd/spec.json'): Spec {
  if (!isRecord(raw)) {
    throw new ArtifactValidationError('spec.json должен быть JSON-объектом.', {
      file,
      hint: 'Пересоздайте артефакт командой sdd-spec set.',
    });
  }
  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== SPEC_SCHEMA_VERSION) {
    throw new ArtifactValidationError(
      `Неподдерживаемая schemaVersion спецификации: ожидалось ${SPEC_SCHEMA_VERSION}, получено ${String(schemaVersion)}.`,
      { file, field: 'schemaVersion', hint: 'Обновите плагин или перегенерируйте spec.json.' },
    );
  }

  const updated_at = readString(raw, 'updated_at', file);
  const user_stories = readRecordArray(raw, 'user_stories', file, (item, index) => ({
    id: readId(item, 'user_stories', file, index),
    as_a: typeof item.as_a === 'string' ? item.as_a : fail(file, `user_stories[${index}].as_a`, 'строка', item.as_a),
    i_want: typeof item.i_want === 'string' ? item.i_want : fail(file, `user_stories[${index}].i_want`, 'строка', item.i_want),
    so_that: typeof item.so_that === 'string' ? item.so_that : fail(file, `user_stories[${index}].so_that`, 'строка', item.so_that),
    priority: readPriority(item, 'user_stories', index),
  })) as UserStory[];

  const readRequirement = (item: Record<string, unknown>, index: number): Requirement => ({
    id: readId(item, 'functional_requirements', file, index),
    title: typeof item.title === 'string' ? item.title : fail(file, `requirements[${index}].title`, 'строка', item.title),
    description: typeof item.description === 'string' ? item.description : '',
    priority: readPriority(item, 'requirements', index),
  });

  const criterionVerification = (item: Record<string, unknown>, index: number): VerificationMethod => {
    const value = item.verification;
    if (typeof value !== 'string' || !VERIFICATIONS.includes(value as VerificationMethod)) {
      fail(file, `acceptance_criteria[${index}].verification`, `одно из: ${VERIFICATIONS.join(' | ')}`, value);
    }
    return value as VerificationMethod;
  };

  const readContract = (item: Record<string, unknown>, index: number, kind: string): Contract => ({
    id: readId(item, kind, file, index),
    name: typeof item.name === 'string' ? item.name : fail(file, `${kind}[${index}].name`, 'строка', item.name),
    description: typeof item.description === 'string' ? item.description : '',
    requirement_ids: Array.isArray(item.requirement_ids) && item.requirement_ids.every((v) => typeof v === 'string')
      ? (item.requirement_ids as string[])
      : fail(file, `${kind}[${index}].requirement_ids`, 'массив строк', item.requirement_ids),
  });

  const readEdgeCase = (item: Record<string, unknown>, index: number): EdgeCase => ({
    id: readId(item, 'edge_cases', file, index),
    description:
      typeof item.description === 'string' ? item.description : fail(file, `edge_cases[${index}].description`, 'строка', item.description),
    expected_behavior:
      typeof item.expected_behavior === 'string'
        ? item.expected_behavior
        : fail(file, `edge_cases[${index}].expected_behavior`, 'строка', item.expected_behavior),
    requirement_ids: Array.isArray(item.requirement_ids) && item.requirement_ids.every((v) => typeof v === 'string')
      ? (item.requirement_ids as string[])
      : fail(file, `edge_cases[${index}].requirement_ids`, 'массив строк', item.requirement_ids),
  });

  const readOpenQuestion = (item: Record<string, unknown>, index: number): OpenQuestion => {
    const statusValue = item.status;
    if (typeof statusValue !== 'string' || !QUESTION_STATUSES.includes(statusValue as QuestionStatus)) {
      fail(file, `open_questions[${index}].status`, `одно из: ${QUESTION_STATUSES.join(' | ')}`, statusValue);
    }
    const question: OpenQuestion = {
      id: readId(item, 'open_questions', file, index),
      question: typeof item.question === 'string' ? item.question : fail(file, `open_questions[${index}].question`, 'строка', item.question),
      blocking: Boolean(item.blocking),
      status: statusValue as QuestionStatus,
    };
    if (typeof item.answer === 'string') question.answer = item.answer;
    return question;
  };

  const acceptance_criteria = (readRecordArray(raw, 'acceptance_criteria', file, (item, index) => ({
    id: readId(item, 'acceptance_criteria', file, index),
    requirement_id:
      typeof item.requirement_id === 'string'
        ? item.requirement_id
        : fail(file, `acceptance_criteria[${index}].requirement_id`, 'строка', item.requirement_id),
    statement:
      typeof item.statement === 'string' ? item.statement : fail(file, `acceptance_criteria[${index}].statement`, 'строка', item.statement),
    verification: criterionVerification(item, index),
  })) as AcceptanceCriterion[]).slice();

  const spec: Spec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    id: readString(raw, 'id', file),
    title: readString(raw, 'title', file),
    version: readString(raw, 'version', file),
    status: readEnum(raw, 'status', STATUSES, file) as SpecStatus,
    owner: readString(raw, 'owner', file),
    goal: readString(raw, 'goal', file),
    scope: readString(raw, 'scope', file),
    out_of_scope: readStringArray(raw, 'out_of_scope', file),
    user_stories,
    functional_requirements: readRecordArray(raw, 'functional_requirements', file, readRequirement) as Requirement[],
    non_functional_requirements: readRecordArray(raw, 'non_functional_requirements', file, readRequirement) as Requirement[],
    acceptance_criteria,
    data_contracts: readRecordArray(raw, 'data_contracts', file, (item, index) => readContract(item, index, 'data_contracts')) as Contract[],
    api_contracts: readRecordArray(raw, 'api_contracts', file, (item, index) => readContract(item, index, 'api_contracts')) as Contract[],
    edge_cases: readRecordArray(raw, 'edge_cases', file, readEdgeCase) as EdgeCase[],
    constraints: readRecordArray(raw, 'constraints', file, (item, index) => ({
      id: readId(item, 'constraints', file, index),
      description:
        typeof item.description === 'string' ? item.description : fail(file, `constraints[${index}].description`, 'строка', item.description),
    })) as Constraint[],
    risks: readRecordArray(raw, 'risks', file, (item, index) => ({
      id: readId(item, 'risks', file, index),
      description: typeof item.description === 'string' ? item.description : fail(file, `risks[${index}].description`, 'строка', item.description),
      mitigation: typeof item.mitigation === 'string' ? item.mitigation : '',
    })) as Risk[],
    definition_of_done: readStringArray(raw, 'definition_of_done', file),
    open_questions: readRecordArray(raw, 'open_questions', file, readOpenQuestion) as OpenQuestion[],
    updated_at,
  };
  return spec;
}

/** Вопросы интервью /sdd:init — то, что плагин спрашивает у пользователя. */
export const INTERVIEW_QUESTIONS: { field: string; question: string; why: string }[] = [
  { field: 'id', question: 'Идентификатор фичи (например, FEAT-001)?', why: 'стабильная ссылка для трассируемости' },
  { field: 'title', question: 'Короткое название фичи?', why: 'заголовок спецификации и плана' },
  { field: 'owner', question: 'Кто владелец спецификации?', why: 'ответственность за изменения требований' },
  { field: 'goal', question: 'Какова цель фичи и какую проблему она решает?', why: 'критическое поле' },
  { field: 'scope', question: 'Что входит в объём (scope)?', why: 'критическое поле' },
  { field: 'out_of_scope', question: 'Что явно НЕ входит в объём?', why: 'защита от расползания требований' },
  { field: 'user_stories', question: 'Кто пользователи и их сценарии (as a / I want / so that)?', why: 'основа требований' },
  { field: 'functional_requirements', question: 'Функциональные требования?', why: 'основа плана и задач' },
  { field: 'non_functional_requirements', question: 'Нефункциональные требования (производительность, безопасность, …)?', why: 'ограничивает реализацию' },
  { field: 'acceptance_criteria', question: 'Критерии приёмки для каждого требования?', why: 'объективная проверка завершения' },
  { field: 'data_contracts', question: 'Контракты данных (структуры, хранилище)?', why: 'влияют на схему и миграции' },
  { field: 'api_contracts', question: 'Контракты API (эндпоинты, инструменты, события)?', why: 'границы интеграции' },
  { field: 'edge_cases', question: 'Edge cases и ожидаемое поведение?', why: 'скрытые требования' },
  { field: 'constraints', question: 'Ограничения (стек, зависимости, совместимость)?', why: 'рамки реализации' },
  { field: 'risks', question: 'Риски и способы их снижения?', why: 'план рисков и rollback' },
  { field: 'definition_of_done', question: 'Definition of done?', why: 'финальный чек-лист' },
];
