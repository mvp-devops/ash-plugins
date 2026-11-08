/**
 * Генератор задач из плана и управление статусами задач.
 *
 * Каждая задача атомарна, трассируема к требованиям и пунктам плана и не
 * может быть помечена `done` без объективного evidence (тесты, build, lint,
 * type-check или явная ручная проверка со ссылкой).
 */

import { ArtifactValidationError, SddError } from './errors.js';
import type { VerificationMethod } from './spec-model.js';
import type { Plan } from './plan-generator.js';
import type { Spec } from './spec-model.js';

/** Версия схемы задач. */
export const TASKS_SCHEMA_VERSION = 1;

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done';

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'blocked', 'review', 'done'];

/** Объективное доказательство выполнения задачи. */
export interface Evidence {
  kind: VerificationMethod;
  /** Ссылка: имя теста, команда, отчёт или описание ручной проверки. */
  reference: string;
  passed: boolean;
  recorded_at: string;
  /** Дополнительные детали (вывод команды, ссылка на лог). */
  detail?: string;
}

export interface Task {
  task_id: string;
  title: string;
  description: string;
  requirement_ids: string[];
  plan_item_ids: string[];
  files_to_change: string[];
  tests_to_add_or_update: string[];
  acceptance_criteria: string[];
  status: TaskStatus;
  evidence: Evidence[];
  dependencies: string[];
  updated_at: string;
}

export interface TaskBoard {
  schemaVersion: typeof TASKS_SCHEMA_VERSION;
  spec_id: string;
  plan_ref: string;
  tasks: Task[];
  updated_at: string;
}

let taskCounter = 0;

/** Генерация следующего идентификатора задачи (T-001, T-002, …). */
function nextTaskId(): string {
  taskCounter += 1;
  return `T-${String(taskCounter).padStart(3, '0')}`;
}

/** Сброс счётчика идентификаторов задач (для тестов). */
export function resetTaskCounter(start = 0): void {
  taskCounter = start;
}

/**
 * Преобразовать план в атомарные задачи: по задаче на пункт плана.
 * Acceptance criteria наследуются от связанных требований спецификации.
 */
export function generateTasks(spec: Spec, plan: Plan, now: string): TaskBoard {
  const criteriaByRequirement = new Map<string, string[]>();
  for (const criterion of spec.acceptance_criteria) {
    const list = criteriaByRequirement.get(criterion.requirement_id) ?? [];
    list.push(criterion.id);
    criteriaByRequirement.set(criterion.requirement_id, list);
  }

  const tasks: Task[] = plan.items.map((item) => {
    const requirements = item.requirement_ids;
    const criteria = [...new Set(requirements.flatMap((requirementId) => criteriaByRequirement.get(requirementId) ?? []))];
    return {
      task_id: nextTaskId(),
      title: item.title,
      description: item.description,
      requirement_ids: [...requirements],
      plan_item_ids: [item.id],
      files_to_change: [...item.files],
      tests_to_add_or_update: [],
      acceptance_criteria: criteria,
      status: 'todo' as const,
      evidence: [],
      dependencies: [],
      updated_at: now,
    };
  });

  return {
    schemaVersion: TASKS_SCHEMA_VERSION,
    spec_id: spec.id,
    plan_ref: plan.spec_id,
    tasks,
    updated_at: now,
  };
}

/** Структурный разбор сохранённого списка задач. */
export function parseTaskBoard(raw: unknown, file = '.sdd/tasks.json'): TaskBoard {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ArtifactValidationError('tasks.json должен быть JSON-объектом.', { file, hint: 'Перегенерируйте задачи командой sdd-tasks generate.' });
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== TASKS_SCHEMA_VERSION) {
    throw new ArtifactValidationError(`Неподдерживаемая schemaVersion задач: ${String(record.schemaVersion)}.`, {
      file,
      field: 'schemaVersion',
      hint: 'Перегенерируйте задачи командой sdd-tasks generate.',
    });
  }
  const tasks = Array.isArray(record.tasks) ? record.tasks : [];
  return {
    schemaVersion: TASKS_SCHEMA_VERSION,
    spec_id: String(record.spec_id ?? ''),
    plan_ref: String(record.plan_ref ?? ''),
    updated_at: String(record.updated_at ?? ''),
    tasks: tasks.map((task, index) => {
      if (typeof task !== 'object' || task === null) {
        throw new ArtifactValidationError(`tasks[${index}] должен быть объектом.`, { file, field: `tasks[${index}]` });
      }
      const entry = task as Record<string, unknown>;
      const status = TASK_STATUSES.includes(entry.status as TaskStatus) ? (entry.status as TaskStatus) : 'todo';
      const evidence = Array.isArray(entry.evidence)
        ? (entry.evidence as Evidence[]).filter((item) => item && typeof item === 'object' && typeof item.reference === 'string')
        : [];
      return {
        task_id: String(entry.task_id ?? `T-${index + 1}`),
        title: String(entry.title ?? ''),
        description: String(entry.description ?? ''),
        requirement_ids: Array.isArray(entry.requirement_ids) ? entry.requirement_ids.map(String) : [],
        plan_item_ids: Array.isArray(entry.plan_item_ids) ? entry.plan_item_ids.map(String) : [],
        files_to_change: Array.isArray(entry.files_to_change) ? entry.files_to_change.map(String) : [],
        tests_to_add_or_update: Array.isArray(entry.tests_to_add_or_update) ? entry.tests_to_add_or_update.map(String) : [],
        acceptance_criteria: Array.isArray(entry.acceptance_criteria) ? entry.acceptance_criteria.map(String) : [],
        status,
        evidence: evidence.map((item) => ({
          kind: (typeof item.kind === 'string' ? item.kind : 'manual') as VerificationMethod,
          reference: String(item.reference ?? ''),
          passed: Boolean(item.passed),
          recorded_at: String(item.recorded_at ?? ''),
          detail: typeof item.detail === 'string' ? item.detail : undefined,
        })),
        dependencies: Array.isArray(entry.dependencies) ? entry.dependencies.map(String) : [],
        updated_at: String(entry.updated_at ?? ''),
      };
    }),
  };
}

/**
 * Обновить статус задачи. Правило завершения: `done` требует хотя бы одного
 * пройденного evidence. Проверяются и зависимости: нельзя завершить задачу,
 * пока не завершены зависимые (кроме явного force=false → ошибка).
 */
export function updateTaskStatus(
  board: TaskBoard,
  taskId: string,
  status: TaskStatus,
  now: string,
  options: { evidence?: Evidence; force?: boolean } = {},
): { board: TaskBoard; task: Task } {
  const task = board.tasks.find((item) => item.task_id === taskId);
  if (!task) {
    throw new SddError('SDD_UNKNOWN_REFERENCE', `Задача «${taskId}» не найдена в .sdd/tasks.json.`, {
      file: '.sdd/tasks.json',
      hint: `Доступные задачи: ${board.tasks.map((item) => item.task_id).join(', ') || '—'}`,
    });
  }
  if (status === 'done' && !options.force) {
    const passed = task.evidence.some((item) => item.passed) || (options.evidence?.passed === true);
    if (!passed) {
      throw new SddError('SDD_EVIDENCE_REQUIRED', `Задачу «${taskId}» нельзя пометить done без объективного evidence.`, {
        file: '.sdd/tasks.json',
        field: `tasks.${taskId}.evidence`,
        hint: 'Передайте evidence: { kind, reference, passed: true } — имя теста, команда сборки/линта или описание ручной проверки.',
      });
    }
    const unfinished = task.dependencies
      .map((dependencyId) => board.tasks.find((item) => item.task_id === dependencyId))
      .filter((dependency): dependency is Task => dependency !== undefined)
      .filter((dependency) => dependency.status !== 'done');
    if (unfinished.length > 0) {
      throw new SddError('SDD_BLOCKERS_PRESENT', `Задача «${taskId}» зависит от незавершённых задач: ${unfinished.map((item) => item.task_id).join(', ')}.`, {
        file: '.sdd/tasks.json',
        hint: 'Сначала завершите зависимые задачи или измените dependencies.',
      });
    }
  }
  if (options.evidence) {
    task.evidence.push(options.evidence);
  }
  task.status = status;
  task.updated_at = now;
  board.updated_at = now;
  return { board, task };
}

/**
 * Порядок выполнения готовых задач: топологическая сортировка по
 * зависимостям, среди готовых — `todo` и `in_progress` без блокеров.
 * Циклические зависимости возвращаются как блокированные.
 */
export function readyTasks(board: TaskBoard): { ready: Task[]; blocked: { task: Task; reason: string }[] } {
  const byId = new Map(board.tasks.map((task) => [task.task_id, task]));
  const state = new Map<string, 'ok' | 'cycle'>();
  const blocked: { task: Task; reason: string }[] = [];

  const visit = (task: Task, stack: Set<string>): 'ok' | 'cycle' => {
    const cached = state.get(task.task_id);
    if (cached === 'ok') return 'ok';
    if (stack.has(task.task_id)) return 'cycle';
    stack.add(task.task_id);
    let result: 'ok' | 'cycle' = 'ok';
    for (const dependencyId of task.dependencies) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        result = 'cycle';
        break;
      }
      if (visit(dependency, stack) === 'cycle') {
        result = 'cycle';
        break;
      }
    }
    stack.delete(task.task_id);
    state.set(task.task_id, result);
    return result;
  };

  const ready: Task[] = [];
  for (const task of board.tasks) {
    if (task.status === 'done' || task.status === 'blocked') {
      if (task.status === 'blocked') blocked.push({ task, reason: 'явно помечена blocked' });
      continue;
    }
    const cycle = visit(task, new Set()) === 'cycle';
    if (cycle) {
      blocked.push({ task, reason: 'циклическая или битая зависимость' });
      continue;
    }
    const waiting = task.dependencies
      .map((dependencyId) => byId.get(dependencyId))
      .filter((dependency): dependency is Task => dependency !== undefined)
      .filter((dependency) => dependency.status !== 'done');
    if (waiting.length > 0) {
      blocked.push({ task, reason: `ожидает: ${waiting.map((item) => item.task_id).join(', ')}` });
      continue;
    }
    ready.push(task);
  }
  return { ready, blocked };
}
