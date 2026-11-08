/**
 * Доменное хранилище шаблонов документации.
 *
 * Слои:
 *  1. Встроенные (seed) шаблоны — read-only, живут в коде, никогда не пишутся
 *     в пользовательский файл и не перезаписываются при обновлении плагина.
 *  2. Пользовательские шаблоны — переносимый JSON в каталоге профиля DSH;
 *     включают глобальные (scope=global) и проектные (scope=project с
 *     projectId — стабильным хешем рабочей директории, без абсолютных путей).
 *
 * Операции: list/get/create/update/delete/duplicate/generate/import/export,
 * восстановление после повреждения и управление резервными копиями.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  SCHEMA_VERSION,
  CUSTOM_TYPE_RE,
  EXPORT_FORMAT,
  makeId,
  normalizeTemplate,
  validateTemplate,
} from '../types.js';
import {
  buildDocumentFileName,
  compareVersions,
  generateDocument,
  matchesQuery,
  nextAvailableFileName,
  templateSummary,
} from '../templates/templateEngine.js';
import { TEMPLATE_TYPES, TYPE_LABELS } from '../types.js';
import { SEED_NORMALIZED, SEED_IDS, seedById } from '../templates/seedTemplates.js';
import { JsonFileStorage } from './jsonFileStorage.js';

const PLUGIN_VERSION = '1.0.0';
export const PLUGIN_NAME = 'doc-templates-panel';

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Транслитерация кириллицы для генерации латинского id типа. */
function transliterate(text) {
  return String(text ?? '').replace(/[а-яё]/g, (ch) => TRANSLIT[ch] ?? '');
}

/**
 * Стабильный идентификатор проекта: короткий хеш абсолютного пути.
 * Абсолютный путь нигде не сохраняется — хранится только хеш и имя каталога.
 * @param {string} cwd
 * @returns {string}
 */
export function projectIdOf(cwd) {
  return createHash('sha256').update(String(cwd ?? '')).digest('hex').slice(0, 16);
}

/**
 * Человекочитаемое имя проекта: имя каталога рабочей директории.
 * @param {string} cwd
 */
export function projectNameOf(cwd) {
  return path.basename(String(cwd ?? '').replace(/[\\/]+$/, '')) || null;
}

export class DocTemplateStore {
  /** @param {{ directory?: string, fileName?: string, now?: () => Date }} [options] */
  constructor(options = {}) {
    this.file = new JsonFileStorage(options);
    this.now = options.now ?? (() => new Date());
    /** @type {import('../types.js').StoreDocument|null} */
    this.document = null;
    /** @type {Promise<any>|null} */
    this.loadPromise = null;
    /** @type {{ migratedFrom: number|null, recoveredFromBackup: string|null, corruptedAside: string|null }|null} */
    this.lastLoadReport = null;
  }

  /** Загрузить (лениво, однократно) документ хранилища. */
  async ensureLoaded() {
    if (!this.loadPromise) {
      this.loadPromise = this.file.load().then((report) => {
        this.document = report.document;
        this.lastLoadReport = {
          migratedFrom: report.migratedFrom,
          recoveredFromBackup: report.recoveredFromBackup,
          corruptedAside: report.corruptedAside,
        };
        return report;
      });
    }
    await this.loadPromise;
    return this.document;
  }

  async #save() {
    await this.file.write(this.document);
  }

  #stamp() {
    return this.now().toISOString();
  }

  /**
   * Полный объединённый слой шаблонов: встроенные + пользовательские.
   * Проектные шаблоны других проектов не отдаются без явного projectId.
   * @param {{ projectId?: string|null, includeOtherProjects?: boolean }} [options]
   * @returns {Promise<import('../types.js').DocTemplate[]>}
   */
  async allTemplates(options = {}) {
    await this.ensureLoaded();
    const user = this.document.templates ?? [];
    const rows = [...SEED_NORMALIZED, ...user];
    if (options.includeOtherProjects) return rows;
    const projectId = options.projectId;
    if (!projectId) return rows.filter((t) => t.scope === 'global');
    return rows.filter((t) => t.scope === 'global' || t.projectId === projectId);
  }

  /** Карта подписей типов: встроенные + пользовательские. */
  async typeLabels() {
    await this.ensureLoaded();
    /** @type {Record<string, string>} */
    const labels = { ...TYPE_LABELS };
    for (const custom of this.document.customTypes ?? []) {
      if (custom?.id) labels[custom.id] = custom.label ?? custom.id;
    }
    return labels;
  }

  /** Реестр типов: встроенные (неизменяемые) + пользовательские. */
  async listTypes() {
    await this.ensureLoaded();
    return {
      ok: true,
      builtin: TEMPLATE_TYPES.map((id) => ({ id, label: TYPE_LABELS[id], builtin: true })),
      custom: (this.document.customTypes ?? []).map((custom) => ({ id: custom.id, label: custom.label, builtin: false })),
    };
  }

  /** Добавить пользовательский тип документации. */
  async addType(label, id = null) {
    await this.ensureLoaded();
    const cleanLabel = String(label ?? '').trim();
    if (!cleanLabel) return { ok: false, error: 'Укажите название типа документации.' };
    if (cleanLabel.length > 100) return { ok: false, error: 'Название типа длиннее 100 символов.' };
    let typeId = id ? String(id).trim() : null;
    if (typeId) {
      if (!CUSTOM_TYPE_RE.test(typeId)) {
        return { ok: false, error: 'id типа должен иметь вид ctype:<латиница/цифры/-_>, до 64 символов после префикса.' };
      }
    } else {
      // slug — только латиница/цифры: кириллица транслитерируется, чтобы id
      // проходил валидацию CUSTOM_TYPE_RE и был переносимым.
      const slug = (transliterate(cleanLabel.toLowerCase())
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'type');
      typeId = `ctype:${slug}`;
      let n = 2;
      const taken = new Set([...TEMPLATE_TYPES, ...(this.document.customTypes ?? []).map((custom) => custom.id)]);
      while (taken.has(typeId)) typeId = `ctype:${slug}-${n++}`;
    }
    const customTypes = this.document.customTypes ?? [];
    if (TEMPLATE_TYPES.includes(typeId) || customTypes.some((custom) => custom.id === typeId)) {
      return { ok: false, error: `Тип «${typeId}» уже существует.` };
    }
    this.document.customTypes = [...customTypes, { id: typeId, label: cleanLabel }];
    await this.#save();
    return { ok: true, type: { id: typeId, label: cleanLabel, builtin: false } };
  }

  /** Переименовать пользовательский тип. */
  async renameType(id, label) {
    await this.ensureLoaded();
    const cleanLabel = String(label ?? '').trim();
    if (!cleanLabel) return { ok: false, error: 'Укажите новое название типа.' };
    const customTypes = this.document.customTypes ?? [];
    const existing = customTypes.find((custom) => custom.id === id);
    if (!existing) return { ok: false, error: `Пользовательский тип не найден: ${id}. Встроенные типы переименовывать нельзя.` };
    this.document.customTypes = customTypes.map((custom) => (custom.id === id ? { ...custom, label: cleanLabel } : custom));
    await this.#save();
    return { ok: true, type: { id, label: cleanLabel, builtin: false } };
  }

  /** Удалить пользовательский тип, если он не используется шаблонами. */
  async deleteType(id) {
    await this.ensureLoaded();
    if (TEMPLATE_TYPES.includes(id)) {
      return { ok: false, error: 'Встроенные типы удалить нельзя.' };
    }
    const customTypes = this.document.customTypes ?? [];
    if (!customTypes.some((custom) => custom.id === id)) {
      return { ok: false, error: `Пользовательский тип не найден: ${id}` };
    }
    const used = (this.document.templates ?? []).filter((t) => t.type === id).map((t) => t.name);
    if (used.length > 0) {
      return { ok: false, error: `Тип используется шаблонами: ${used.slice(0, 5).join(', ')}${used.length > 5 ? '…' : ''}. Сначала измените тип этих шаблонов.` };
    }
    this.document.customTypes = customTypes.filter((custom) => custom.id !== id);
    await this.#save();
    return { ok: true, deleted: id };
  }

  /**
   * Список шаблонов с фильтрацией, поиском и сортировкой.
   * @param {{ query?: string, type?: string, scope?: string, tag?: string, projectId?: string|null, sort?: 'name'|'updatedAt', direction?: 'asc'|'desc' }} [filter]
   */
  async list(filter = {}) {
    const rows = await this.allTemplates({ projectId: filter.projectId, includeOtherProjects: Boolean(filter.includeOtherProjects) });
    const labels = await this.typeLabels();
    /** @type {any[]} */
    let result = rows.map((template) => templateSummary(template, {}, labels));
    if (filter.type) result = result.filter((row) => row.type === filter.type);
    if (filter.scope) result = result.filter((row) => row.scope === filter.scope);
    if (filter.tag) result = result.filter((row) => row.tags.includes(filter.tag));
    if (filter.query) result = result.filter((row) => matchesQuery(rows.find((t) => t.id === row.id) ?? row, filter.query));
    const sort = filter.sort ?? 'name';
    const direction = filter.direction === 'desc' ? -1 : 1;
    result.sort((a, b) => {
      if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
      if (sort === 'updatedAt') {
        const av = Date.parse(a.updatedAt ?? '') || 0;
        const bv = Date.parse(b.updatedAt ?? '') || 0;
        if (av !== bv) return (av - bv) * direction;
        return a.name.localeCompare(b.name, 'ru');
      }
      return a.name.localeCompare(b.name, 'ru') * direction;
    });
    return {
      ok: true,
      rows: result,
      total: result.length,
      tags: [...new Set(rows.flatMap((t) => t.tags ?? []))].sort((a, b) => a.localeCompare(b, 'ru')),
      types: [
        ...TEMPLATE_TYPES.map((id) => ({ id, label: labels[id] ?? id, builtin: true })),
        ...(this.document.customTypes ?? []).map((custom) => ({ id: custom.id, label: custom.label, builtin: false })),
      ],
      store: this.status(),
    };
  }

  /**
   * Получить шаблон по id (включая встроенные).
   * @param {string} id
   */
  async get(id) {
    const labels = await this.typeLabels();
    if (SEED_IDS.has(id)) {
      const seed = seedById(id);
      return { ok: true, template: { ...templateSummary(seed, {}, labels), content: seed.content, raw: seed }, builtin: true };
    }
    await this.ensureLoaded();
    const template = (this.document.templates ?? []).find((t) => t.id === id);
    if (!template) return { ok: false, error: `Шаблон не найден: ${id}` };
    return { ok: true, template: { ...templateSummary(template, {}, labels), content: template.content, raw: template }, builtin: false };
  }

  /**
   * Создать шаблон.
   * @param {import('../types.js').DocTemplate} input
   * @param {{ projectId?: string|null, projectName?: string|null }} [context]
   */
  async create(input, context = {}) {
    await this.ensureLoaded();
    const id = typeof input.id === 'string' && input.id ? input.id : makeId();
    let scope = input.scope;
    if (scope === 'project' && input.projectId == null) {
      if (!context.projectId) return { ok: false, error: 'Проектный шаблон требует projectId: откройте панель в сессии с рабочей директорией.' };
      scope = 'project';
    }
    const candidate = {
      ...input,
      id,
      scope,
      projectId: scope === 'project' ? (input.projectId ?? context.projectId ?? null) : null,
      projectName: scope === 'project' ? (input.projectName ?? context.projectName ?? null) : null,
    };
    const errors = validateTemplate(candidate);
    if (errors.length > 0) return { ok: false, error: `Шаблон не прошёл валидацию: ${errors.join('; ')}` };
    const templates = this.document.templates ?? [];
    if (templates.some((t) => t.id === id) || SEED_IDS.has(id)) {
      return { ok: false, error: `Шаблон с id «${id}» уже существует. Выберите другой идентификатор или дублируйте существующий шаблон.` };
    }
    const template = normalizeTemplate(candidate, { scope, now: this.#stamp() });
    this.document.templates = [...templates, template];
    await this.#save();
    return { ok: true, template: templateSummary(template, {}, await this.typeLabels()), created: true };
  }

  /**
   * Обновить пользовательский шаблон. Встроенные шаблоны только для чтения.
   * @param {string} id
   * @param {Partial<import('../types.js').DocTemplate>} patch
   */
  async update(id, patch) {
    await this.ensureLoaded();
    if (SEED_IDS.has(id)) {
      return { ok: false, error: 'Встроенные шаблоны доступны только для чтения. Продублируйте шаблон и отредактируйте копию.' };
    }
    const templates = this.document.templates ?? [];
    const existing = templates.find((t) => t.id === id);
    if (!existing) return { ok: false, error: `Шаблон не найден: ${id}` };
    const merged = normalizeTemplate({ ...existing, ...patch, id }, { scope: existing.scope, now: this.#stamp() });
    merged.projectId = patch.scope === undefined ? existing.projectId : (patch.projectId ?? existing.projectId);
    merged.projectName = patch.scope === undefined ? existing.projectName : (patch.projectName ?? existing.projectName);
    if (patch.scope && patch.scope !== existing.scope) {
      merged.scope = patch.scope;
      if (patch.scope === 'global') {
        delete merged.projectId;
        delete merged.projectName;
      } else {
        merged.projectId = patch.projectId ?? existing.projectId ?? null;
        merged.projectName = patch.projectName ?? existing.projectName ?? null;
      }
    }
    const errors = validateTemplate(merged);
    if (errors.length > 0) return { ok: false, error: `Шаблон не прошёл валидацию: ${errors.join('; ')}` };
    this.document.templates = templates.map((t) => (t.id === id ? merged : t));
    await this.#save();
    return { ok: true, template: templateSummary(merged, {}, await this.typeLabels()) };
  }

  /**
   * Удалить пользовательский шаблон.
   * @param {string} id
   */
  async delete(id) {
    await this.ensureLoaded();
    if (SEED_IDS.has(id)) {
      return { ok: false, error: 'Встроенные шаблоны удалить нельзя — они часть плагина и всегда доступны.' };
    }
    const templates = this.document.templates ?? [];
    const existing = templates.find((t) => t.id === id);
    if (!existing) return { ok: false, error: `Шаблон не найден: ${id}` };
    this.document.templates = templates.filter((t) => t.id !== id);
    await this.#save();
    return { ok: true, deleted: { id, name: existing.name } };
  }

  /**
   * Дублировать шаблон (встроенный или пользовательский).
   * @param {string} id
   * @param {{ name?: string, projectId?: string|null, projectName?: string|null }} [options]
   */
  async duplicate(id, options = {}) {
    const found = await this.get(id);
    if (!found.ok) return found;
    const source = found.template.raw;
    const templates = await this.allTemplates({ projectId: undefined, includeOtherProjects: true });
    let newId = makeId();
    while (templates.some((t) => t.id === newId)) newId = makeId();
    const baseName = (options.name ?? '').trim() || `${source.name} — копия`;
    const scope = options.projectId && source.scope === 'project' ? 'project' : source.scope;
    const created = await this.create({
      ...source,
      id: newId,
      name: baseName,
      scope,
      builtin: false,
      readonly: false,
      version: '1.0.0',
      projectId: scope === 'project' ? (options.projectId ?? source.projectId) : null,
      projectName: scope === 'project' ? (options.projectName ?? source.projectName) : null,
    }, { projectId: options.projectId ?? null, projectName: options.projectName ?? null });
    if (!created.ok) return created;
    return { ok: true, template: created.template, sourceId: id };
  }

  /**
   * Сгенерировать документ из шаблона.
   * @param {string} id
   * @param {Record<string, string>} values
   * @param {{ projectName?: string|null }} [context]
   */
  async generate(id, values, context = {}) {
    const found = await this.get(id);
    if (!found.ok) return found;
    const template = found.template.raw;
    const result = generateDocument(template, values, {
      date: this.#stamp().slice(0, 10),
      projectName: context.projectName ?? undefined,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: `Не заполнены обязательные переменные: ${result.missing.join(', ')}`,
        missing: result.missing,
      };
    }
    return {
      ok: true,
      document: result.document,
      unfilled: result.unfilled,
      fileName: buildDocumentFileName(template.name, this.now(), template.format),
      template: { id: template.id, name: template.name, type: template.type },
    };
  }

  /**
   * Переносимый экспорт: выбранные шаблоны или весь набор.
   * Не содержит секретов и абсолютных путей: projectId — хеш, projectName — имя каталога.
   * @param {{ ids?: string[], all?: boolean, projectId?: string|null }} [options]
   */
  async exportTemplates(options = {}) {
    const rows = await this.allTemplates({ projectId: options.projectId ?? undefined, includeOtherProjects: true });
    let selected = rows;
    if (!options.all && Array.isArray(options.ids)) {
      const wanted = new Set(options.ids);
      selected = rows.filter((t) => wanted.has(t.id));
    }
    const templates = selected.map((template) => {
      const { builtin: _b, readonly: _r, ...rest } = template;
      return rest;
    });
    return {
      ok: true,
      document: {
        format: EXPORT_FORMAT,
        schemaVersion: SCHEMA_VERSION,
        metadata: {
          plugin: PLUGIN_NAME,
          pluginVersion: PLUGIN_VERSION,
          createdAt: this.#stamp(),
          count: templates.length,
        },
        templates,
        customTypes: (this.document.customTypes ?? []).map((custom) => ({ ...custom })),
      },
    };
  }

  /**
   * Импорт шаблонов из переносимого документа.
   * @param {Record<string, unknown>|string} document
   * @param {{ strategy?: 'merge'|'overwrite'|'skip-existing'|'create-copy', confirmOverwrite?: boolean, apply?: boolean, projectId?: string|null, projectName?: string|null }} [options]
   */
  async importTemplates(document, options = {}) {
    await this.ensureLoaded();
    let doc = document;
    if (typeof doc === 'string') {
      try {
        doc = JSON.parse(doc);
      } catch (error) {
        return { ok: false, error: `Некорректный JSON: ${error?.message ?? String(error)}` };
      }
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.format !== EXPORT_FORMAT || !Array.isArray(doc.templates)) {
      return { ok: false, error: 'Ожидался документ формата doc-templates-panel/templates (JSON с полем templates).' };
    }
    const warnings = [];
    if (typeof doc.schemaVersion === 'number' && doc.schemaVersion > SCHEMA_VERSION) {
      warnings.push(`Документ создан более новой версией схемы (schemaVersion ${doc.schemaVersion} > ${SCHEMA_VERSION}); часть полей может быть проигнорирована.`);
    }
    /** @type {import('../types.js').DocTemplate[]} */
    const incoming = [];
    const problems = [];
    const incomingTypes = Array.isArray(doc.customTypes)
      ? doc.customTypes.filter((entry) => entry && typeof entry.id === 'string' && CUSTOM_TYPE_RE.test(entry.id) && typeof entry.label === 'string' && entry.label.trim())
      : [];
    if (Array.isArray(doc.customTypes) && incomingTypes.length !== doc.customTypes.length) {
      warnings.push('Часть пользовательских типов в документе пропущена: некорректный id или название.');
    }
    doc.templates.forEach((entry, index) => {
      const errors = validateTemplate(entry);
      if (errors.length > 0) problems.push(`шаблон №${index + 1} (${entry?.id ?? 'без id'}): ${errors.join('; ')}`);
      else incoming.push(entry);
    });
    if (problems.length > 0) return { ok: false, error: `Импорт отклонён: ${problems.join('; ')}` };

    const strategy = options.strategy ?? 'merge';
    const existing = this.document.templates ?? [];
    const existingById = new Map(existing.map((t) => [t.id, t]));
    /** @type {any[]} */
    const diff = [];
    for (const template of incoming) {
      const before = existingById.get(template.id);
      diff.push({
        id: template.id,
        name: template.name,
        action: before ? (JSON.stringify(before) === JSON.stringify({ ...template, builtin: false, readonly: false }) ? 'unchanged' : 'update') : 'create',
        ...(before ? { changes: Object.keys(template).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(template[key])) } : {}),
      });
    }
    const touchesExisting = diff.some((entry) => entry.action === 'update');
    if (!options.apply) {
      return { ok: true, preview: true, diff, warnings, strategy };
    }
    if (touchesExisting && !options.confirmOverwrite) {
      return { ok: false, needsConfirmation: true, diff, warnings, error: 'Импорт перезаписывает существующие шаблоны: подтвердите действие (confirmOverwrite).' };
    }

    // Копия на случай сбоя записи: сохраняем текущий файл.
    await this.file.createBackup(`pre-import-${Date.now()}`).catch(() => {});

    /** @type {import('../types.js').DocTemplate[]} */
    let next = [...existing];
    /** @type {any[]} */
    const outcomes = [];
    // Пользовательские типы из документа дозливаются без перезаписи существующих подписей.
    if (options.apply) {
      const known = new Map((this.document.customTypes ?? []).map((custom) => [custom.id, custom]));
      for (const custom of incomingTypes) {
        if (!known.has(custom.id)) {
          known.set(custom.id, { id: custom.id, label: custom.label.trim() });
          outcomes.push({ id: custom.id, name: custom.label.trim(), action: 'type-create' });
        }
      }
      this.document.customTypes = [...known.values()];
    }
    for (const template of incoming) {
      const before = existingById.get(template.id);
      const stamped = normalizeTemplate(template, { now: this.#stamp(), projectId: template.scope === 'project' ? (template.projectId ?? options.projectId ?? null) : null, projectName: template.scope === 'project' ? (template.projectName ?? options.projectName ?? null) : null });
      stamped.updatedAt = template.updatedAt ?? stamped.updatedAt;
      stamped.createdAt = template.createdAt ?? stamped.createdAt;
      if (!before) {
        next.push(stamped);
        outcomes.push({ id: template.id, name: template.name, action: 'create' });
        continue;
      }
      if (strategy === 'overwrite' || strategy === 'merge') {
        next = next.map((t) => (t.id === template.id ? stamped : t));
        outcomes.push({ id: template.id, name: template.name, action: 'update' });
      } else if (strategy === 'skip-existing') {
        outcomes.push({ id: template.id, name: template.name, action: 'skip' });
      } else if (strategy === 'create-copy') {
        const copyId = makeId();
        next.push({ ...stamped, id: copyId, name: `${template.name} (импорт)` });
        outcomes.push({ id: template.id, name: template.name, action: 'create-copy', newId: copyId });
      }
    }
    this.document.templates = next;
    await this.#save();
    return { ok: true, applied: true, outcomes, warnings };
  }

  /**
   * Статус хранилища: путь внутри профиля (относительное представление),
   * версия схемы, факт миграции и восстановления, список копий.
   */
  status() {
    const dir = this.file.directory;
    return {
      directory: dir,
      directoryEnv: process.env.DSH_PROFILE_DIR ? '$DSH_PROFILE_DIR/doc-templates-panel' : '$DSH_HOME/doc-templates-panel',
      fileName: this.file.fileName,
      schemaVersion: SCHEMA_VERSION,
      lastLoadReport: this.lastLoadReport,
      document: this.document
        ? { schemaVersion: this.document.schemaVersion, templates: (this.document.templates ?? []).length, updatedAt: this.document.updatedAt }
        : null,
    };
  }

  /** Резервные копии. */
  listBackups() {
    return this.file.listBackups();
  }

  /** Восстановление из резервной копии (по умолчанию — самой свежей). */
  restoreFromBackup(backupPath) {
    return this.file.restoreFromBackup(backupPath);
  }
}

export { buildDocumentFileName, nextAvailableFileName, compareVersions, SEED_IDS, SEED_NORMALIZED };
