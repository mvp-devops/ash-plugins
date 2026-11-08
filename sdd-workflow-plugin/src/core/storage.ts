/**
 * Хранилище SDD-артефактов в `<workspace>/.sdd/`.
 *
 * - Все пути относительные (от корня рабочего пространства сессии).
 * - Запись атомарная: сначала временный файл в том же каталоге, затем
 *   переименование (`moveFile` через файловую службу DSH; в тестах —
 *   `fs.rename`).
 * - Чтение не falling: повреждённый JSON не роняет плагин, а возвращает
 *   типизированную ошибку с путём и подсказкой.
 * - Идемпотентность: `ensureWorkspace` не затирает существующие артефакты.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { FsOperationError, SddError } from './errors.js';

/** Каталог артефактов внутри рабочего пространства. */
export const SDD_DIR = '.sdd';
/** Каталог истории изменений спецификации. */
export const HISTORY_DIR = 'history';

/** Имена фиксированных артефактов SDD. */
export const ARTIFACT_FILES = {
  specJson: 'spec.json',
  specMd: 'spec.md',
  planJson: 'plan.json',
  planMd: 'plan.md',
  tasksJson: 'tasks.json',
  traceabilityJson: 'traceability.json',
  validationReportJson: 'validation-report.json',
  changelogMd: 'changelog.md',
} as const;

export type ArtifactName = keyof typeof ARTIFACT_FILES;

/**
 * Минимальный контракт файловой службы, который нужен хранилищу.
 * Реализован двумя адаптерами: поверх `ctx.fs` DSH (песочница, рабочее
 * пространство) и поверх `node:fs/promises` (тесты и CLI-использование).
 */
export interface FsAdapter {
  /** Прочитать текстовый файл; `undefined`, если файл не существует. */
  readText(relativePath: string): Promise<string | undefined>;
  /** Атомарно записать текстовый файл (создаёт каталоги при необходимости). */
  writeText(relativePath: string, content: string): Promise<void>;
  /** Существует ли файл. */
  exists(relativePath: string): Promise<boolean>;
  /** Создать каталог рекурсивно. */
  mkdir(relativePath: string): Promise<void>;
  /** Список имён файлов в каталоге (без рекурсии); `[]`, если каталога нет. */
  listDir(relativePath: string): Promise<string[]>;
}

/** Временный префикс файлов атомарной записи. */
const TEMP_PREFIX = '.tmp-';

/** Адаптер поверх `node:fs/promises` — для тестов и автономного запуска. */
export class NodeFsAdapter implements FsAdapter {
  constructor(private readonly root: string) {}

  private resolve(relativePath: string): string {
    const target = path.resolve(this.root, relativePath);
    const normalizedRoot = path.resolve(this.root);
    if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
      throw new SddError('SDD_FS_ERROR', `Путь ${relativePath} выходит за пределы рабочего пространства.`, {
        file: relativePath,
        hint: 'используйте относительные пути внутри рабочего пространства',
      });
    }
    return target;
  }

  async readText(relativePath: string): Promise<string | undefined> {
    try {
      return await fsp.readFile(this.resolve(relativePath), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new FsOperationError(`Не удалось прочитать ${relativePath}: ${(error as Error).message}`, {
        file: relativePath,
        cause: error,
      });
    }
  }

  async writeText(relativePath: string, content: string): Promise<void> {
    const target = this.resolve(relativePath);
    const temp = path.join(path.dirname(target), `${TEMP_PREFIX}${path.basename(target)}-${process.pid}-${Date.now().toString(36)}`);
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(temp, content, 'utf8');
      await fsp.rename(temp, target);
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => {});
      throw new FsOperationError(`Не удалось записать ${relativePath}: ${(error as Error).message}`, {
        file: relativePath,
        cause: error,
      });
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fsp.access(this.resolve(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(relativePath: string): Promise<void> {
    await fsp.mkdir(this.resolve(relativePath), { recursive: true });
  }

  async listDir(relativePath: string): Promise<string[]> {
    try {
      const entries = await fsp.readdir(this.resolve(relativePath), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new FsOperationError(`Не удалось прочитать каталог ${relativePath}: ${(error as Error).message}`, {
        file: relativePath,
        cause: error,
      });
    }
  }
}

/** Определение `ctx.fs` DSH, которое использует плагин (структурная типизация). */
export interface DshFsLike {
  resolve(relativePath: string, options?: { cwd?: string }): Promise<unknown>;
  stat(target: unknown): Promise<{ type: string; size?: number } | undefined>;
  readText(target: unknown): Promise<string>;
  writeText(target: unknown, content: string, expected?: unknown, signal?: unknown): Promise<unknown>;
  moveFile(source: unknown, destination: unknown, options?: unknown, signal?: unknown): Promise<unknown>;
  listDir?(target: unknown, signal?: unknown): Promise<{ name: string; type: string }[]>;
  deleteFile?(target: unknown, expected?: unknown, signal?: unknown): Promise<unknown>;
}

/** Адаптер поверх `ctx.fs` DSH. Все пути разрешаются от корня рабочего пространства. */
export class DshFsAdapter implements FsAdapter {
  constructor(private readonly fs: DshFsLike, private readonly workspaceRoot: string) {}

  private async resolve(relativePath: string): Promise<unknown> {
    return this.fs.resolve(relativePath, { cwd: this.workspaceRoot });
  }

  async readText(relativePath: string): Promise<string | undefined> {
    const target = await this.resolve(relativePath);
    const info = await this.fs.stat(target);
    if (!info || info.type !== 'file') return undefined;
    return await this.fs.readText(target);
  }

  async writeText(relativePath: string, content: string): Promise<void> {
    const target = await this.resolve(relativePath);
    const fileName = relativePath.split('/').pop() ?? 'file';
    const dir = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '.';
    const tempRelative = `${dir}/${TEMP_PREFIX}${fileName}-${Date.now().toString(36)}`;
    const temp = await this.resolve(tempRelative);
    try {
      // 1. Временный файл, 2. атомарный rename на целевой путь.
      await this.fs.writeText(temp, content);
      try {
        await this.fs.moveFile(temp, target, {});
      } catch {
        // Fallback: writeText самой службы атомарен по контракту (single-file
        // publication is atomic); tmp+move недоступен в некоторых бэкендах.
        await this.fs.writeText(target, content);
        await this.fs.deleteFile?.(temp).catch(() => {});
      }
    } catch (error) {
      await this.fs.deleteFile?.(temp).catch(() => {});
      throw new FsOperationError(`Не удалось записать ${relativePath}: ${(error as Error).message}`, {
        file: relativePath,
        cause: error,
      });
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    const target = await this.resolve(relativePath);
    const info = await this.fs.stat(target).catch(() => undefined);
    return info !== undefined && info.type === 'file';
  }

  async mkdir(relativePath: string): Promise<void> {
    // По контракту dsh-fs writeText создаёт недостающие каталоги рекурсивно,
    // поэтому отдельного mkdir не требуется; метод сохранён для контракта адаптера.
    void relativePath;
  }

  async listDir(relativePath: string): Promise<string[]> {
    if (!this.fs.listDir) return [];
    const target = await this.resolve(relativePath);
    const entries = await this.fs.listDir(target).catch(() => []);
    return entries.filter((entry) => entry.type === 'file').map((entry) => entry.name);
  }
}

/**
 * Доменное хранилище SDD. Работает только с относительными путями внутри
 * `.sdd/` рабочего пространства.
 */
export class SddStorage {
  constructor(private readonly fs: FsAdapter) {}

  private artifactPath(name: ArtifactName): string {
    return `${SDD_DIR}/${ARTIFACT_FILES[name]}`;
  }

  /** Путь к файлу артефакта (для сообщений об ошибках). */
  artifactFile(name: ArtifactName): string {
    return this.artifactPath(name);
  }

  /** Инициализирован ли SDD workspace (есть spec.json). */
  async isInitialized(): Promise<boolean> {
    return this.fs.exists(this.artifactPath('specJson'));
  }

  /**
   * Создать структуру `.sdd/`. Идемпотентно: существующие файлы не
   * перезаписываются. Возвращает список созданных и уже существовавших файлов.
   */
  async ensureWorkspace(): Promise<{ created: string[]; existing: string[] }> {
    const created: string[] = [];
    const existing: string[] = [];
    await this.fs.mkdir(SDD_DIR);
    await this.fs.mkdir(`${SDD_DIR}/${HISTORY_DIR}`);
    for (const name of Object.keys(ARTIFACT_FILES) as ArtifactName[]) {
      // history/ и экспортные файлы создаются по мере работы; здесь только базовые.
      if (name === 'changelogMd') continue;
      const file = this.artifactPath(name);
      if (await this.fs.exists(file)) {
        existing.push(file);
      } else {
        created.push(file);
      }
    }
    return { created, existing };
  }

  /** Прочитать текстовый артефакт; `undefined`, если его ещё нет. */
  async readArtifact(name: ArtifactName): Promise<string | undefined> {
    return this.fs.readText(this.artifactPath(name));
  }

  /** Атомарно записать текстовый артефакт. */
  async writeArtifact(name: ArtifactName, content: string): Promise<string> {
    const file = this.artifactPath(name);
    await this.fs.writeText(file, content);
    return file;
  }

  /**
   * Прочитать и разобрать JSON-артефакт. Отсутствующий файл — `undefined`;
   * повреждённый JSON — типизированная ошибка с файлом и подсказкой.
   */
  async readJson<T>(name: ArtifactName, parse: (raw: unknown, file: string) => T): Promise<T | undefined> {
    const file = this.artifactPath(name);
    const text = await this.fs.readText(file);
    if (text === undefined) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (error) {
      throw new SddError('SDD_INVALID_JSON', `Файл ${file} содержит некорректный JSON: ${(error as Error).message}`, {
        file,
        hint: 'исправьте синтаксис JSON или перегенерируйте артефакт соответствующей командой',
      });
    }
    return parse(raw, file);
  }

  /** Атомарно записать JSON-артефакт (2-пробельный отступ, перевод строки в конце). */
  async writeJson(name: ArtifactName, value: unknown): Promise<string> {
    return this.writeArtifact(name, `${JSON.stringify(value, null, 2)}\n`);
  }

  /**
   * Сохранить снимок артефакта в историю `.sdd/history/` перед существенным
   * изменением. Возвращает имя файла снимка или `undefined`, если предыдущей
   * версии не было.
   */
  async snapshotToHistory(name: ArtifactName, content: string, stamp: string): Promise<string | undefined> {
    const fileName = `${name}-${stamp}.json`;
    const target = `${SDD_DIR}/${HISTORY_DIR}/${fileName}`;
    await this.fs.writeText(target, content);
    return target;
  }

  /** Список снимков истории. */
  async listHistory(): Promise<string[]> {
    const names = await this.fs.listDir(`${SDD_DIR}/${HISTORY_DIR}`);
    return names.sort();
  }
}

/** Формирование метки времени для имён файлов (без абсолютных путей). */
export function stampOf(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
