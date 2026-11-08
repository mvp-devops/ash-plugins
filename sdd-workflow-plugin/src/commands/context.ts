/**
 * Общий контекст выполнения команд SDD: хранилище, созданное от рабочего
 * пространства конкретной сессии, доступ к службам DSH и общие операции
 * (чтение спецификации, задачи, плана, проверка инициализации).
 */

import { SddError } from '../core/errors.js';
import { parseSpec, type Spec } from '../core/spec-model.js';
import { validateSpec, type SpecIssue } from '../core/spec-validator.js';
import { DshFsAdapter, NodeFsAdapter, SddStorage, type DshFsLike, type FsAdapter } from '../core/storage.js';
import type { SubprocessLike } from '../core/runner.js';
import { parseTaskBoard, type TaskBoard } from '../core/task-generator.js';
import { parsePlan, type Plan } from '../core/plan-generator.js';

/** Службы DSH, используемые плагином (структурная типизация на границе). */
export interface HarnessServices {
  /** `ctx.fs` — файловая служба (может отсутствовать). */
  fs?: DshFsLike;
  /** `ctx.workingDirectory.get(session)` — корень рабочего пространства сессии. */
  workingDirectory?: { get(session: unknown): string | undefined };
  /** `ctx.subprocess` — служба дочерних процессов (может отсутствовать). */
  subprocess?: SubprocessLike;
  /** Логгер cordis (может отсутствовать). */
  logger?: { debug?(message: string): void; info?(message: string): void; warn?(message: string): void; error?(message: string): void };
}

/** Контекст одной команды. */
export interface CommandContext {
  storage: SddStorage;
  fs: FsAdapter;
  workspaceRoot: string;
  subprocess?: SubprocessLike;
  logger: { debug(message: string): void; info(message: string): void; warn(message: string): void; error(message: string): void };
}

/** Собрать контекст команды из служб Harness и сессии агента. */
export function buildContext(services: HarnessServices, session: unknown): CommandContext {
  const noop = (): void => {};
  const logger = {
    debug: (message: string): void => services.logger?.debug?.(message) ?? noop(),
    info: (message: string): void => services.logger?.info?.(message) ?? noop(),
    warn: (message: string): void => services.logger?.warn?.(message) ?? noop(),
    error: (message: string): void => services.logger?.error?.(message) ?? noop(),
  };
  let workspaceRoot: string | undefined;
  try {
    workspaceRoot = services.workingDirectory?.get(session);
  } catch {
    workspaceRoot = undefined;
  }
  if (!workspaceRoot) {
    throw new SddError('SDD_NOT_INITIALIZED', 'У сессии нет рабочего каталога: команды SDD работают с файлами проекта.', {
      hint: 'Откройте сессию с рабочим каталогом (workspace) и повторите команду.',
    });
  }
  logger.debug(`sdd: рабочее пространство ${workspaceRoot === '' ? '.' : '(корень сессии)'}`);
  const fs: FsAdapter = services.fs ? new DshFsAdapter(services.fs, workspaceRoot) : new NodeFsAdapter(workspaceRoot);
  return { storage: new SddStorage(fs), fs, workspaceRoot, subprocess: services.subprocess, logger };
}

/** Требовать инициализированный SDD workspace. */
export async function requireInitialized(ctx: CommandContext): Promise<void> {
  if (!(await ctx.storage.isInitialized())) {
    throw new SddError('SDD_NOT_INITIALIZED', 'SDD workspace не инициализирован: файл .sdd/spec.json не найден.', {
      file: '.sdd/spec.json',
      hint: 'Сначала выполните /sdd-init (или /sdd init).',
    });
  }
}

/** Прочитать спецификацию или бросить понятную ошибку. */
export async function requireSpec(ctx: CommandContext): Promise<Spec> {
  const spec = await ctx.storage.readJson('specJson', parseSpec);
  if (!spec) {
    throw new SddError('SDD_NOT_INITIALIZED', 'Файл .sdd/spec.json не найден.', {
      file: '.sdd/spec.json',
      hint: 'Сначала выполните /sdd-init.',
    });
  }
  return spec;
}

/** Прочитать спецификацию, если она есть. */
export async function loadSpec(ctx: CommandContext): Promise<Spec | undefined> {
  return ctx.storage.readJson('specJson', parseSpec);
}

/** Прочитать задачи, если они есть. */
export async function loadTasks(ctx: CommandContext): Promise<TaskBoard | undefined> {
  return ctx.storage.readJson('tasksJson', parseTaskBoard);
}

/** Прочитать план, если он есть. */
export async function loadPlan(ctx: CommandContext): Promise<Plan | undefined> {
  return ctx.storage.readJson('planJson', parsePlan);
}

/** Валидировать спецификацию и вернуть находки. */
export function specIssues(spec: Spec): SpecIssue[] {
  return validateSpec(spec);
}

/** Текущая метка времени в ISO. */
export function nowIso(): string {
  return new Date().toISOString();
}
