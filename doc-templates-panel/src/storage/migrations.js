/**
 * Миграции схемы данных хранилища шаблонов.
 *
 * Поле `schemaVersion` в документе хранилища определяет текущую версию схемы.
 * Цепочка миграций поднимает документ до актуальной версии; перед первой
 * миграцией создаётся резервная копия исходного файла (см. backup.js).
 * Если миграция падает — исходные данные восстанавливаются из копии,
 * а наружу отдаётся понятное сообщение на русском.
 */

import * as backup from './backup.js';
import { SCHEMA_VERSION, STORE_FORMAT, STORE_VERSION } from '../types.js';

/**
 * @typedef {import('../types.js').StoreDocument} StoreDocument
 */

/**
 * Реестр миграций: ключ — версия, ИЗ которой переходим.
 * Каждая миграция получает сырой разобранный документ и возвращает новый.
 * Добавляйте новые версии только в конец цепочки — никогда не переписывайте
 * существующие шаги, иначе старые хранилища поднимутся неверно.
 *
 * @type {Map<number, (doc: Record<string, unknown>) => Record<string, unknown>>}
 */
export const MIGRATIONS = new Map();

// v1 → v2: реестр пользовательских типов документации (customTypes).
MIGRATIONS.set(1, (doc) => ({
  ...doc,
  customTypes: Array.isArray(doc.customTypes) ? doc.customTypes : [],
}));

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION;

/**
 * Базовый документ хранилища.
 * @param {Partial<StoreDocument>} [overrides]
 * @returns {StoreDocument}
 */
export function emptyDocument(overrides = {}) {
  return {
    format: STORE_FORMAT,
    storeVersion: STORE_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    templates: [],
    ...overrides,
  };
}

/**
 * Нормализовать документ: заполнить отсутствующие служебные поля,
 * не трогая пользовательские шаблоны.
 * @param {Record<string, unknown>} doc
 * @returns {StoreDocument}
 */
export function normalizeDocument(doc) {
  const base = emptyDocument();
  return {
    ...base,
    ...doc,
    format: STORE_FORMAT,
    storeVersion: STORE_VERSION,
    templates: Array.isArray(doc.templates) ? doc.templates : [],
    customTypes: Array.isArray(doc.customTypes) ? doc.customTypes : [],
  };
}

/**
 * Подготовить документ к использованию: мигрировать до актуальной схемы.
 * Чистая функция (без файловой системы) — файловые гарантии обеспечивает
 * `runMigrationsWithBackup` в хранилище.
 * @param {Record<string, unknown>} raw
 * @returns {{ ok: true, document: StoreDocument, migratedFrom: number|null } | { ok: false, error: string }}
 */
export function migrateDocument(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Файл данных повреждён: ожидается JSON-объект со списком шаблонов.' };
  }
  let doc = raw;
  let version = typeof raw.schemaVersion === 'number' && Number.isInteger(raw.schemaVersion) && raw.schemaVersion >= 0
    ? raw.schemaVersion
    : null;
  if (version === null) {
    // Документ без schemaVersion: считаем его до-схемным и приводим к v1.
    if (!Array.isArray(raw.templates)) {
      return { ok: false, error: 'Файл данных повреждён: отсутствует список шаблонов (templates) и поле schemaVersion.' };
    }
    version = 0;
  }
  const migratedFrom = version < CURRENT_SCHEMA_VERSION ? version : null;
  try {
    while (version < CURRENT_SCHEMA_VERSION) {
      const step = MIGRATIONS.get(version);
      if (step) doc = step(doc);
      version += 1;
    }
  } catch (error) {
    return { ok: false, error: `Миграция схемы данных не удалась: ${error?.message ?? String(error)}` };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Файл данных создан более новой версией плагина (schemaVersion ${raw.schemaVersion} > ${CURRENT_SCHEMA_VERSION}). Обновите плагин или перенесите шаблоны через экспорт/импорт.`,
    };
  }
  return { ok: true, document: normalizeDocument({ ...doc, schemaVersion: CURRENT_SCHEMA_VERSION }), migratedFrom };
}

/**
 * Миграция с файловыми гарантиями: резервная копия до начала,
 * восстановление при неудаче.
 * @param {string} directory каталог хранилища
 * @param {string} filePath файл данных
 * @param {Record<string, unknown>} raw сырой документ
 * @param {(document: StoreDocument) => Promise<void>} persist функция атомарной записи
 * @returns {Promise<{ ok: true, document: StoreDocument, migratedFrom: number|null, backupPath: string|null } | { ok: false, error: string }>}
 */
export async function runMigrationsWithBackup(directory, filePath, raw, persist) {
  const needsMigration = typeof raw?.schemaVersion !== 'number' || raw.schemaVersion < CURRENT_SCHEMA_VERSION;
  let backupPath = null;
  if (needsMigration) {
    backupPath = await backup.createBackup(directory, filePath);
  }
  const result = migrateDocument(raw);
  if (!result.ok) {
    if (backupPath) {
      // Откат: вернём исходные данные, чтобы пользователь ничего не потерял.
      await backup.restoreFromBackup(directory, backupPath, filePath).catch(() => {});
      return {
        ok: false,
        error: `${result.error} Исходные данные восстановлены из резервной копии «${backupPath.split('/').pop()}» в каталоге хранилища.`,
      };
    }
    return { ok: false, error: result.error };
  }
  if (result.migratedFrom !== null) {
    await persist(result.document);
  }
  return { ok: true, document: result.document, migratedFrom: result.migratedFrom, backupPath };
}
