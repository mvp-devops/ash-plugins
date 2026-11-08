/**
 * `/sdd:tasks` — преобразование плана в атомарные задачи и управление
 * статусами. Задача не может стать `done` без объективного evidence.
 * После любого изменения статуса пересчитывается traceability.json.
 */

import { ArtifactValidationError, SddError } from '../core/errors.js';
import { buildTraceability, type TraceabilityMatrix } from '../core/traceability.js';
import { generateTasks, parseTaskBoard, readyTasks, resetTaskCounter, TASK_STATUSES, updateTaskStatus, type Evidence, type TaskBoard, type TaskStatus } from '../core/task-generator.js';
import { loadPlan, loadSpec, loadTasks, nowIso, requireInitialized, requireSpec, type CommandContext } from './context.js';

/** Разбор evidence из аргументов команды. */
export function parseEvidence(raw: unknown, now: string): Evidence | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ArtifactValidationError('evidence должен быть объектом { kind, reference, passed, detail? }.', {
      file: '.sdd/tasks.json',
      field: 'evidence',
      hint: 'Пример: {"kind":"test","reference":"tests/unit/foo.test.js","passed":true}',
    });
  }
  const record = raw as Record<string, unknown>;
  const kinds = ['test', 'build', 'lint', 'typecheck', 'integration', 'manual'];
  if (typeof record.kind !== 'string' || !kinds.includes(record.kind)) {
    throw new ArtifactValidationError(`evidence.kind должен быть одним из: ${kinds.join(' | ')}.`, {
      file: '.sdd/tasks.json',
      field: 'evidence.kind',
      hint: 'Укажите тип объективного доказательства.',
    });
  }
  if (typeof record.reference !== 'string' || record.reference.trim() === '') {
    throw new ArtifactValidationError('evidence.reference должен быть непустой строкой (имя теста, команда или описание проверки).', {
      file: '.sdd/tasks.json',
      field: 'evidence.reference',
      hint: 'Например: "tests/unit/spec-validator.test.js: validateSpec"',
    });
  }
  const evidence: Evidence = {
    kind: record.kind as Evidence['kind'],
    reference: record.reference,
    passed: Boolean(record.passed),
    recorded_at: now,
  };
  if (typeof record.detail === 'string') evidence.detail = record.detail;
  return evidence;
}

/** Пересчитать traceability.json из текущих артефактов. */
export async function rebuildTraceability(ctx: CommandContext): Promise<TraceabilityMatrix | undefined> {
  const spec = await loadSpec(ctx);
  const plan = await loadPlan(ctx);
  const board = await loadTasks(ctx);
  if (!spec || !plan || !board) return undefined;
  const reportModule = await import('../core/validation.js');
  const previousReport = await ctx.storage.readJson('validationReportJson', reportModule.parseValidationReport).catch(() => undefined);
  const matrix = buildTraceability(spec, plan, board, previousReport, nowIso());
  await ctx.storage.writeJson('traceabilityJson', matrix);
  return matrix;
}

/** Выполнить `/sdd:tasks` (операции generate | update | list | ready). */
export async function runTasksCommand(
  ctx: CommandContext,
  args: {
    op?: string;
    task_id?: string;
    status?: string;
    evidence?: unknown;
    tests_to_add_or_update?: string[];
    files_to_change?: string[];
    dependencies?: string[];
    confirm_overwrite?: boolean;
  } = {},
): Promise<Record<string, unknown>> {
  await requireInitialized(ctx);
  const op = args.op ?? 'list';

  if (op === 'list') {
    const board = await loadTasks(ctx);
    if (!board) {
      throw new SddError('SDD_NOT_INITIALIZED', 'Задачи ещё не сгенерированы.', { file: '.sdd/tasks.json', hint: 'Выполните /sdd-tasks generate.' });
    }
    return { ok: true, tasks: board.tasks, summary: summarizeBoard(board) };
  }

  if (op === 'ready') {
    const board = await loadTasks(ctx);
    if (!board) {
      throw new SddError('SDD_NOT_INITIALIZED', 'Задачи ещё не сгенерированы.', { file: '.sdd/tasks.json', hint: 'Выполните /sdd-tasks generate.' });
    }
    const { ready, blocked } = readyTasks(board);
    return { ok: true, ready: ready.map((task) => task.task_id), blocked: blocked.map(({ task, reason }) => ({ task_id: task.task_id, reason })) };
  }

  if (op === 'update') {
    if (!args.task_id) {
      throw new ArtifactValidationError('Операция update требует task_id.', { file: '.sdd/tasks.json', hint: 'Пример: /sdd-tasks update {"task_id":"T-001","status":"done","evidence":{…}}' });
    }
    const status = args.status as TaskStatus | undefined;
    if (status !== undefined && !TASK_STATUSES.includes(status)) {
      throw new ArtifactValidationError(`status должен быть одним из: ${TASK_STATUSES.join(' | ')}.`, {
        file: '.sdd/tasks.json',
        field: 'status',
        hint: 'Разрешены: todo, in_progress, blocked, review, done.',
      });
    }
    const board = await loadTasks(ctx);
    if (!board) {
      throw new SddError('SDD_NOT_INITIALIZED', 'Задачи ещё не сгенерированы.', { file: '.sdd/tasks.json', hint: 'Выполните /sdd-tasks generate.' });
    }
    const now = nowIso();
    const evidence = parseEvidence(args.evidence, now);
    const task = board.tasks.find((item) => item.task_id === args.task_id);
    if (!task) {
      throw new SddError('SDD_UNKNOWN_REFERENCE', `Задача «${args.task_id}» не найдена.`, {
        file: '.sdd/tasks.json',
        hint: `Доступные задачи: ${board.tasks.map((item) => item.task_id).join(', ') || '—'}`,
      });
    }
    if (Array.isArray(args.tests_to_add_or_update)) task.tests_to_add_or_update = args.tests_to_add_or_update.map(String);
    if (Array.isArray(args.files_to_change)) task.files_to_change = args.files_to_change.map(String);
    if (Array.isArray(args.dependencies)) task.dependencies = args.dependencies.map(String);
    let updatedTask;
    if (status !== undefined) {
      ({ task: updatedTask } = updateTaskStatus(board, task.task_id, status, now, { evidence }));
    } else if (evidence) {
      task.evidence.push(evidence);
      task.updated_at = now;
      board.updated_at = now;
      updatedTask = task;
    } else {
      updatedTask = task;
    }
    await ctx.storage.writeJson('tasksJson', board);
    const matrix = await rebuildTraceability(ctx);
    ctx.logger.info(`sdd:tasks: ${task.task_id} → ${updatedTask.status}`);
    return { ok: true, task: updatedTask, summary: summarizeBoard(board), traceability: matrix?.summary };
  }

  // generate
  const spec = await requireSpec(ctx);
  const plan = await loadPlan(ctx);
  if (!plan) {
    throw new SddError('SDD_BLOCKERS_PRESENT', 'Для генерации задач нужен план.', { file: '.sdd/plan.json', hint: 'Сначала выполните /sdd-plan generate.' });
  }
  const existing = await loadTasks(ctx);
  if (existing && existing.tasks.length > 0 && !args.confirm_overwrite) {
    throw new SddError('SDD_OVERWRITE_DECLINED', 'Список задач уже существует; перегенерация сбросит статусы и evidence.', {
      file: '.sdd/tasks.json',
      hint: 'Передайте confirm_overwrite: true, чтобы перегенерировать задачи.',
    });
  }
  resetTaskCounter(0);
  const board: TaskBoard = generateTasks(spec, plan, nowIso());
  await ctx.storage.writeJson('tasksJson', board);
  const matrix = await rebuildTraceability(ctx);
  return {
    ok: true,
    tasks: board.tasks,
    summary: summarizeBoard(board),
    traceability: matrix?.summary,
    next_step: 'Реализуйте задачи: /sdd-implement queue, затем /sdd-implement record {…} с evidence.',
  };
}

/** Сводка по списку задач. */
export function summarizeBoard(board: TaskBoard): Record<string, number | string> {
  const counts: Record<string, number> = { todo: 0, in_progress: 0, blocked: 0, review: 0, done: 0 };
  for (const task of board.tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return { total: board.tasks.length, ...counts, updated_at: board.updated_at };
}

/** Разобрать список задач из сохранённого JSON (используется тестами). */
export function parseTasksArtifact(raw: unknown): TaskBoard {
  return parseTaskBoard(raw, '.sdd/tasks.json');
}
