/**
 * Unit-тесты хранилища: атомарная запись (tmp + rename, без остаточных
 * временных файлов), идемпотентная инициализация, JSON-чтение с понятными
 * ошибками, снимки истории, изоляция путей.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NodeFsAdapter, SddStorage, stampOf, SDD_DIR, HISTORY_DIR } from '../../dist/core/storage.js';
import { parseSpec, emptySpec } from '../../dist/core/spec-model.js';
import { SddError, FsOperationError } from '../../dist/core/errors.js';

async function makeRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'sdd-store-'));
}

test('writeText атомарна: файл записан, временных файлов не осталось', async () => {
  const root = await makeRoot();
  const storage = new SddStorage(new NodeFsAdapter(root));
  await storage.writeArtifact('specMd', '# Спецификация\n');
  const content = await fsp.readFile(path.join(root, SDD_DIR, 'spec.md'), 'utf8');
  assert.equal(content, '# Спецификация\n');
  const entries = await fsp.readdir(path.join(root, SDD_DIR));
  assert.ok(entries.every((name) => !name.startsWith('.tmp-')), `остаточные временные файлы: ${entries.join(', ')}`);
});

test('повторная запись заменяет содержимое целиком (rename перекрывает)', async () => {
  const root = await makeRoot();
  const storage = new SddStorage(new NodeFsAdapter(root));
  await storage.writeArtifact('specMd', 'версия 1');
  await storage.writeArtifact('specMd', 'версия 2');
  const content = await fsp.readFile(path.join(root, SDD_DIR, 'spec.md'), 'utf8');
  assert.equal(content, 'версия 2');
});

test('ensureWorkspace идемпотентна: повторный вызов не создаёт дубликаты', async () => {
  const root = await makeRoot();
  const storage = new SddStorage(new NodeFsAdapter(root));
  const first = await storage.ensureWorkspace();
  assert.ok(first.created.includes('.sdd/spec.json'));
  assert.ok(first.created.includes('.sdd/tasks.json'));
  // Каталоги созданы, файлы — нет (их пишет /sdd-init и команды этапов).
  const entries = await fsp.readdir(path.join(root, SDD_DIR));
  assert.deepEqual(entries, [HISTORY_DIR]);
  const second = await storage.ensureWorkspace();
  assert.deepEqual(second.created, first.created);
  assert.deepEqual(second.existing, []);
  assert.equal(await storage.isInitialized(), false);
  // Записываем реальную спецификацию — workspace инициализирован.
  const spec = emptySpec('2026-01-01T00:00:00.000Z');
  await storage.writeJson('specJson', spec);
  assert.equal(await storage.isInitialized(), true);
  const third = await storage.ensureWorkspace();
  assert.ok(third.existing.includes('.sdd/spec.json'));
  assert.ok(!third.created.includes('.sdd/spec.json'));
});

test('readJson возвращает undefined для отсутствующего файла и типизированную ошибку для битого JSON', async () => {
  const root = await makeRoot();
  const storage = new SddStorage(new NodeFsAdapter(root));
  assert.equal(await storage.readJson('specJson', parseSpec), undefined);
  await storage.writeArtifact('specJson', '{ не json');
  await assert.rejects(() => storage.readJson('specJson', parseSpec), (error) => {
    assert.ok(error instanceof SddError);
    assert.equal(error.code, 'SDD_INVALID_JSON');
    assert.equal(error.file, '.sdd/spec.json');
    assert.match(error.message, /некорректный JSON/);
    return true;
  });
});

test('snapshotToHistory сохраняет снимки, listHistory их перечисляет', async () => {
  const root = await makeRoot();
  const storage = new SddStorage(new NodeFsAdapter(root));
  await storage.ensureWorkspace();
  await storage.snapshotToHistory('specJson', '{"v":1}', stampOf(new Date('2026-01-01T00:00:00Z')));
  await storage.snapshotToHistory('specJson', '{"v":2}', stampOf(new Date('2026-01-02T00:00:00Z')));
  const history = await storage.listHistory();
  assert.equal(history.length, 2);
  assert.ok(history.every((name) => name.startsWith('specJson-')));
  const second = await fsp.readFile(path.join(root, SDD_DIR, HISTORY_DIR, history[1]), 'utf8');
  assert.equal(second, '{"v":2}');
});

test('NodeFsAdapter отклоняет пути вне рабочего пространства', async () => {
  const root = await makeRoot();
  const adapter = new NodeFsAdapter(root);
  await assert.rejects(() => adapter.writeText('../outside.txt', 'x'), SddError);
  await assert.rejects(() => adapter.writeText('/etc/passwd', 'x'), SddError);
});

test('NodeFsAdapter.readText различает отсутствие файла и ошибку чтения', async () => {
  const root = await makeRoot();
  const adapter = new NodeFsAdapter(root);
  assert.equal(await adapter.readText('nope.txt'), undefined);
  await fsp.mkdir(path.join(root, 'dir'), { recursive: true });
  await assert.rejects(() => adapter.readText('dir'), FsOperationError);
});

test('stampOf даёт безопасные для имён файлов метки', () => {
  const stamp = stampOf(new Date('2026-01-01T04:05:06.789Z'));
  assert.ok(!stamp.includes(':') && !stamp.includes('.'), stamp);
  assert.match(stamp, /^2026-01-01T/);
});
