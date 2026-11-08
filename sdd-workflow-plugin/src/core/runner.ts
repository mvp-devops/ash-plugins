/**
 * Запуск проверок реализации (build / typecheck / lint / tests) через
 * `ctx.subprocess`, когда служба смонтирована в профиле.
 *
 * Команды определяются по `package.json` рабочего пространства
 * (pnpm/npm scripts) — без shell-интерполяции: argv собирается явно.
 * Без `ctx.subprocess` проверки возвращают статус `blocked` с точной
 * причиной — плагин никогда не имитирует успешный результат.
 */

import type { CheckInput, CheckKind } from './validation.js';

/** Структурное определение `ctx.subprocess` DSH, которое использует плагин. */
export interface SubprocessLike {
  resolveExecutable(name: string): Promise<string>;
  spawn(request: {
    argv: string[];
    cwd: string;
    stdio: { stdin: string; stdout: unknown; stderr: unknown };
    graceMs?: number;
  }): {
    done: Promise<{ exitCode: number | null; signal: string | null }>;
    collected: { stdout?: { readFrom(offset: number): string }; stderr?: { readFrom(offset: number): string } };
  };
}

/** Команды проверки, определяемые по скриптам проекта. */
export interface ProjectCommands {
  packageManager: 'pnpm' | 'npm' | 'unknown';
  build?: string;
  typecheck?: string;
  lint?: string;
  test?: string;
}

/** Определить скрипты проверки из package.json рабочего пространства. */
export function detectProjectCommands(packageJsonRaw: unknown): ProjectCommands {
  const scripts =
    typeof packageJsonRaw === 'object' && packageJsonRaw !== null && !Array.isArray(packageJsonRaw)
      ? ((packageJsonRaw as Record<string, unknown>).scripts as Record<string, unknown> | undefined) ?? {}
      : {};
  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = scripts[name];
      if (typeof value === 'string' && value.trim() !== '') return name;
    }
    return undefined;
  };
  return {
    packageManager: 'pnpm',
    build: pick('build'),
    typecheck: pick('typecheck', 'type-check', 'check-types', 'tsc'),
    lint: pick('lint'),
    test: pick('test'),
  };
}

const MAX_BYTES = 64 * 1024;
const GRACE_MS = 30_000;

/** Запустить одну команду проверки. Ошибки запуска маппятся в blocked-проверку. */
export async function runCheck(
  subprocess: SubprocessLike,
  workspaceRoot: string,
  kind: CheckKind,
  script: string,
  packageManagerExecutable: string,
  packageManagerName: 'pnpm' | 'npm',
): Promise<CheckInput> {
  const argv = [packageManagerExecutable, 'run', script];
  const method = `${packageManagerName} run ${script}`;
  try {
    const handle = subprocess.spawn({
      argv,
      cwd: workspaceRoot,
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_BYTES }, stderr: { maxBytes: MAX_BYTES } },
      graceMs: GRACE_MS,
    });
    const { exitCode, signal } = await handle.done;
    const stdout = handle.collected.stdout?.readFrom(0) ?? '';
    const stderr = handle.collected.stderr?.readFrom(0) ?? '';
    const output = `${stdout}\n${stderr}`.trim();
    if (exitCode === 0) {
      return { kind, status: 'passed', method, actual: tail(output) || 'команда завершилась с кодом 0' };
    }
    return {
      kind,
      status: 'failed',
      method,
      actual: `код выхода ${exitCode}${signal ? ` (сигнал ${signal})` : ''}: ${tail(output)}`,
      probable_cause: 'изменения нарушили сборку/проверки; см. вывод команды',
      minimal_fix: 'исправьте ошибки из вывода команды и повторите sdd-validate',
    };
  } catch (error) {
    return {
      kind,
      status: 'blocked',
      method,
      actual: `запуск не удался: ${(error as Error).message}`,
      probable_cause: 'исполняемый файл пакетного менеджера недоступен или служба subprocess не смогла запустить процесс',
      minimal_fix: 'запустите команду вручную и запишите результат в отчёт через sdd-validate run --checks',
      blocking: false,
    };
  }
}

/**
 * Запустить набор проверок проекта. Отсутствующий скрипт — not_applicable;
 * недоступный subprocess — blocked для всех проверок.
 */
export async function runProjectChecks(
  subprocess: SubprocessLike | undefined,
  workspaceRoot: string,
  commands: ProjectCommands,
): Promise<CheckInput[]> {
  if (!subprocess) {
    return (['build', 'typecheck', 'lint', 'unit'] as CheckKind[]).map((kind) => ({
      kind,
      status: 'blocked' as const,
      method: 'не определено',
      actual: 'служба ctx.subprocess недоступна в этом профиле',
      probable_cause: 'профиль не монтирует dsh-subprocess(-local)',
      minimal_fix: 'смонтируйте @deepseek-ai/dsh-subprocess-local или запустите проверки вручную',
      blocking: false,
    }));
  }
  // Предпочитаемый пакетный менеджер — pnpm; при его отсутствии — npm.
  // Если ни один не резолвится — все проверки деградируют в blocked.
  const entries: { kind: CheckKind; script?: string }[] = [
    { kind: 'build', script: commands.build },
    { kind: 'typecheck', script: commands.typecheck },
    { kind: 'lint', script: commands.lint },
    { kind: 'unit', script: commands.test },
  ];
  let packageManagerExecutable: string | undefined;
  let packageManagerName: 'pnpm' | 'npm' = 'pnpm';
  try {
    packageManagerExecutable = await subprocess.resolveExecutable('pnpm');
  } catch {
    try {
      packageManagerExecutable = await subprocess.resolveExecutable('npm');
      packageManagerName = 'npm';
    } catch {
      packageManagerExecutable = undefined;
    }
  }
  if (packageManagerExecutable === undefined) {
    return entries.map((entry) => ({
      kind: entry.kind,
      status: 'blocked' as const,
      method: 'не определено',
      actual: 'пакетный менеджер (pnpm/npm) не найден в среде выполнения',
      probable_cause: 'resolveExecutable не нашёл ни pnpm, ни npm',
      minimal_fix: 'запустите проверки вручную и запишите результат через sdd-validate',
      blocking: false,
    }));
  }
  const resolved: CheckInput[] = [];
  for (const entry of entries) {
    if (!entry.script) {
      resolved.push({
        kind: entry.kind,
        status: 'not_applicable',
        method: 'не определено',
        actual: `в package.json нет скрипта для «${entry.kind}»`,
        blocking: false,
      });
      continue;
    }
    resolved.push(await runCheck(subprocess, workspaceRoot, entry.kind, entry.script, packageManagerExecutable, packageManagerName));
  }
  return resolved;
}

function tail(text: string, max = 2000): string {
  const clean = text.trim();
  return clean.length > max ? `…${clean.slice(clean.length - max)}` : clean;
}
