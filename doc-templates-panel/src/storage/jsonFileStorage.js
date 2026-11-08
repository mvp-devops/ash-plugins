/**
 * JSON-файловое хранилище с атомарной записью и защитой от повреждения.
 *
 * Данные живут в переносимом каталоге профиля DSH (`$DSH_PROFILE_DIR`),
 * а не в каталоге установки Harness и не в исходниках плагина. Запись
 * атомарная (временный файл + rename), чтение устойчиво к повреждённому
 * JSON: файл убирается в сторону с сохранением содержимого, выполняется
 * попытка восстановления из самой свежей резервной копии, а наружу
 * отдаётся понятное русскоязычное описание ситуации.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as backupModule from './backup.js';
import { runMigrationsWithBackup } from './migrations.js';

/**
 * Каталог хранилища плагина: привязан к профилю DSH.
 * @param {{ directory?: string }} [options]
 * @returns {string}
 */
export function storeDirectory(options = {}) {
  if (options.directory) return options.directory;
  const profile = process.env.DSH_PROFILE_DIR;
  if (profile) return path.join(profile, 'doc-templates-panel');
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, 'doc-templates-panel');
}

export class JsonFileStorage {
  /** @param {{ directory?: string, fileName?: string }} [options] */
  constructor(options = {}) {
    this.directory = storeDirectory(options);
    this.fileName = options.fileName ?? 'templates.json';
    this.filePath = path.join(this.directory, this.fileName);
  }

  /**
   * Прочитать и мигрировать документ хранилища.
   * @returns {Promise<{ document: import('../types.js').StoreDocument, migratedFrom: number|null, recoveredFromBackup: string|null, corruptedAside: string|null }>}
   */
  async load() {
    let raw;
    let corruptedAside = null;
    let recoveredFromBackup = null;
    try {
      raw = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        // Файла ещё нет — это чистое новое хранилище, а не повреждение.
        const { emptyDocument } = await import('./migrations.js');
        return { document: emptyDocument(), migratedFrom: null, recoveredFromBackup, corruptedAside };
      }
      // Файл существует, но не читается как JSON — пробуем восстановиться.
      const stamp = backupModule.timestampStamp();
      corruptedAside = path.join(this.directory, `${backupModule.CORRUPT_PREFIX}${stamp}.json`);
      await fsp.mkdir(this.directory, { recursive: true });
      await fsp.copyFile(this.filePath, corruptedAside).catch(() => { corruptedAside = null; });
        const candidate = await backupModule.latestBackup(this.directory);
        if (candidate) {
          try {
            await backupModule.restoreFromBackup(this.directory, candidate.file, this.filePath);
            recoveredFromBackup = candidate.file;
            raw = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
          } catch {
            raw = null;
          }
        } else {
          raw = null;
        }
        if (raw === null) {
          // Отдаём пустое хранилище, не падая; повреждённый файл сохранён рядом.
          const { emptyDocument } = await import('./migrations.js');
          return { document: emptyDocument(), migratedFrom: null, recoveredFromBackup, corruptedAside };
        }
      }
    const migrated = await runMigrationsWithBackup(this.directory, this.filePath, raw ?? {}, async (document) => {
      await this.write(document);
    });
    if (!migrated.ok) {
      // Неподъёмный документ (например, более новая схема). Хранилище остаётся
      // нетронутым; наружу уходит понятная ошибка, шаблоны не теряются.
      const failure = new Error(migrated.error);
      failure.code = 'DOC_TEMPLATES_STORE_INCOMPATIBLE';
      throw failure;
    }
    return {
      document: migrated.document,
      migratedFrom: migrated.migratedFrom,
      recoveredFromBackup,
      corruptedAside,
    };
  }

  /**
   * Атомарная запись документа: временный файл в том же каталоге + rename.
   * @param {import('../types.js').StoreDocument} document
   */
  async write(document) {
    await fsp.mkdir(this.directory, { recursive: true });
    const payload = JSON.stringify({ ...document, updatedAt: new Date().toISOString() }, null, 2);
    const temp = `${this.filePath}.tmp`;
    await fsp.writeFile(temp, `${payload}\n`, 'utf8');
    await fsp.rename(temp, this.filePath);
  }

  /** Список резервных копий (сначала свежие). */
  listBackups() {
    return backupModule.listBackups(this.directory);
  }

  /**
   * Восстановить хранилище из указанной (или самой свежей) резервной копии.
   * @param {string} [backupPath]
   */
  async restoreFromBackup(backupPath) {
    const target = backupPath ?? (await backupModule.latestBackup(this.directory))?.file;
    if (!target) return { ok: false, error: 'Резервных копий нет: восстановление невозможно.' };
    try {
      const result = await backupModule.restoreFromBackup(this.directory, target, this.filePath);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: `Не удалось восстановиться из копии: ${error?.message ?? String(error)}` };
    }
  }

  /**
   * Создать резервную копию прямо сейчас (например, перед перезаписывающим импортом).
   * @param {string} [stamp]
   */
  createBackup(stamp) {
    return backupModule.createBackup(this.directory, this.filePath, { stamp });
  }
}
