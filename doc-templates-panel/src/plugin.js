/**
 * Хост-половина плагина doc-templates-panel.
 *
 * Регистрирует:
 *  - сессионную команду `/doc-templates <op> [json]` (мост для UI-панели);
 *  - 9 agent-инструментов doc_templates_* (см. tools/docTemplateTools.js).
 *
 * Команда и инструменты работают с общим `DocTemplateStore`. Данные хранятся
 * в переносимом каталоге профиля DSH; ничего не пишется в каталог установки
 * и в исходники плагина. Секреты и абсолютные пути не сохраняются.
 */

import path from 'node:path';

import { DocTemplateStore, projectIdOf, projectNameOf } from './storage/storage.js';
import { registerDocTemplateTools } from './tools/docTemplateTools.js';

export const PLUGIN_NAME = 'doc-templates-panel';
export const PLUGIN_VERSION = '1.0.0';

// `logger` не является инъецируемым сервисом DSH — ctx.logger доступен в
// контексте и без него; обращения уже защищены optional chaining.
export const inject = ['tools', 'commands', 'fs', 'workingDirectory', 'sandboxPolicy'];

export const Config = {
  '~standard': {
    vendor: PLUGIN_NAME,
    version: 1,
    validate(value) {
      const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const issues = [];
      const out = {};
      const directory = input.directory;
      if (directory !== undefined && typeof directory !== 'string') {
        issues.push({ message: 'directory должен быть строкой (относительный путь внутри профиля)', path: ['directory'] });
      } else {
        out.directory = typeof directory === 'string' && directory.trim() ? directory.trim() : undefined;
      }
      return issues.length > 0 ? { issues } : { value: out };
    },
  },
};

/** Обозначения операций сессионной команды. */
export const COMMAND_OPS = [
  'help', 'list', 'get', 'create', 'update', 'delete', 'duplicate',
  'generate', 'save-document', 'export', 'import', 'restore-backup', 'status',
  'type-list', 'type-add', 'type-update', 'type-delete',
];

/**
 * Хост-плагин. Возвращает функцию очистки.
 * @param {any} ctx контекст cordis
 * @param {{ directory?: string }} [config]
 */
export function apply(ctx, config = {}) {
  const store = new DocTemplateStore({ directory: config.directory });

  const loadReport = store.ensureLoaded()
    .then((report) => {
      if (report.recoveredFromBackup) {
        ctx.logger?.warn?.(`doc-templates-panel: файл данных был повреждён; восстановлен из резервной копии. Повреждённый файл сохранён рядом.`);
      } else if (report.corruptedAside) {
        ctx.logger?.warn?.(`doc-templates-panel: файл данных повреждён, резервной копии не нашлось. Начато пустое хранилище; прежний файл сохранён как ${path.basename(report.corruptedAside)} — его можно восстановить вручную.`);
      }
      if (report.migratedFrom !== null && report.migratedFrom !== undefined) {
        ctx.logger?.info?.(`doc-templates-panel: схема данных мигрирована с версии ${report.migratedFrom}.`);
      }
      return report;
    })
    .catch((error) => {
      ctx.logger?.error?.(`doc-templates-panel: хранилище недоступно: ${error?.message ?? error}`);
      return { failed: true, message: error?.message ?? String(error) };
    });

  // -- контекст проекта (cwd-зависимый, как принято в Harness) ----------------

  function projectOf(agent) {
    let cwd = null;
    try {
      cwd = ctx.workingDirectory?.get?.(agent?.session) ?? null;
    } catch {
      cwd = agent?.session?.header?.cwd ?? null;
    }
    if (!cwd) return { root: null, projectId: null, projectName: null };
    return { root: cwd, projectId: projectIdOf(cwd), projectName: projectNameOf(cwd) };
  }

  async function workingDirectoryOf(agent) {
    const project = projectOf(agent);
    if (!project.root) {
      return { ok: false, error: 'У сессии нет рабочей директории: сохранение документа невозможно. Откройте панель в сессии с проектом.' };
    }
    if (!ctx.fs) {
      return { ok: false, error: 'Файловая служба недоступна: сохранение в рабочее пространство невозможно. Скопируйте документ в буфер обмена.' };
    }
    return { ok: true, ...project };
  }

  /**
   * Подобрать свободное имя файла в docs/ (суффиксы _2, _3, …).
   * @param {any} fs файловая служба
   * @param {any} resolvedDir резолв каталога docs
   * @param {string} baseName желаемое имя
   */
  async function pickFileName(fs, resolvedDir, baseName) {
    const dot = baseName.lastIndexOf('.');
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
    const extension = dot > 0 ? baseName.slice(dot) : '';
    let candidate = baseName;
    for (let index = 1; index < 10000; index += 1) {
      const target = await fs.resolve(path.join(resolvedDir, candidate));
      const info = await fs.stat(target).catch(() => undefined);
      if (info === undefined || info === null) return candidate;
      candidate = `${stem}_${index + 1}${extension}`;
    }
    return `${stem}_${Date.now().toString(36)}${extension}`;
  }

  /**
   * Сохранение сгенерированного документа в <workspace>/docs/.
   * @param {any} agent
   * @param {{ id?: string, values?: Record<string,string>, document?: string, fileName?: string, dryRun?: boolean }} args
   */
  async function saveDocument(agent, args) {
    const ws = await workingDirectoryOf(agent);
    if (!ws.ok) return ws;
    let document = args.document;
    let fileName = args.fileName;
    if (!document) {
      if (!args.id) return { ok: false, error: 'Нужен либо id шаблона (id), либо готовый текст документа (document).' };
      const generated = await store.generate(args.id, args.values ?? {}, { projectName: ws.projectName });
      if (!generated.ok) return generated;
      document = generated.document;
      fileName = fileName ?? generated.fileName;
    }
    const safeName = fileName && fileName.trim() ? fileName.trim() : 'Документ.md';
    const docsDir = await ctx.fs.resolve('docs', { cwd: ws.root });
    const finalName = await pickFileName(ctx.fs, docsDir, safeName);
    const relativePath = `docs/${finalName}`;
    if (args.dryRun) {
      return { ok: true, dryRun: true, relativePath, fileName: finalName, workspaceRoot: ws.root, projectName: ws.projectName };
    }
    const target = await ctx.fs.resolve(relativePath, { cwd: ws.root });
    const policy = ctx.sandboxPolicy?.resolve ? ctx.sandboxPolicy.resolve({ session: agent?.session }) : undefined;
    try {
      // writeText создаёт недостающие каталоги рекурсивно (docs/ появится сам).
      await ctx.fs.writeText(target, document, undefined, undefined, policy);
    } catch (error) {
      return { ok: false, error: `Не удалось записать файл ${relativePath}: ${error?.message ?? String(error)}` };
    }
    return { ok: true, relativePath, fileName: finalName, bytes: document.length, workspaceRoot: ws.root };
  }

  // -- единая диспетчеризация операций ----------------------------------------

  /**
   * @param {Record<string, any>} args
   * @param {any} agent
   * @param {AbortSignal} [signal]
   */
  async function dispatch(args, agent, signal) {
    const project = projectOf(agent);
    const context = { projectId: project.projectId, projectName: project.projectName };
    await loadReport;
    switch (args.op) {
      case 'help':
        return { ok: true, ops: COMMAND_OPS, json: 'Передавайте JSON после операции, например: /doc-templates list {"query":"требования"}' };
      case 'list':
        return store.list({
          query: args.query,
          type: args.type,
          scope: args.scope,
          tag: args.tag,
          projectId: args.allProjects ? undefined : project.projectId,
          includeOtherProjects: Boolean(args.allProjects),
          sort: args.sort,
          direction: args.direction,
        });
      case 'get': {
        if (!args.id) return { ok: false, error: 'Укажите id шаблона.' };
        const result = await store.get(args.id);
        return result;
      }
      case 'create':
        return store.create(args.template ?? args, context);
      case 'update': {
        if (!args.id) return { ok: false, error: 'Укажите id шаблона.' };
        return store.update(args.id, args.patch ?? args.template ?? {});
      }
      case 'delete': {
        if (!args.id) return { ok: false, error: 'Укажите id шаблона.' };
        return store.delete(args.id);
      }
      case 'duplicate': {
        if (!args.id) return { ok: false, error: 'Укажите id шаблона.' };
        return store.duplicate(args.id, { name: args.name, projectId: context.projectId, projectName: context.projectName });
      }
      case 'generate': {
        if (!args.id) return { ok: false, error: 'Укажите id шаблона.' };
        return store.generate(args.id, args.values ?? {}, { projectName: project.projectName });
      }
      case 'save-document':
        return saveDocument(agent, args);
      case 'export':
        return store.exportTemplates({ ids: args.ids, all: args.all, projectId: args.allProjects ? undefined : project.projectId });
      case 'import':
        return store.importTemplates(args.document, {
          strategy: args.strategy,
          confirmOverwrite: args.confirmOverwrite,
          apply: args.apply,
          projectId: context.projectId,
          projectName: context.projectName,
        });
      case 'restore-backup':
        return store.restoreFromBackup(args.backup);
      case 'type-list':
        return store.listTypes();
      case 'type-add':
        return store.addType(args.label, args.id);
      case 'type-update': {
        if (!args.id) return { ok: false, error: 'Укажите id типа (ctype:…).' };
        return store.renameType(args.id, args.label);
      }
      case 'type-delete': {
        if (!args.id) return { ok: false, error: 'Укажите id типа (ctype:…).' };
        return store.deleteType(args.id);
      }
      case 'status':
        return { ok: true, project: { root: project.root, projectId: project.projectId, projectName: project.projectName }, store: store.status(), backups: (await store.listBackups()).map((b) => b.file.split('/').pop()) };
      default:
        return { ok: false, error: `Неизвестная операция «${args.op}». Доступны: ${COMMAND_OPS.join(', ')}` };
    }
  }

  // -- сессионная команда (мост UI → хост) -------------------------------------

  ctx.effect(() => ctx.commands.register({
    name: 'doc-templates',
    description: 'Шаблоны документации: список, CRUD, генерация документов, сохранение в docs/, экспорт и импорт',
    input: { hint: '<op> [json] — попробуйте: /doc-templates help' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const input = (rawInput ?? '').trim();
      let args = { op: 'help' };
      if (input) {
        if (input.startsWith('{')) {
          try {
            const parsed = JSON.parse(input);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.op !== 'string') {
              return { kind: 'error', text: '/doc-templates: JSON должен быть объектом с полем "op".' };
            }
            args = parsed;
          } catch (error) {
            return { kind: 'error', text: `/doc-templates: некорректный JSON — ${error?.message ?? error}` };
          }
        } else {
          const space = input.indexOf(' ');
          const op = (space === -1 ? input : input.slice(0, space)).toLowerCase();
          const rest = space === -1 ? '' : input.slice(space + 1).trim();
          args = { op };
          if (rest) {
            try {
              const parsed = JSON.parse(rest);
              Object.assign(args, parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed });
            } catch {
              args.value = rest;
            }
          }
        }
      }
      try {
        const result = await dispatch(args, agent, signal);
        if (result === undefined) return { kind: 'success' };
        return result.ok === false
          ? { kind: 'error', text: JSON.stringify(result) }
          : { kind: 'success', text: JSON.stringify(result) };
      } catch (error) {
        ctx.logger?.error?.(`doc-templates-panel: операция ${args.op} завершилась ошибкой: ${error?.message ?? error}`);
        return { kind: 'error', text: JSON.stringify({ ok: false, error: error?.message ?? String(error) }) };
      }
    },
  }), 'doc-templates-panel: сессионная команда');

  // -- agent-инструменты --------------------------------------------------------

  ctx.effect(() => registerDocTemplateTools(ctx, { dispatch, saveDocument }), 'doc-templates-panel: инструменты');

  return () => {
    store.loadPromise = null;
  };
}
