/**
 * Integration-тест: plugin apply(ctx) на mock-контексте Harness.
 *
 * Проверяет регистрацию всех команд и инструментов, их контракт (input hint,
 * output schema/render для инструментов), обработку ошибок и ключевые
 * переходы команд на реальных файлах во временном workspace.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { apply, name as pluginName, COMMAND_NAMES, TOOL_NAMES, parseCommandInput, dispatchCommand } from '../../dist/index.js';
import { makeHarness, makeWorkspace, runCommand } from '../helpers.js';

test('apply(ctx) регистрирует 9 команд и 8 инструментов с корректным контрактом', async () => {
  const workspace = await makeWorkspace();
  const { ctx, registered } = makeHarness({ workspace });
  const dispose = apply(ctx);
  assert.equal(typeof dispose, 'function');
  assert.equal(pluginName, 'sdd-workflow-plugin');
  assert.deepEqual(
    registered.commands.map((definition) => definition.name).sort(),
    [...COMMAND_NAMES].sort(),
  );
  assert.deepEqual(
    registered.tools.map((definition) => definition.name).sort(),
    [...TOOL_NAMES].sort(),
  );
  // Все инструменты объявляют output {schema, render} и параметры-схему.
  for (const tool of registered.tools) {
    assert.ok(tool.parameters && tool.parameters.type === 'object', `инструмент ${tool.name} должен объявлять parameters`);
    assert.ok(tool.output && typeof tool.output.render === 'function' && tool.output.schema, `инструмент ${tool.name} должен объявлять output`);
    const rendered = tool.output.render({}, { ok: true });
    assert.ok(Array.isArray(rendered) && rendered.every((part) => typeof part.text === 'string'), `render инструмента ${tool.name} возвращает текст`);
  }
  // Все команды имеют описание и input hint.
  for (const command of registered.commands) {
    assert.ok(command.description, `команда ${command.name} должна иметь описание`);
    assert.ok(command.input && typeof command.input.hint === 'string');
    assert.equal(command.recordInput, false);
  }
});

test('зонтичная команда sdd требует подкоманду и диспетчирует операции', async () => {
  const workspace = await makeWorkspace();
  const { ctx, registered } = makeHarness({ workspace });
  apply(ctx);
  const missing = await runCommand(registered, 'sdd', {});
  assert.equal(missing.kind, 'error');
  assert.match(missing.payload.error, /подкоманду/);
  // /sdd init создаёт workspace так же, как /sdd-init.
  const viaUmbrella = await runCommand(registered, 'sdd', { command: 'init' });
  assert.equal(viaUmbrella.kind, 'success');
  assert.equal(viaUmbrella.payload.created, true);
  const viaAlias = await runCommand(registered, 'sdd-init', {});
  assert.equal(viaAlias.kind, 'success');
  assert.equal(viaAlias.payload.created, false, 'повторный вызов идемпотентен');
});

test('parseCommandInput понимает JSON, `<op> [json]` и простой текст', () => {
  assert.deepEqual(parseCommandInput(''), {});
  assert.deepEqual(parseCommandInput('{"op":"validate"}'), { op: 'validate' });
  assert.deepEqual(parseCommandInput('generate {"confirm_overwrite":true}'), { op: 'generate', confirm_overwrite: true });
  assert.deepEqual(parseCommandInput('list'), { op: 'list' });
  assert.deepEqual(parseCommandInput('run some free text'), { op: 'run', value: 'some free text' });
  assert.throws(() => parseCommandInput('[1,2]'), /JSON-объектом/);
});

test('команды возвращают ошибки с кодом и подсказкой, а не падают', async () => {
  const workspace = await makeWorkspace();
  const { ctx, registered } = makeHarness({ workspace });
  apply(ctx);
  const notInitialized = await runCommand(registered, 'sdd-status', {});
  assert.equal(notInitialized.kind, 'success');
  assert.equal(notInitialized.payload.stage, 'not_initialized');

  const specWithoutInit = await runCommand(registered, 'sdd-spec', { op: 'validate' });
  assert.equal(specWithoutInit.kind, 'error');
  assert.equal(specWithoutInit.payload.code, 'SDD_NOT_INITIALIZED');
  assert.match(specWithoutInit.payload.error, /sdd-init/);
});

test('sdd:init применяет ответы интервью и создаёт полный набор артефактов', async () => {
  const workspace = await makeWorkspace();
  const { ctx, registered } = makeHarness({ workspace });
  apply(ctx);
  const result = await runCommand(registered, 'sdd-init', {
    answers: { id: 'FEAT-042', title: 'Экспорт отчётов', owner: 'anna', goal: 'Экспортировать отчёты', scope: 'Модуль экспорта' },
  });
  assert.equal(result.kind, 'success');
  assert.deepEqual(result.payload.answers_applied, ['id', 'title', 'owner', 'goal', 'scope']);
  assert.deepEqual(result.payload.answers_rejected, []);
  for (const file of ['spec.json', 'spec.md', 'plan.md', 'tasks.json', 'traceability.json', 'validation-report.json', 'changelog.md']) {
    await fsp.access(path.join(workspace, '.sdd', file));
  }
  // plan.json создаётся только реальной генерацией плана (/sdd-plan).
  await assert.rejects(() => fsp.access(path.join(workspace, '.sdd', 'plan.json')), /ENOENT/);
  // TBD-полей не осталось: все критические поля заполнены ответами.
  const status = await runCommand(registered, 'sdd-status', {});
  assert.notEqual(status.payload.stage, 'not_initialized');
});

test('apply работает без fs/workingDirectory, возвращая понятную ошибку', async () => {
  const { ctx, registered } = makeHarness({ workspace: undefined });
  ctx.fs = undefined;
  apply(ctx);
  const outcome = await registered.commands
    .find((definition) => definition.name === 'sdd-status')
    .handler({ agent: { session: { id: 's1' } }, rawInput: '', signal: undefined });
  assert.equal(outcome.kind, 'error');
  const payload = JSON.parse(outcome.text);
  assert.equal(payload.code, 'SDD_NOT_INITIALIZED');
  assert.match(payload.error, /рабочего каталога|не инициализирован/);
});

test('dispatchCommand отклоняет неизвестную команду', async () => {
  await assert.rejects(() => dispatchCommand('sdd-unknown', {}, { storage: undefined, fs: undefined, workspaceRoot: '', logger: { debug() {}, info() {}, warn() {}, error() {} } }), /Неизвестная команда/);
});
