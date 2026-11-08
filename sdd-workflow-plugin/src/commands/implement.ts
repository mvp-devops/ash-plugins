/**
 * `/sdd:implement` — управляемая реализация задач.
 *
 * Плагин не редактирует код сам: он выдаёт исполнителю (агенту) упорядоченную
 * очередь готовых задач с обязательными правилами (анализ кода, стиль
 * проекта, тесты не ломаются) и принимает обратно объективный evidence.
 * Статус задачи меняется только при пройденном evidence; результат
 * фиксируется в validation-report.json и traceability.json.
 */

import { ArtifactValidationError, SddError } from '../core/errors.js';
import { buildValidationReport, parseValidationReport, type CheckInput } from '../core/validation.js';
import { readyTasks, type Evidence, type TaskBoard } from '../core/task-generator.js';
import type { CommandContext } from './context.js';
import { loadPlan, loadSpec, loadTasks, nowIso, requireInitialized } from './context.js';
import { parseEvidence, rebuildTraceability } from './tasks.js';

/** Правила реализации, выдаваемые исполнителю вместе с задачей. */
export const IMPLEMENTATION_RULES = [
  'Перед изменениями: проанализируйте существующий код, определите фреймворки, версии, conventions и test setup.',
  'Не ломайте существующие тесты; перед завершением запустите релевантные проверки проекта.',
  'Следуйте стилю проекта; минимально инвазивные изменения в файлах из files_to_change.',
  'Создайте или обновите тесты из tests_to_add_or_update — задача без тестов не считается выполненной.',
  'Верните evidence: { kind, reference, passed, detail? } — имя теста, команду или описание ручной проверки.',
] as const;

/** Выполнить `/sdd:implement` (операции queue | record). */
export async function runImplementCommand(
  ctx: CommandContext,
  args: { op?: string; task_id?: string; task_ids?: string[]; status?: string; evidence?: unknown; tests_to_add_or_update?: string[]; files_changed?: string[] } = {},
): Promise<Record<string, unknown>> {
  await requireInitialized(ctx);
  const op = args.op ?? 'queue';
  const board = await loadTasks(ctx);
  if (!board) {
    throw new SddError('SDD_NOT_INITIALIZED', 'Задачи ещё не сгенерированы.', { file: '.sdd/tasks.json', hint: 'Выполните /sdd-tasks generate.' });
  }

  if (op === 'queue') {
    const plan = await loadPlan(ctx);
    const spec = await loadSpec(ctx);
    const { ready, blocked } = readyTasks(board);
    const selected = selectTasks(board, args.task_ids);
    return {
      ok: true,
      rules: IMPLEMENTATION_RULES,
      project_context: {
        spec_id: spec?.id ?? null,
        plan_files: plan ? [...new Set(plan.items.flatMap((item) => item.files))] : [],
      },
      queue: selected.map((task) => ({
        task_id: task.task_id,
        title: task.title,
        description: task.description,
        requirement_ids: task.requirement_ids,
        acceptance_criteria: task.acceptance_criteria,
        files_to_change: task.files_to_change,
        tests_to_add_or_update: task.tests_to_add_or_update,
        dependencies: task.dependencies,
      })),
      ready_count: ready.length,
      blocked: blocked.map(({ task, reason }) => ({ task_id: task.task_id, reason })),
      next_step: 'Реализуйте задачи по очереди и фиксируйте результаты: /sdd-implement record {"task_id":"T-001","evidence":{…}}.',
    };
  }

  // record
  if (!args.task_id) {
    throw new ArtifactValidationError('Операция record требует task_id.', { file: '.sdd/tasks.json', hint: 'Пример: /sdd-implement record {"task_id":"T-001","evidence":{…}}' });
  }
  const task = board.tasks.find((item) => item.task_id === args.task_id);
  if (!task) {
    throw new SddError('SDD_UNKNOWN_REFERENCE', `Задача «${args.task_id}» не найдена.`, {
      file: '.sdd/tasks.json',
      hint: `Доступные задачи: ${board.tasks.map((item) => item.task_id).join(', ') || '—'}`,
    });
  }
  const now = nowIso();
  const evidence: Evidence | undefined = parseEvidence(args.evidence, now);
  if (!evidence) {
    throw new ArtifactValidationError('Операция record требует evidence: { kind, reference, passed }.', {
      file: '.sdd/tasks.json',
      hint: 'Без объективного доказательства статус задачи не меняется.',
    });
  }
  if (Array.isArray(args.tests_to_add_or_update)) task.tests_to_add_or_update = args.tests_to_add_or_update.map(String);
  if (Array.isArray(args.files_changed)) task.files_to_change = [...new Set([...task.files_to_change, ...args.files_changed.map(String)])];

  task.evidence.push(evidence);
  // Статус меняется только при успешном результате.
  const requestedStatus = args.status as TaskBoard['tasks'][number]['status'] | undefined;
  if (evidence.passed) {
    task.status = requestedStatus ?? (task.evidence.some((item) => item.passed) ? 'review' : task.status);
    if (requestedStatus === 'done' || task.status === 'done') {
      // done требует обновляемого статуса через updateTaskStatus (проверит зависимости).
      const { updateTaskStatus } = await import('../core/task-generator.js');
      updateTaskStatus(board, task.task_id, 'done', now);
    }
  } else if (requestedStatus) {
    task.status = requestedStatus;
  } else {
    task.status = 'blocked';
  }
  task.updated_at = now;
  board.updated_at = now;
  await ctx.storage.writeJson('tasksJson', board);

  // Записать результат в validation-report.json.
  const check: CheckInput = {
    kind: evidence.kind === 'test' ? 'unit' : evidence.kind === 'integration' ? 'integration' : evidence.kind === 'build' ? 'build' : evidence.kind === 'lint' ? 'lint' : evidence.kind === 'typecheck' ? 'typecheck' : 'criterion',
    status: evidence.passed ? 'passed' : 'failed',
    method: evidence.reference,
    actual: evidence.detail ?? (evidence.passed ? 'проверка пройдена' : 'проверка не пройдена'),
    requirement_id: task.requirement_ids[0],
    probable_cause: evidence.passed ? undefined : 'реализация не соответствует критерию',
    minimal_fix: evidence.passed ? undefined : 'устраните причину из detail и повторите проверку',
  };
  const existingReport = await ctx.storage.readJson('validationReportJson', parseValidationReport);
  const spec = await loadSpec(ctx);
  const report = buildValidationReport(spec?.id ?? '', [...(existingReport?.checks.filter((item) => item.method !== check.method || item.status !== check.status) ?? []), check], nowIso());
  await ctx.storage.writeJson('validationReportJson', report);
  const matrix = await rebuildTraceability(ctx);

  ctx.logger.info(`sdd:implement: ${task.task_id} evidence (${evidence.kind}, passed=${String(evidence.passed)}) → статус ${task.status}`);
  return {
    ok: true,
    task,
    check: report.checks.at(-1),
    validation_overall: report.overall,
    traceability: matrix?.summary,
  };
}

/** Выбрать подмножество задач (task_ids) или все готовые. */
function selectTasks(board: TaskBoard, taskIds?: string[]): TaskBoard['tasks'] {
  if (!taskIds || taskIds.length === 0) {
    return readyTasks(board).ready;
  }
  const missing = taskIds.filter((taskId) => !board.tasks.some((task) => task.task_id === taskId));
  if (missing.length > 0) {
    throw new SddError('SDD_UNKNOWN_REFERENCE', `Задачи не найдены: ${missing.join(', ')}.`, {
      file: '.sdd/tasks.json',
      hint: `Доступные задачи: ${board.tasks.map((task) => task.task_id).join(', ')}`,
    });
  }
  return taskIds.map((taskId) => board.tasks.find((task) => task.task_id === taskId) as TaskBoard['tasks'][number]);
}
