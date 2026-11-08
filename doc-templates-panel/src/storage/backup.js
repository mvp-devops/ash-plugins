/**
 * Резервные копии хранилища шаблонов.
 *
 * Копии создаются перед миграцией схемы, восстановлением после повреждения
 * и импортом с перезаписью. Все копии лежат рядом с основным файлом данных
 * в переносимом хранилище профиля; имена не содержат абсолютных путей.
 *
 * Схема имени: `doc-templates.backup-<timestamp>.json`,
 * повреждённые файлы: `doc-templates.corrupt-<timestamp>.json`.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

export const BACKUP_PREFIX = 'doc-templates.backup-';
export const CORRUPT_PREFIX = 'doc-templates.corrupt-';
/** Сколько копий хранить (самые свежие). */
export const MAX_BACKUPS = 10;

/** Метка времени для имени файла: безопасная, сортируемая. */
export function timestampStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Список резервных копий, отсортированный по времени (сначала свежие).
 * @param {string} directory
 * @returns {Promise<{ file: string, stamp: string, mtimeMs: number }[]>}
 */
export async function listBackups(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const backups = [];
  for (const name of entries) {
    if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith('.json')) continue;
    const full = path.join(directory, name);
    try {
      const stat = await fsp.stat(full);
      if (!stat.isFile()) continue;
      backups.push({ file: full, stamp: name.slice(BACKUP_PREFIX.length, -'.json'.length), mtimeMs: stat.mtimeMs });
    } catch {
      // файл исчез между readdir и stat — пропускаем без сбоя
    }
  }
  return backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Создать резервную копию файла данных.
 * @param {string} directory каталог хранилища
 * @param {string} sourcePath исходный файл
 * @param {{ stamp?: string }} [options]
 * @returns {Promise<string|null>} путь копии или null, если копировать нечего
 */
export async function createBackup(directory, sourcePath, options = {}) {
  let text;
  try {
    text = await fsp.readFile(sourcePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  await fsp.mkdir(directory, { recursive: true });
  const stamp = options.stamp ?? timestampStamp();
  const target = path.join(directory, `${BACKUP_PREFIX}${stamp}.json`);
  await fsp.writeFile(`${target}.tmp`, text, 'utf8');
  await fsp.rename(`${target}.tmp`, target);
  await pruneBackups(directory);
  return target;
}

/**
 * Удалить старые копии сверх MAX_BACKUPS.
 * @param {string} directory
 */
export async function pruneBackups(directory) {
  const backups = await listBackups(directory);
  for (const backup of backups.slice(MAX_BACKUPS)) {
    await fsp.rm(backup.file, { force: true }).catch(() => {});
  }
}

/**
 * Самая свежая резервная копия или null.
 * @param {string} directory
 */
export async function latestBackup(directory) {
  const backups = await listBackups(directory);
  return backups[0] ?? null;
}

/**
 * Восстановить файл данных из резервной копии.
 * Текущий (повреждённый или испорченный) файл сохраняется как
 * `doc-templates.corrupt-<stamp>.json`, чтобы ничего не терять.
 * @param {string} directory
 * @param {string} backupPath путь копии
 * @param {string} targetPath восстанавливаемый файл данных
 * @returns {Promise<{ restoredFrom: string, movedAside: string|null }>}
 */
export async function restoreFromBackup(directory, backupPath, targetPath) {
  const text = await fsp.readFile(backupPath, 'utf8');
  JSON.parse(text); // копия сама повреждена — отдадим ошибку наверх, ничего не трогая
  await fsp.mkdir(directory, { recursive: true });
  let movedAside = null;
  try {
    const stamp = timestampStamp();
    movedAside = path.join(directory, `${CORRUPT_PREFIX}${stamp}.json`);
    await fsp.rename(targetPath, movedAside);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      movedAside = null;
    }
  }
  await fsp.writeFile(`${targetPath}.tmp`, text, 'utf8');
  await fsp.rename(`${targetPath}.tmp`, targetPath);
  return { restoredFrom: backupPath, movedAside };
}
