import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DocTemplateStore, projectIdOf, projectNameOf } from '../src/storage/storage.js';
import { SEED_IDS, SEED_NORMALIZED } from '../src/templates/seedTemplates.js';

async function tempStore(options = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-store-'));
  const store = new DocTemplateStore({ directory, ...options });
  return { store, directory };
}

const sample = (overrides = {}) => ({
  name: 'Мой шаблон',
  type: 'custom',
  scope: 'global',
  content: '# {{title}}\nСодержимое',
  description: 'тестовый шаблон',
  tags: ['тест'],
  ...overrides,
});

test('хранилище содержит 8 встроенных read-only шаблонов', async () => {
  const { store } = await tempStore();
  const list = await store.list();
  const builtin = list.rows.filter((row) => row.builtin);
  assert.equal(builtin.length, SEED_NORMALIZED.length);
  assert.ok(SEED_IDS.has('seed-requirements-functional'));
  const found = await store.get('seed-requirements-functional');
  assert.equal(found.ok, true);
  assert.equal(found.builtin, true);
  assert.ok(found.template.content.includes('Функциональные требования'));

  const updateAttempt = await store.update('seed-requirements-functional', { name: 'Взлом' });
  assert.equal(updateAttempt.ok, false);
  const deleteAttempt = await store.delete('seed-requirements-functional');
  assert.equal(deleteAttempt.ok, false);
});

test('create / get / update / delete пользовательского шаблона', async () => {
  const { store } = await tempStore();
  const created = await store.create(sample());
  assert.equal(created.ok, true);
  const id = created.template.id;

  const fetched = await store.get(id);
  assert.equal(fetched.ok, true);
  assert.equal(fetched.template.name, 'Мой шаблон');

  const updated = await store.update(id, { description: 'обновлено' });
  assert.equal(updated.ok, true);
  const refetched = await store.get(id);
  assert.equal(refetched.template.description, 'обновлено');

  const removed = await store.delete(id);
  assert.equal(removed.ok, true);
  assert.equal((await store.get(id)).ok, false);
});

test('create отвергает невалидный шаблон и дубликат id', async () => {
  const { store } = await tempStore();
  const bad = await store.create(sample({ content: '' }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /валидаци/);

  const first = await store.create(sample({ id: 'custom-1' }));
  assert.equal(first.ok, true);
  const second = await store.create(sample({ id: 'custom-1' }));
  assert.equal(second.ok, false);
  assert.match(second.error, /уже существует/);
});

test('поиск, фильтры и сортировка', async () => {
  const { store } = await tempStore();
  await store.create(sample({ name: 'Альфа', tags: ['frontend'], type: 'test_case' }));
  await store.create(sample({ name: 'Бета', tags: ['backend'], type: 'requirements' }));

  const byQuery = await store.list({ query: 'альф' });
  assert.deepEqual(byQuery.rows.filter((r) => !r.builtin).map((r) => r.name), ['Альфа']);
  const byType = await store.list({ type: 'requirements' });
  assert.ok(byType.rows.every((row) => row.type === 'requirements'));
  const byTag = await store.list({ tag: 'backend' });
  assert.deepEqual(byTag.rows.filter((r) => !r.builtin).map((r) => r.name), ['Бета']);
  const sorted = await store.list({ sort: 'name', direction: 'desc' });
  const names = sorted.rows.map((r) => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => b.localeCompare(a, 'ru')));
  const tags = await store.list();
  assert.ok(tags.tags.includes('frontend') && tags.tags.includes('backend'));
});

test('проектные шаблоны изолированы по projectId', async () => {
  const { store } = await tempStore();
  const created = await store.create(sample({ name: 'Проектный', scope: 'project' }), { projectId: 'p1', projectName: 'alpha' });
  assert.equal(created.ok, true);
  assert.equal(created.template.projectId, 'p1');

  const forP1 = await store.list({ projectId: 'p1' });
  assert.ok(forP1.rows.some((row) => row.name === 'Проектный'));
  const forP2 = await store.list({ projectId: 'p2' });
  assert.ok(!forP2.rows.some((row) => row.name === 'Проектный'));
  const noProject = await store.list({ projectId: null });
  assert.ok(!noProject.rows.some((row) => row.name === 'Проектный'));
});

test('projectIdOf — стабильный хеш без абсолютных путей', () => {
  assert.equal(projectIdOf('/Users/mvp/projects/alpha'), projectIdOf('/Users/mvp/projects/alpha'));
  assert.notEqual(projectIdOf('/Users/mvp/projects/alpha'), projectIdOf('/Users/mvp/projects/beta'));
  assert.equal(projectIdOf('/Users/mvp/projects/alpha').length, 16);
  assert.ok(!JSON.stringify({ id: projectIdOf('/Users/mvp/secret-project') }).includes('/Users'));
  assert.equal(projectNameOf('/Users/mvp/projects/alpha'), 'alpha');
});

test('дублирование встроенного шаблона создаёт редактируемую копию', async () => {
  const { store } = await tempStore();
  const copy = await store.duplicate('seed-test-case', { name: 'Мой тест-кейс' });
  assert.equal(copy.ok, true);
  assert.equal(copy.template.builtin, false);
  assert.equal(copy.template.readonly, false);
  assert.equal(copy.template.name, 'Мой тест-кейс');
  const edited = await store.update(copy.template.id, { description: 'правится свободно' });
  assert.equal(edited.ok, true);
});

test('экспорт не содержит встроенных меток и абсолютных путей', async () => {
  const { store } = await tempStore();
  await store.create(sample({ id: 'custom-x' }));
  const exported = await store.exportTemplates({ ids: ['custom-x'] });
  assert.equal(exported.ok, true);
  assert.equal(exported.document.format, 'doc-templates-panel/templates');
  assert.equal(exported.document.templates.length, 1);
  const text = JSON.stringify(exported.document);
  assert.ok(!text.includes('"builtin"'));
  assert.ok(!text.includes('"readonly"'));
});

test('импорт: предпросмотр, перезапись требует подтверждения, стратегии работают', async () => {
  const { store } = await tempStore();
  await store.create(sample({ id: 'custom-x', name: 'Старое имя' }));
  const document = {
    format: 'doc-templates-panel/templates',
    schemaVersion: 1,
    templates: [
      sample({ id: 'custom-x', name: 'Новое имя' }),
      sample({ id: 'custom-y', name: 'Совершенно новый' }),
    ],
  };

  const preview = await store.importTemplates(document, {});
  assert.equal(preview.ok, true);
  assert.equal(preview.preview, true);
  const updateEntry = preview.diff.find((entry) => entry.id === 'custom-x');
  const createEntry = preview.diff.find((entry) => entry.id === 'custom-y');
  assert.equal(updateEntry.action, 'update');
  assert.equal(createEntry.action, 'create');

  const refused = await store.importTemplates(document, { apply: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.needsConfirmation, true);

  const applied = await store.importTemplates(document, { apply: true, confirmOverwrite: true, strategy: 'merge' });
  assert.equal(applied.ok, true);
  const renamed = await store.get('custom-x');
  assert.equal(renamed.template.name, 'Новое имя');

  const skip = await store.importTemplates(document, { apply: true, confirmOverwrite: true, strategy: 'skip-existing' });
  assert.ok(skip.outcomes.every((o) => o.action === 'skip'));

  const copied = await store.importTemplates(document, { apply: true, confirmOverwrite: true, strategy: 'create-copy' });
  const copies = copied.outcomes.filter((o) => o.action === 'create-copy');
  assert.equal(copies.length, 2);
  assert.ok((await store.get(copies[0].newId)).ok);
});

test('импорт отклоняет битый JSON и чужой формат', async () => {
  const { store } = await tempStore();
  const badJson = await store.importTemplates('{ нет json', {});
  assert.equal(badJson.ok, false);
  assert.match(badJson.error, /JSON/);
  const badFormat = await store.importTemplates({ format: 'other/format', templates: [] }, {});
  assert.equal(badFormat.ok, false);
  assert.match(badFormat.error, /doc-templates-panel/);
});

test('повреждённый файл: хранилище не падает, предлагает восстановление из копии', async () => {
  const { store, directory } = await tempStore();
  await store.create(sample({ id: 'custom-keep' }));
  await store.file.createBackup('manual');
  const backups = await store.listBackups();
  assert.ok(backups.length >= 1);

  await fsp.writeFile(store.file.filePath, '{ это не json !!!', 'utf8');
  const fresh = new DocTemplateStore({ directory });
  const list = await fresh.list();
  assert.equal(list.ok, true);
  assert.ok(fresh.lastLoadReport.corruptedAside, 'повреждённый файл должен быть сохранён рядом');
  assert.ok(fresh.lastLoadReport.recoveredFromBackup, 'восстановление из резервной копии должно сработать');
  const kept = await fresh.get('custom-keep');
  assert.equal(kept.ok, true);

  const restore = await fresh.restoreFromBackup();
  assert.equal(restore.ok, true);
});

test('generate возвращает имя файла и подстановку', async () => {
  const { store } = await tempStore();
  const created = await store.create(sample({
    name: 'Требования к функциональности',
    content: '# {{project_name}} — {{title}}',
    variables: [
      { key: 'project_name', required: true, label: 'Проект' },
      { key: 'title', required: true },
    ],
  }));
  const fail = await store.generate(created.template.id, {});
  assert.equal(fail.ok, false);
  assert.match(fail.error, /Проект/);
  const done = await store.generate(created.template.id, { project_name: 'Альфа', title: 'Обзор' });
  assert.equal(done.ok, true);
  assert.equal(done.document, '# Альфа — Обзор');
  assert.match(done.fileName, /^Требования к функциональности_\d{4}-\d{2}-\d{2}\.md$/);
});

test('атомарная запись не оставляет временных файлов', async () => {
  const { store, directory } = await tempStore();
  await store.create(sample());
  const entries = await fsp.readdir(directory);
  assert.ok(entries.includes('templates.json'));
  assert.ok(!entries.some((name) => name.endsWith('.tmp')));
});

test('пользовательские типы документации: добавление, переименование, удаление', async () => {
  const { store } = await tempStore();
  const base = await store.listTypes();
  assert.equal(base.builtin.length, 7);
  assert.equal(base.custom.length, 0);

  const added = await store.addType('Пользовательская история');
  assert.equal(added.ok, true);
  assert.match(added.type.id, /^ctype:/);
  assert.equal(added.type.label, 'Пользовательская история');

  const duplicate = await store.addType('Другое имя', added.type.id);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /уже существует/);

  const bad = await store.addType('Без имени', 'не-префикс');
  assert.equal(bad.ok, false);

  // typeLabel разрешается в списках и get.
  await store.create(sample({ name: 'С кастомным типом', type: added.type.id }));
  const list = await store.list({ type: added.type.id });
  const row = list.rows.find((entry) => entry.name === 'С кастомным типом');
  assert.ok(row, 'шаблон с кастомным типом находится фильтром');
  assert.equal(row.typeLabel, 'Пользовательская история');
  assert.ok(list.types.some((type) => type.id === added.type.id && !type.builtin));

  const renamed = await store.renameType(added.type.id, 'User Story');
  assert.equal(renamed.ok, true);
  const relisted = await store.list({ type: added.type.id });
  assert.equal(relisted.rows.find((entry) => entry.name === 'С кастомным типом').typeLabel, 'User Story');

  const blocked = await store.deleteType(added.type.id);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /используется шаблонами/);

  const renamedBuiltin = await store.renameType('requirements', 'Взлом');
  assert.equal(renamedBuiltin.ok, false);
  const deletedBuiltin = await store.deleteType('requirements');
  assert.equal(deletedBuiltin.ok, false);
});

test('кастомные типы переносятся экспортом/импортом', async () => {
  const { store, directory } = await tempStore();
  await store.addType('Постмортем инцидента');
  const exported = await store.exportTemplates({ all: true });
  assert.ok(exported.document.customTypes?.some((type) => type.label === 'Постмортем инцидента'));

  const other = new DocTemplateStore({ directory: path.join(directory, 'other') });
  const imported = await other.importTemplates(exported.document, { apply: true, confirmOverwrite: true });
  assert.equal(imported.ok, true);
  assert.ok(imported.outcomes.some((entry) => entry.action === 'type-create'));
  const types = await other.listTypes();
  assert.ok(types.custom.some((type) => type.label === 'Постмортем инцидента'));
});
