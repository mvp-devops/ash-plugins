import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  migrateDocument,
  runMigrationsWithBackup,
  emptyDocument,
} from '../src/storage/migrations.js';
import { JsonFileStorage } from '../src/storage/jsonFileStorage.js';
import { backupPrefixOf } from './helpers.js';

test('документ без schemaVersion поднимается до актуальной версии', () => {
  const raw = { templates: [{ id: 'a', name: 'Шаблон', type: 'custom', scope: 'global', content: 'x' }] };
  const result = migrateDocument(raw);
  assert.equal(result.ok, true);
  assert.equal(result.migratedFrom, 0);
  assert.equal(result.document.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(result.document.templates.length, 1);
  assert.equal(result.document.format, 'doc-templates-panel/templates');
});

test('документ с будущей версией схемы отвергается с понятной ошибкой', () => {
  const result = migrateDocument({ schemaVersion: CURRENT_SCHEMA_VERSION + 5, templates: [] });
  assert.equal(result.ok, false);
  assert.match(result.error, /более новой версией/);
  assert.match(result.error, /обновите плагин|Обновите плагин/i);
});

test('миграция шага v0 → v1 выполняется по цепочке (регистрируем временный шаг)', () => {
  const original = MIGRATIONS.get(0);
  MIGRATIONS.set(0, (doc) => ({ ...doc, templates: (doc.templates ?? []).map((t) => ({ ...t, migrated: true })) }));
  try {
    const result = migrateDocument({ templates: [{ id: 'a' }] });
    assert.equal(result.ok, true);
    assert.equal(result.document.templates[0].migrated, true);
    assert.equal(result.migratedFrom, 0);
  } finally {
    if (original) MIGRATIONS.set(0, original);
    else MIGRATIONS.delete(0);
  }
});

test('migrateDocument сообщает о не-объекте и отсутствии templates', () => {
  assert.equal(migrateDocument(null).ok, false);
  assert.equal(migrateDocument([1, 2]).ok, false);
  assert.match(migrateDocument({ foo: 1 }).error, /повреждён/);
});

test('миграция файла создаёт резервную копию до изменения', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-mig-'));
  const storage = new JsonFileStorage({ directory });
  const legacy = JSON.stringify({ templates: [{ id: 'legacy', name: 'Старый', type: 'custom', scope: 'global', content: 'x' }] });
  await fsp.writeFile(storage.filePath, legacy, 'utf8');

  const loaded = await storage.load();
  assert.equal(loaded.migratedFrom, 0);
  const doc = JSON.parse(await fsp.readFile(storage.filePath, 'utf8'));
  assert.equal(doc.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(doc.templates[0].id, 'legacy');

  const backups = await storage.listBackups();
  assert.ok(backups.length >= 1, 'перед миграцией должна появиться резервная копия');
  const backupText = JSON.parse(await fsp.readFile(backups[0].file, 'utf8'));
  assert.equal(backupText.schemaVersion, undefined);
  assert.ok(backups[0].file.startsWith(path.join(directory, backupPrefixOf())));
});

test('неудавшаяся миграция восстанавливает исходный файл из копии', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dtp-migfail-'));
  const filePath = path.join(directory, 'templates.json');
  const legacy = JSON.stringify({ templates: [{ id: 'keep-me' }] });
  await fsp.writeFile(filePath, legacy, 'utf8');

  const original = MIGRATIONS.get(0);
  MIGRATIONS.set(0, () => { throw new Error('сломанный шаг'); });
  try {
    const result = await runMigrationsWithBackup(directory, filePath, JSON.parse(legacy), async () => {});
    assert.equal(result.ok, false);
    assert.match(result.error, /сломанный шаг/);
    assert.match(result.error, /восстановлен/);
    const after = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    assert.deepEqual(after, { templates: [{ id: 'keep-me' }] }, 'исходные данные должны остаться нетронутыми');
  } finally {
    if (original) MIGRATIONS.set(0, original);
    else MIGRATIONS.delete(0);
  }
});

test(' актуальная схема миграции не требует', async () => {
  const document = emptyDocument();
  const result = migrateDocument({ ...document, schemaVersion: CURRENT_SCHEMA_VERSION });
  assert.equal(result.ok, true);
  assert.equal(result.migratedFrom, null);
});

test('миграция v1 → v2 добавляет реестр пользовательских типов', () => {
  const raw = { schemaVersion: 1, templates: [] };
  const result = migrateDocument(raw);
  assert.equal(result.ok, true);
  assert.equal(result.migratedFrom, 1);
  assert.equal(result.document.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(result.document.customTypes, []);
});

test('миграция v1 → v2 сохраняет уже существующие customTypes', () => {
  const raw = { schemaVersion: 1, templates: [], customTypes: [{ id: 'ctype:postmortem', label: 'Постмортем' }] };
  const result = migrateDocument(raw);
  assert.equal(result.ok, true);
  assert.deepEqual(result.document.customTypes, [{ id: 'ctype:postmortem', label: 'Постмортем' }]);
});
