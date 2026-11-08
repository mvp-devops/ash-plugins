/**
 * Типы данных, константы, валидация и нормализация шаблонов документации.
 *
 * Файл написан на чистом ESM JavaScript с JSDoc-типами: DSH загружает
 * host-половину плагина нативным `import()` из профиля (физически это
 * `node_modules` внутри профиля), а Node не применяет strip-types к файлам
 * внутри node_modules. Поэтому рантайм-файлы плагина — `.js`; типы проверяются
 * редактором через `tsconfig.json` + `checkJs` (см. README, раздел «Ограничения»).
 *
 * @typedef {('requirements'|'technical_specification'|'diagram'|'technical_design'|'test_case'|'test_protocol'|'custom')} TemplateType
 * @typedef {('global'|'project')} TemplateScope
 * @typedef {('markdown'|'plaintext')} TemplateFormat
 * @typedef {{ key: string, label?: string, required?: boolean, defaultValue?: string, helpText?: string }} TemplateVariable
 * @typedef {{
 *   id: string,
 *   name: string,
 *   type: TemplateType,
 *   scope: TemplateScope,
 *   projectId?: string|null,
 *   projectName?: string|null,
 *   description?: string,
 *   format?: TemplateFormat,
 *   content: string,
 *   variables?: TemplateVariable[],
 *   tags?: string[],
 *   version?: string,
 *   createdAt?: string,
 *   updatedAt?: string,
 *   author?: string,
 *   builtin?: boolean,
 *   readonly?: boolean
 * }} DocTemplate
 * @typedef {{ id: string, label: string }} CustomDocType
 * @typedef {{ format: string, storeVersion: number, schemaVersion: number, updatedAt?: string, templates: DocTemplate[], customTypes?: CustomDocType[], seedState?: { installedVersion: string, seededAt: string } }} StoreDocument
 */

import { randomUUID } from 'node:crypto';

/** @type {TemplateType[]} */
export const TEMPLATE_TYPES = [
  'requirements',
  'technical_specification',
  'diagram',
  'technical_design',
  'test_case',
  'test_protocol',
  'custom',
];

/** @type {TemplateScope[]} */
export const TEMPLATE_SCOPES = ['global', 'project'];

/** @type {TemplateFormat[]} */
export const TEMPLATE_FORMATS = ['markdown', 'plaintext'];

/** Человеческие названия типов (интерфейс плагина — русский). */
export const TYPE_LABELS = {
  requirements: 'Требования',
  technical_specification: 'Техническая спецификация',
  diagram: 'Схема / диаграмма',
  technical_design: 'Технический проект',
  test_case: 'Тест-кейс',
  test_protocol: 'Протокол тестирования',
  custom: 'Произвольный',
};

export const SCHEMA_VERSION = 2;
/** Пользовательские типы документации хранятся с префиксом `ctype:`. */
export const CUSTOM_TYPE_RE = /^ctype:[A-Za-z0-9_-]{1,64}$/;
/** Проверить, что значение type — встроенный или пользовательский тип. */
export function isValidType(type) {
  return TEMPLATE_TYPES.includes(type) || CUSTOM_TYPE_RE.test(String(type ?? ''));
}
export const STORE_VERSION = 1;
export const STORE_FORMAT = 'doc-templates-panel/templates';
export const EXPORT_FORMAT = 'doc-templates-panel/templates';

/** Стабильный UUID (v4). @returns {string} */
export function makeId() {
  return randomUUID();
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Валидация шаблона. Возвращает массив сообщений об ошибках на русском;
 * пустой массив означает, что шаблон корректен.
 * @param {DocTemplate} input
 * @returns {string[]}
 */
export function validateTemplate(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return ['шаблон должен быть объектом'];
  }
  if (typeof input.id !== 'string' || !ID_RE.test(input.id)) {
    errors.push('id обязателен: строка 1–128 символов из букв, цифр и «._:-», начинается с буквы или цифры');
  }
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    errors.push('название (name) обязательно и не может быть пустым');
  } else if (input.name.length > 200) {
    errors.push('название (name) длиннее 200 символов');
  }
  if (!isValidType(input.type)) {
    errors.push(`type должен быть одним из: ${TEMPLATE_TYPES.join(', ')}, либо пользовательским типом вида ctype:<id>`);
  }
  if (!TEMPLATE_SCOPES.includes(input.scope)) {
    errors.push('scope должен быть "global" или "project"');
  } else if (input.scope === 'project' && (typeof input.projectId !== 'string' || input.projectId.length === 0)) {
    errors.push('для scope = "project" обязателен projectId');
  } else if (input.scope === 'global' && input.projectId != null) {
    errors.push('для scope = "global" поле projectId должно отсутствовать или быть null');
  }
  if (typeof input.content !== 'string' || input.content.length === 0) {
    errors.push('содержимое (content) обязательно');
  } else if (input.content.length > 1000000) {
    errors.push('содержимое (content) длиннее 1 000 000 символов');
  }
  if (input.description != null && (typeof input.description !== 'string' || input.description.length > 2000)) {
    errors.push('описание (description) — строка до 2000 символов');
  }
  if (input.format != null && !TEMPLATE_FORMATS.includes(input.format)) {
    errors.push('format должен быть "markdown" или "plaintext"');
  }
  if (input.version != null && (typeof input.version !== 'string' || !SEMVER_RE.test(input.version))) {
    errors.push('version должен быть семантической версией, например 1.0.0');
  }
  if (input.author != null && (typeof input.author !== 'string' || input.author.length > 200)) {
    errors.push('author — строка до 200 символов');
  }
  if (input.createdAt != null && (typeof input.createdAt !== 'string' || !ISO_RE.test(input.createdAt))) {
    errors.push('createdAt должен быть датой в формате ISO 8601');
  }
  if (input.updatedAt != null && (typeof input.updatedAt !== 'string' || !ISO_RE.test(input.updatedAt))) {
    errors.push('updatedAt должен быть датой в формате ISO 8601');
  }
  if (input.variables != null) {
    if (!Array.isArray(input.variables)) {
      errors.push('variables должен быть массивом описаний переменных');
    } else {
      const seen = new Set();
      input.variables.forEach((variable, index) => {
        const label = variable?.key ? `переменная «${variable.key}»` : `переменная №${index + 1}`;
        if (!variable || typeof variable !== 'object' || Array.isArray(variable)) {
          errors.push(`${label}: описание переменной должно быть объектом`);
          return;
        }
        if (typeof variable.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(variable.key)) {
          errors.push(`${label}: key обязателен — латиница/цифры/«_.-», начинается с буквы, до 64 символов`);
        } else if (seen.has(variable.key)) {
          errors.push(`${label}: ключ переменной повторяется`);
        } else {
          seen.add(variable.key);
        }
        for (const field of ['label', 'defaultValue', 'helpText']) {
          if (variable[field] != null && typeof variable[field] !== 'string') {
            errors.push(`${label}: поле ${field} должно быть строкой`);
          }
        }
        if (variable.required != null && typeof variable.required !== 'boolean') {
          errors.push(`${label}: поле required должно быть логическим значением`);
        }
      });
    }
  }
  if (input.tags != null) {
    if (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== 'string')) {
      errors.push('tags должен быть массивом строк');
    } else if (input.tags.length > 20) {
      errors.push('tags: не более 20 тегов');
    } else if (input.tags.some((tag) => tag.length > 50)) {
      errors.push('tags: каждый тег до 50 символов');
    }
  }
  return errors;
}

/**
 * Нормализация шаблона: значения по умолчанию, канонические поля, отметки времени.
 * Встроенные (seed) шаблоны помечаются `builtin: true, readonly: true` и никогда
 * не перезаписывают пользовательские данные.
 * @param {DocTemplate} input
 * @param {{ scope?: TemplateScope, now?: string, builtin?: boolean, readonly?: boolean }} [options]
 * @returns {DocTemplate}
 */
export function normalizeTemplate(input, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const builtin = Boolean(options.builtin ?? input.builtin);
  /** @type {DocTemplate} */
  const template = {
    id: input.id,
    name: input.name.trim(),
    type: input.type,
    scope: options.scope ?? input.scope,
    description: typeof input.description === 'string' ? input.description : '',
    format: input.format === 'plaintext' ? 'plaintext' : 'markdown',
    content: input.content,
    variables: Array.isArray(input.variables)
      ? input.variables.map((variable) => ({
          key: variable.key,
          ...(variable.label ? { label: variable.label } : {}),
          ...(variable.required ? { required: true } : {}),
          ...(variable.defaultValue != null && variable.defaultValue !== '' ? { defaultValue: variable.defaultValue } : {}),
          ...(variable.helpText ? { helpText: variable.helpText } : {}),
        }))
      : [],
    tags: Array.isArray(input.tags) ? [...input.tags] : [],
    version: typeof input.version === 'string' && SEMVER_RE.test(input.version) ? input.version : '1.0.0',
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: now,
    ...(input.author ? { author: input.author } : {}),
  };
  if (template.scope === 'project') {
    template.projectId = typeof input.projectId === 'string' ? input.projectId : null;
    template.projectName = typeof input.projectName === 'string' ? input.projectName : null;
  }
  if (builtin) {
    template.builtin = true;
    template.readonly = true;
  }
  return template;
}
