/**
 * E2E-тест хост-половины плагина: регистрация команды и инструментов,
 * создание шаблона, генерация документа, сохранение в <workspace>/docs/,
 * экспорт и импорт. Файловая служба и рабочая директория эмулируются
 * поверх временного каталога (те же контракты, что у ctx.fs/ctx.workingDirectory).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { apply, PLUGIN_NAME, COMMAND_OPS } from '../src/plugin.js';
import * as entry from '../index.js';
import { registerDocTemplateTools } from '../src/tools/docTemplateTools.js';

function makeCtx({ home, workspace }) {
  const registered = { commands: [], tools: [], effects: [] };
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    commands: { register(definition) { registered.commands.push(definition); } },
    tools: { register(definition) { registered.tools.push(definition); } },
    effect(fn, label) { registered.effects.push(label); fn(); },
    workingDirectory: { get: () => workspace },
    sandboxPolicy: { resolve: () => undefined },
    fs: {
      async resolve(relativePath, options = {}) {
        const base = options.cwd ?? workspace;
        const target = path.resolve(base, relativePath);
        if (!target.startsWith(path.resolve(base))) {
          const error = new Error('FS_OUTSIDE_WORKSPACE');
          error.code = 'FS_OUTSIDE_WORKSPACE';
          throw error;
        }
        return target;
      },
      async stat(target) {
        try {
          const info = await fsp.stat(target);
          return { type: info.isFile() ? 'file' : 'directory', size: info.size, version: 'v' };
        } catch {
          return undefined;
        }
      },
      async writeText(target, content) {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, content, 'utf8');
      },
    },
  };
  return { ctx, registered };
}

function makeAgent() {
  return { session: { id: 's1' } };
}

async function runCommand(ctx, registered, args, agent) {
  const command = registered.commands.find((definition) => definition.name === 'doc-templates');
  assert.ok(command, 'сессионная команда doc-templates должна быть зарегистрирована');
  const outcome = await command.handler({ agent, rawInput: JSON.stringify(args), signal: undefined });
  assert.equal(outcome.kind, 'success', `операция ${args.op} должна пройти: ${outcome.text ?? ''}`);
  return JSON.parse(outcome.text);
}

test('плагин экспортирует name и apply, регистрирует команду и 13 инструментов', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-home-'));
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-ws-'));
  const { ctx, registered } = makeCtx({ home, workspace });
  const dispose = apply(ctx, { directory: path.join(home, 'store') });
  assert.equal(typeof dispose, 'function');
  assert.equal(PLUGIN_NAME, 'doc-templates-panel');
  // Точка входа пакета экспортирует name и apply(ctx) — контракт плагина DSH.
  assert.equal(entry.name, 'doc-templates-panel');
  assert.equal(typeof entry.apply, 'function');
  assert.ok(Array.isArray(entry.inject) && entry.inject.includes('tools'));
  assert.ok(!entry.inject.includes('logger'), 'logger не является инъецируемым сервисом DSH');
  assert.equal(registered.tools.length, 13);
  const toolNames = registered.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    'doc_templates_list',
    'doc_templates_get',
    'doc_templates_create',
    'doc_templates_update',
    'doc_templates_delete',
    'doc_templates_generate',
    'doc_templates_save_document',
    'doc_templates_export',
    'doc_templates_import',
    'doc_templates_type_list',
    'doc_templates_type_add',
    'doc_templates_type_update',
    'doc_templates_type_delete',
  ]);
  assert.ok(COMMAND_OPS.includes('save-document'));
  // Все инструменты объявляют output {schema, render}, как требует реестр DSH.
  for (const tool of registered.tools) {
    assert.ok(tool.output && typeof tool.output.render === 'function' && tool.output.schema, `инструмент ${tool.name} должен объявлять output {schema, render}`);
    assert.ok(tool.output.render({}, { ok: true, rows: [] }).every((part) => typeof part.text === 'string'), `render инструмента ${tool.name} возвращает текст`);
  }
});

test('E2E: панель → создание шаблона → генерация → сохранение в docs/ → экспорт → импорт', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-e2e-home-'));
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-e2e-ws-'));
  const { ctx, registered } = makeCtx({ home, workspace });
  const storeDir = path.join(home, 'store');
  apply(ctx, { directory: storeDir });
  const agent = makeAgent();

  // 1. Открытие панели: список содержит встроенные шаблоны.
  const initial = await runCommand(ctx, registered, { op: 'list' }, agent);
  assert.equal(initial.ok, true);
  assert.ok(initial.rows.some((row) => row.builtin && row.id === 'seed-requirements-functional'));

  // 2. Создание шаблона.
  const created = await runCommand(ctx, registered, {
    op: 'create',
    template: {
      name: 'Требования к функциональности (проект)',
      type: 'requirements',
      scope: 'project',
      description: 'Проектная версия',
      content: '# {{project_name}}\n\n## Цели\n{{goals}}\n',
      variables: [
        { key: 'project_name', label: 'Проект', required: true },
        { key: 'goals', label: 'Цели', required: true },
      ],
      tags: ['проект'],
    },
  }, agent);
  assert.equal(created.ok, true, created.error ?? '');
  assert.equal(created.template.scope, 'project');
  assert.ok(created.template.projectId, 'projectId должен быть назначен из рабочей директории');
  const id = created.template.id;

  // 3. Генерация документа из переменных.
  const generated = await runCommand(ctx, registered, {
    op: 'generate',
    id,
    values: { project_name: 'Альфа', goals: 'Быстро и надёжно' },
  }, agent);
  assert.equal(generated.ok, true, generated.error ?? '');
  assert.equal(generated.document.includes('# Альфа'), true);
  assert.match(generated.fileName, /^Требования к функциональности \(проект\)_\d{4}-\d{2}-\d{2}\.md$/);

  // 4. Сохранение в <workspace>/docs/: сначала предпросмотр пути, затем запись.
  const proposed = await runCommand(ctx, registered, { op: 'save-document', id, values: { project_name: 'Альфа', goals: 'Быстро и надёжно' }, dryRun: true }, agent);
  assert.equal(proposed.ok, true);
  assert.equal(proposed.relativePath, `docs/${generated.fileName}`);

  const saved = await runCommand(ctx, registered, { op: 'save-document', id, values: { project_name: 'Альфа', goals: 'Быстро и надёжно' } }, agent);
  assert.equal(saved.ok, true, saved.error ?? '');
  assert.equal(saved.relativePath, proposed.relativePath);
  const written = await fsp.readFile(path.join(workspace, 'docs', saved.fileName), 'utf8');
  assert.ok(written.includes('# Альфа'));

  // 4а. Конфликт имён: повторное сохранение получает суффикс _2.
  const second = await runCommand(ctx, registered, { op: 'save-document', id, values: { project_name: 'Альфа', goals: 'Быстро и надёжно' } }, agent);
  assert.equal(second.fileName, saved.fileName.replace(/\.md$/, '_2.md'));
  const thirdDry = await runCommand(ctx, registered, { op: 'save-document', id, values: { project_name: 'Альфа', goals: 'Быстро и надёжно' }, dryRun: true }, agent);
  assert.equal(thirdDry.fileName, saved.fileName.replace(/\.md$/, '_3.md'));
  assert.equal(await fsp.stat(path.join(workspace, 'docs', thirdDry.fileName)).then(() => true, () => false), false, 'dryRun не пишет файл');

  // 5. Экспорт всех шаблонов.
  const exported = await runCommand(ctx, registered, { op: 'export', all: true }, agent);
  assert.equal(exported.ok, true);
  assert.ok(exported.document.templates.some((template) => template.id === id));
  assert.equal(exported.document.format, 'doc-templates-panel/templates');

  // 6. Импорт в другое хранилище (эмуляция второго компьютера).
  const otherDir = path.join(home, 'store-2');
  const other = makeCtx({ home, workspace });
  apply(other.ctx, { directory: otherDir });
  const imported = await runCommand(other.ctx, other.registered, { op: 'import', document: exported.document, strategy: 'merge', apply: true }, agent);
  assert.equal(imported.ok, true, JSON.stringify(imported));
  const listed = await runCommand(other.ctx, other.registered, { op: 'list', allProjects: true }, agent);
  assert.ok(listed.rows.some((row) => row.id === id && row.name === 'Требования к функциональности (проект)'));

  // 7. Статус хранилища: версия схемы и каталог в профиле.
  const status = await runCommand(ctx, registered, { op: 'status' }, agent);
  assert.equal(status.ok, true);
  assert.equal(status.store.schemaVersion, 2);
  // Каталог по умолчанию — внутри профиля DSH (в тесте путь переопределён явно).
  assert.ok(status.store.directoryEnv.includes('doc-templates-panel'));
  assert.equal(status.store.directory, storeDir);

  // 8. Удаление пользовательского шаблона; после удаления get возвращает ошибку.
  const removed = await runCommand(ctx, registered, { op: 'delete', id }, agent);
  assert.equal(removed.ok, true);
  const deleteCommand = registered.commands.find((definition) => definition.name === 'doc-templates');
  const afterDelete = await deleteCommand.handler({ agent, rawInput: JSON.stringify({ op: 'get', id }) });
  assert.equal(afterDelete.kind, 'error');
  assert.match(afterDelete.text, /Шаблон не найден/);
});

test('инструменты используют общий диспетчер (create через doc_templates_create)', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-tool-'));
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-tool-ws-'));
  const { ctx, registered } = makeCtx({ home, workspace });
  apply(ctx, { directory: path.join(home, 'store') });
  const tool = registered.tools.find((definition) => definition.name === 'doc_templates_create');
  assert.ok(tool);
  const result = await tool.execute({ template: { name: 'Из инструмента', type: 'custom', scope: 'global', content: '# x' } }, { agent: makeAgent() });
  assert.equal(result.ok, true, result.error ?? '');
  const listTool = registered.tools.find((definition) => definition.name === 'doc_templates_list');
  const listed = await listTool.execute({ query: 'инструмента' }, { agent: makeAgent() });
  assert.ok(listed.rows.some((row) => row.name === 'Из инструмента'));
  assert.ok(listTool.parameters?.properties?.query, 'инструмент doc_templates_list объявляет JSON-схему параметров');
});

test('save_document без рабочей директории даёт понятную ошибку', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-nocwd-'));
  const { ctx, registered } = makeCtx({ home, workspace: null });
  ctx.workingDirectory = { get: () => null };
  apply(ctx, { directory: path.join(home, 'store') });
  const saveTool = registered.tools.find((definition) => definition.name === 'doc_templates_save_document');
  const result = await saveTool.execute({ document: '# тест' }, { agent: makeAgent() });
  assert.equal(result.ok, false);
  assert.match(result.error, /рабочей директори/);
});

test('встроенные шаблоны проходя полный цикл генерации (seed smoke)', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-seed-'));
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-seed-ws-'));
  const { ctx, registered } = makeCtx({ home, workspace });
  apply(ctx, { directory: path.join(home, 'store') });
  const agent = makeAgent();
  const list = await runCommand(ctx, registered, { op: 'list', type: 'requirements' }, agent);
  const seeds = list.rows.filter((row) => row.builtin);
  assert.ok(seeds.length >= 2);
  for (const seed of seeds) {
    const generated = await runCommand(ctx, registered, { op: 'generate', id: seed.id, values: { project_name: 'Дым', title: 'Тест', goals: '—', feature: '—', cycle: '—', release: '—', case_id: 'TC-001', build: '1', component: '—', load_profile: '—', reviewers: '—' } }, agent);
    assert.equal(generated.ok, true, `шаблон ${seed.id} должен генерироваться: ${generated.error ?? ''}`);
    assert.ok(generated.document.length > 200);
  }
});

test('E2E: типы документации — добавление, шаблон кастомного типа, документ, удаление', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-types-home-'));
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-types-ws-'));
  const { ctx, registered } = makeCtx({ home, workspace });
  apply(ctx, { directory: path.join(home, 'store') });
  const agent = makeAgent();

  // 1. Добавление пользовательского типа (кириллица транслитерируется в id).
  const added = await runCommand(ctx, registered, { op: 'type-add', label: 'Пользовательская история' }, agent);
  assert.equal(added.ok, true, added.error ?? '');
  assert.match(added.type.id, /^ctype:[a-z0-9-]+$/);
  assert.equal(added.type.label, 'Пользовательская история');

  const types = await runCommand(ctx, registered, { op: 'type-list' }, agent);
  assert.equal(types.builtin.length, 7);
  assert.equal(types.custom.length, 1);
  assert.ok(types.custom.some((type) => type.id === added.type.id));

  // 2. Шаблон кастомного типа появляется в общем списке с подписью типа.
  const created = await runCommand(ctx, registered, {
    op: 'create',
    template: {
      name: 'История: вход по.passkey',
      type: added.type.id,
      scope: 'global',
      content: '# {{story}}\n\nКак <роль>, я хочу <действие>, чтобы <ценность>.\n',
      variables: [{ key: 'story', label: 'Название истории', required: true }],
    },
  }, agent);
  assert.equal(created.ok, true, created.error ?? '');
  assert.equal(created.template.typeLabel, 'Пользовательская история');
  const listed = await runCommand(ctx, registered, { op: 'list' }, agent);
  const row = listed.rows.find((entry) => entry.id === created.template.id);
  assert.equal(row.typeLabel, 'Пользовательская история');

  // 3. Генерация и сохранение документа кастомного типа.
  const saved = await runCommand(ctx, registered, { op: 'save-document', id: created.template.id, values: { story: 'Вход по passkey' } }, agent);
  assert.equal(saved.ok, true, saved.error ?? '');
  const written = await fsp.readFile(path.join(workspace, saved.relativePath), 'utf8');
  assert.ok(written.includes('# Вход по passkey'));

  // 4. Удаление используемого типа блокируется; после смены типа — разрешено.
  const typeDeleteTool = registered.tools.find((definition) => definition.name === 'doc_templates_type_delete');
  const blocked = await typeDeleteTool.execute({ id: added.type.id }, { agent });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /используется шаблонами/);
  const upd = await runCommand(ctx, registered, { op: 'update', id: created.template.id, patch: { type: 'custom' } }, agent);
  const renamed = await runCommand(ctx, registered, { op: 'type-update', id: added.type.id, label: 'User Story' }, agent);
  assert.equal(renamed.ok, true);
  const removed = await runCommand(ctx, registered, { op: 'type-delete', id: added.type.id }, agent);
  assert.equal(removed.ok, true);
});
