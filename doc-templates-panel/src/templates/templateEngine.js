/**
 * Движок шаблонов: извлечение и подстановка плейсхолдеров {{placeholder}},
 * валидация значений переменных, генерация безопасных имён файлов,
 * утилиты поиска и сортировки. Вся обработка — локальная, без сети.
 */

import { TYPE_LABELS } from '../types.js';

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_.-]{0,63})\s*\}\}/g;

/**
 * Извлечь все уникальные ключи плейсхолдеров из содержимого шаблона.
 * @param {string} content
 * @returns {string[]}
 */
export function extractPlaceholders(content) {
  const keys = [];
  const seen = new Set();
  for (const match of String(content ?? '').matchAll(PLACEHOLDER_RE)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      keys.push(match[1]);
    }
  }
  return keys;
}

/**
 * Значения по умолчанию из описаний переменных.
 * @param {Array<{ key: string, defaultValue?: string }>} variables
 * @returns {Record<string, string>}
 */
export function defaultValues(variables) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const variable of variables ?? []) {
    if (variable?.key && typeof variable.defaultValue === 'string') values[variable.key] = variable.defaultValue;
  }
  return values;
}

/**
 * Проверить заполнение обязательных переменных.
 * @param {import('../types.js').DocTemplate} template
 * @param {Record<string, string>} values
 * @returns {string[]} список имён незаполненных обязательных переменных
 */
export function missingRequired(template, values) {
  return (template.variables ?? [])
    .filter((variable) => variable.required && !(typeof values?.[variable.key] === 'string' && values[variable.key].trim().length > 0))
    .map((variable) => variable.label ?? variable.key);
}

/**
 * Подставить значения переменных в плейсхолдеры {{key}}.
 * Отсутствующие обязательные значения — ошибка; необязательные подставляются
 * defaultValue, иначе плейсхолдер остаётся в тексте (чтобы его было видно).
 * Значения никогда не интерпретируются как разметка или код — они вставляются
 * как есть; экранирование выполняется при рендере в UI.
 * @param {string} content содержимое шаблона
 * @param {Array<{ key: string, defaultValue?: string }>} variables описания переменных
 * @param {Record<string, string>} values значения пользователя
 * @returns {{ ok: boolean, document?: string, missing?: string[], unfilled?: string[] }}
 */
export function renderTemplate(content, variables, values) {
  const source = String(content ?? '');
  const declared = new Map((variables ?? []).map((variable) => [variable.key, variable]));
  /** @type {Record<string, string>} */
  const resolved = { ...defaultValues(variables), ...(values ?? {}) };
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const unfilled = [];
  const document = source.replace(PLACEHOLDER_RE, (raw, key) => {
    const value = resolved[key];
    if (typeof value === 'string' && value.length > 0) return value;
    const variable = declared.get(key);
    if (variable?.required) missing.push(variable.label ?? key);
    unfilled.push(key);
    return raw;
  });
  if (missing.length > 0) {
    return { ok: false, missing: [...new Set(missing)], unfilled };
  }
  return { ok: true, document, unfilled: [...new Set(unfilled)] };
}

/**
 * Сгенерировать документ из шаблона. Удобная обёртка над renderTemplate,
 * добавляющая автоматические переменные {{date}} и {{project_name}},
 * если они объявлены в шаблоне, но не заданы пользователем.
 * @param {import('../types.js').DocTemplate} template
 * @param {Record<string, string>} values
 * @param {{ date?: string, projectName?: string }} [context]
 * @returns {{ ok: boolean, document?: string, missing?: string[], unfilled?: string[] }}
 */
export function generateDocument(template, values, context = {}) {
  /** @type {Record<string, string>} */
  const merged = { ...(values ?? {}) };
  const declaredKeys = new Set((template.variables ?? []).map((variable) => variable.key));
  if (declaredKeys.has('date') && !merged.date) merged.date = context.date ?? new Date().toISOString().slice(0, 10);
  if (declaredKeys.has('project_name') && !merged.project_name && context.projectName) merged.project_name = context.projectName;
  return renderTemplate(template.content, template.variables, merged);
}

/**
 * Очистить название для использования в имени файла:
 * убрать запрещённые символы, управляющие символы, лишние пробелы и точки на концах.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFileName(name) {
  const cleaned = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120)
    .trim();
  return cleaned || 'Документ';
}

/**
 * Имя файла документа: «<Название>_<ГГГГ-ММ-ДД>.md».
 * @param {string} templateName
 * @param {Date} [date]
 * @param {('markdown'|'plaintext')} [format]
 * @returns {string}
 */
export function buildDocumentFileName(templateName, date = new Date(), format = 'markdown') {
  const iso = date.toISOString().slice(0, 10);
  const extension = format === 'plaintext' ? 'txt' : 'md';
  return `${sanitizeFileName(templateName)}_${iso}.${extension}`;
}

/**
 * Подобрать свободное имя файла: при конфликте добавить числовой суффикс `_2`, `_3`, …
 * @param {string} directoryContents имена файлов/записей в целевом каталоге
 * @param {string} baseName желаемое имя файла с расширением
 * @returns {string}
 */
export function nextAvailableFileName(directoryContents, baseName) {
  const taken = new Set(directoryContents);
  if (!taken.has(baseName)) return baseName;
  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const extension = dot > 0 ? baseName.slice(dot) : '';
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${stem}_${index}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}_${Date.now().toString(36)}${extension}`;
}

/**
 * Поиск по названию, описанию, тегам и содержимому (регистронезависимо).
 * @param {import('../types.js').DocTemplate} template
 * @param {string} query
 * @returns {boolean}
 */
export function matchesQuery(template, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    template.name,
    template.description ?? '',
    (template.tags ?? []).join(' '),
    template.content,
  ].join('\n').toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

/**
 * Сравнение версий по semver-основным числам (для сортировки и отчётов).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const pa = String(a ?? '0.0.0').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b ?? '0.0.0').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * Тип шаблона с человекочитаемым названием (для UI и списков).
 * @param {import('../types.js').DocTemplate} template
 * @returns {{ type: string, label: string }}
 */
export function typeInfo(template) {
  return { type: template.type, label: TYPE_LABELS[template.type] ?? template.type };
}

/**
 * Сводка шаблона для списков (без содержимого).
 * @param {import('../types.js').DocTemplate} template
 * @param {{ builtin?: boolean }} [flags]
 */
export function templateSummary(template, flags = {}, typeLabels = null) {
  return {
    id: template.id,
    name: template.name,
    type: template.type,
    typeLabel: typeLabels?.[template.type] ?? TYPE_LABELS[template.type] ?? template.type,
    scope: template.scope,
    projectId: template.projectId ?? null,
    projectName: template.projectName ?? null,
    description: template.description ?? '',
    format: template.format ?? 'markdown',
    tags: template.tags ?? [],
    version: template.version ?? '1.0.0',
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    author: template.author ?? null,
    variables: (template.variables ?? []).map((variable) => ({
      key: variable.key,
      label: variable.label ?? variable.key,
      required: Boolean(variable.required),
      hasDefault: typeof variable.defaultValue === 'string' && variable.defaultValue.length > 0,
      ...(typeof variable.defaultValue === 'string' ? { defaultValue: variable.defaultValue } : {}),
      ...(variable.helpText ? { helpText: variable.helpText } : {}),
    })),
    builtin: Boolean(flags.builtin ?? template.builtin),
    readonly: Boolean(flags.readonly ?? template.readonly),
    contentLength: template.content.length,
    placeholders: extractPlaceholders(template.content),
  };
}
