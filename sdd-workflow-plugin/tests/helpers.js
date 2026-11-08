/**
 * Общие помощники тестов: mock-контекст Harness (те же контракты, что у
 * ctx.commands / ctx.tools / ctx.fs / ctx.workingDirectory / ctx.subprocess)
 * поверх временного каталога.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Mock-файловая служба в формате ctx.fs DSH (целевой объект — абсолютный путь). */
export function makeDshFsLike(workspace) {
  const root = path.resolve(workspace);
  const inside = (target) => {
    const resolved = path.resolve(target);
    return resolved === root || resolved.startsWith(root + path.sep);
  };
  return {
    async resolve(relativePath, options = {}) {
      const base = options.cwd ?? root;
      const target = path.resolve(base, relativePath);
      if (!inside(target)) {
        const error = new Error(`путь вне рабочего пространства: ${relativePath}`);
        error.code = 'FS_SANDBOX_DENIED';
        throw error;
      }
      return target;
    },
    async stat(target) {
      try {
        const info = await fsp.stat(target);
        return info.isFile() ? { type: 'file', size: info.size, version: 'v1' } : { type: 'directory', version: 'v1' };
      } catch {
        return undefined;
      }
    },
    async readText(target) {
      return fsp.readFile(target, 'utf8');
    },
    async writeText(target, content) {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, 'utf8');
    },
    async moveFile(source, destination) {
      await fsp.rename(source, destination);
    },
    async listDir(target) {
      const entries = await fsp.readdir(target, { withFileTypes: true });
      return entries.map((entry) => ({ name: entry.name, type: entry.isFile() ? 'file' : 'directory' }));
    },
    async deleteFile(target) {
      await fsp.rm(target, { force: true });
    },
  };
}

/**
 * Mock-контекст cordis: регистрации собираются в `registered`, службы
 * работают поверх временного каталога.
 */
export function makeHarness({ workspace, subprocess } = {}) {
  const registered = { commands: [], tools: [], effects: [] };
  const ctx = {
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    effect(fn, label) {
      registered.effects.push(label ?? '');
      return fn();
    },
    commands: {
      register(definition) {
        registered.commands.push(definition);
        return () => {};
      },
    },
    tools: {
      register(definition) {
        registered.tools.push(definition);
        return () => {};
      },
    },
    workingDirectory: { get: () => workspace },
    subprocess,
    fs: workspace ? makeDshFsLike(workspace) : undefined,
  };
  return { ctx, registered };
}

/** Временное рабочее пространство с минимальным package.json проекта. */
export async function makeWorkspace({ scripts } = {}) {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'sdd-ws-'));
  await fsp.writeFile(
    path.join(workspace, 'package.json'),
    `${JSON.stringify({ name: 'fixture-project', version: '1.0.0', scripts: scripts ?? { test: 'node --test', lint: 'eslint .' } }, null, 2)}\n`,
    'utf8',
  );
  return workspace;
}

/** Запустить зарегистрированную сессионную команду и разобрать её ответ. */
export async function runCommand(registered, name, args = {}, session = { id: 's1' }) {
  const command = registered.commands.find((definition) => definition.name === name);
  if (!command) throw new Error(`команда ${name} не зарегистрирована`);
  const outcome = await command.handler({ agent: { session }, rawInput: JSON.stringify(args), signal: undefined });
  return { kind: outcome.kind, payload: JSON.parse(outcome.text) };
}

/** Запустить agent-инструмент. */
export async function runTool(registered, name, args = {}, session = { id: 's1' }) {
  const tool = registered.tools.find((definition) => definition.name === name);
  if (!tool) throw new Error(`инструмент ${name} не зарегистрирован`);
  return tool.execute(args, { agent: { session }, signal: undefined });
}

/** Fake `ctx.subprocess`: фиксированные коды выхода по имени скрипта. */
export function makeFakeSubprocess(exitCodes, executable = '/fake/pnpm') {
  return {
    async resolveExecutable(name) {
      return name === 'pnpm' ? executable : '/fake/npm';
    },
    spawn(request) {
      const script = request.argv.at(-1);
      const exitCode = Object.prototype.hasOwnProperty.call(exitCodes, script) ? exitCodes[script] : 0;
      return {
        done: Promise.resolve({ exitCode, signal: null }),
        collected: {
          stdout: { readFrom: () => (exitCode === 0 ? `ok: ${script}` : '') },
          stderr: { readFrom: () => (exitCode === 0 ? '' : `error: ${script} failed`) },
        },
      };
    },
  };
}
