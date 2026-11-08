/**
 * Регрессионный прогон с созданием тестовых документов.
 *
 * Поднимает плагин с эмуляцией ctx (как в e2e-тестах) против тестового
 * workspace `test-artifacts/workspace`, добавляет пользовательский тип,
 * создаёт шаблон, генерирует и сохраняет документы из всех встроенных
 * шаблонов и из шаблона кастомного типа в `<workspace>/docs/`.
 *
 * Запуск: node scripts/make-test-documents.mjs
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { apply } from '../src/plugin.js';

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspace = path.join(pluginRoot, 'test-artifacts', 'workspace');

// Чистый тестовый workspace на каждый прогон.
await fsp.rm(workspace, { recursive: true, force: true });
await fsp.mkdir(workspace, { recursive: true });

const registered = { commands: [], tools: [] };
const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  commands: { register(definition) { registered.commands.push(definition); } },
  tools: { register(definition) { registered.tools.push(definition); } },
  effect(fn) { fn(); },
  workingDirectory: { get: () => workspace },
  sandboxPolicy: { resolve: () => undefined },
  fs: {
    async resolve(relativePath, options = {}) {
      const base = options.cwd ?? workspace;
      const target = path.resolve(base, relativePath);
      if (!target.startsWith(path.resolve(base))) throw Object.assign(new Error('вне workspace'), { code: 'FS_OUTSIDE_WORKSPACE' });
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

apply(ctx, { directory: path.join(os.tmpdir(), `dtp-artifacts-${Date.now().toString(36)}`) });
const agent = { session: { id: 'regression' } };
const command = registered.commands.find((definition) => definition.name === 'doc-templates');

async function run(args, { expectError = false } = {}) {
  const outcome = await command.handler({ agent, rawInput: JSON.stringify(args) });
  const result = JSON.parse(outcome.text ?? '{}');
  const ok = outcome.kind === 'success';
  if (!expectError && !ok) throw new Error(`операция ${args.op}: ${outcome.text}`);
  if (expectError && ok) throw new Error(`операция ${args.op}: ожидалась ошибка, получен успех`);
  return result;
}

const log = [];
const note = (line) => { log.push(line); console.log(line); };

// 1. Список: 8 встроенных шаблонов.
const initial = await run({ op: 'list' });
note(`1. Список: ${initial.rows.length} шаблонов, встроенных ${initial.rows.filter((r) => r.builtin).length}`);

// 2. Пользовательский тип документации.
const type = await run({ op: 'type-add', label: 'Пользовательская история' });
note(`2. Добавлен тип «${type.type.label}» (${type.type.id})`);
const blockedType = await run({ op: 'type-delete', id: 'requirements' }, { expectError: true });
note(`3. Удаление встроенного типа блокируется: «${blockedType.error}»`);

// 3. Шаблон кастомного типа + генерация + сохранение.
const created = await run({
  op: 'create',
  template: {
    name: 'Пользовательская история',
    type: type.type.id,
    scope: 'project',
    description: 'Тестовый шаблон, созданный регрессионным прогоном',
    content: '# {{story}}\n\n**Как** <роль>, **я хочу** <действие>, **чтобы** <ценность>.\n\n## Критерии приёмки\n\n- [ ] <критерий 1>\n- [ ] <критерий 2>\n',
    variables: [
      { key: 'story', label: 'Название истории', required: true },
    ],
    tags: ['регресс', 'user-story'],
  },
});
note(`4. Создан шаблон «${created.template.name}» (${created.template.id}, тип ${created.template.typeLabel}, область ${created.template.scope})`);
const badGenerate = await run({ op: 'generate', id: created.template.id, values: {} }, { expectError: true });
note(`5. Генерация без обязательной переменной отклонена: «${badGenerate.error}»`);
const savedStory = await run({ op: 'save-document', id: created.template.id, values: { story: 'Вход по passkey' } });
note(`6. Сохранён документ: ${savedStory.relativePath}`);
const savedStory2 = await run({ op: 'save-document', id: created.template.id, values: { story: 'Вход по passkey' } });
note(`7. Конфликт имени разрешён суффиксом: ${savedStory2.relativePath}`);

// 4. Документы из всех встроенных шаблонов.
const seeds = initial.rows.filter((row) => row.builtin);
const values = {
  project_name: 'Демо-проект (регрессионный прогон)',
  title: 'Тестовый документ',
  goals: 'Быстро и надёжно',
  feature: 'Тестовая функция',
  cycle: 'Цикл 1',
  release: 'Релиз 1.0',
  case_id: 'TC-001',
  build: '0.0.0-test',
  component: 'система в целом',
  load_profile: 'тестовая нагрузка',
  reviewers: 'Регрессионный прогон',
  author: 'scripts/make-test-documents.mjs',
  date: new Date().toISOString().slice(0, 10),
};
for (const seed of seeds) {
  const saved = await run({ op: 'save-document', id: seed.id, values });
  note(`8. ${seed.name} → ${saved.relativePath} (${saved.bytes} байт)`);
}

// 5. Дублирование, обновление, удаление.
const duplicate = await run({ op: 'duplicate', id: 'seed-test-case', name: 'Тест-кейс — копия для регресса' });
note(`9. Дубликат встроенного шаблона: ${duplicate.template.id}`);
const updated = await run({ op: 'update', id: duplicate.template.id, patch: { description: 'Обновлено регрессионным прогоном' } });
note(`10. Обновление дубликата: ${updated.ok}`);
const removedTemplate = await run({ op: 'delete', id: duplicate.template.id });
note(`11. Удаление дубликата: ${removedTemplate.ok}`);

// 6. Экспорт → импорт во второе хранилище (эмуляция переноса).
const exported = await run({ op: 'export', all: true });
const secondDir = path.join(os.tmpdir(), `dtp-artifacts-second-${Date.now().toString(36)}`);
const secondRegistered = { commands: [], tools: [] };
const secondCtx = JSON.parse(JSON.stringify(''));
apply({
  ...ctx,
  commands: { register(d) { secondRegistered.commands.push(d); } },
  tools: { register() {} },
}, { directory: secondDir });
const secondCommand = secondRegistered.commands.find((definition) => definition.name === 'doc-templates');
const importOutcome = JSON.parse((await secondCommand.handler({ agent, rawInput: JSON.stringify({ op: 'import', document: exported.document, strategy: 'merge', apply: true }) })).text);
if (!importOutcome.ok) throw new Error(`импорт не удался: ${JSON.stringify(importOutcome)}`);
note(`12. Экспорт (${exported.document.templates.length} шаблонов, ${exported.document.customTypes?.length ?? 0} типов) → импорт: ${importOutcome.outcomes.length} операций`);

// 7. Статус хранилища.
const status = await run({ op: 'status' });
note(`13. Статус: schemaVersion ${status.store.schemaVersion}, каталог ${status.store.directoryEnv}/${status.store.fileName}`);

const summary = `# Регрессионный прогон doc-templates-panel\n\n${new Date().toISOString()}\n\n${log.map((line) => `- ${line}`).join('\n')}\n`;
await fsp.writeFile(path.join(pluginRoot, 'test-artifacts', 'regression-report.md'), summary, 'utf8');
console.log(`\nОтчёт: test-artifacts/regression-report.md`);
console.log(`Документы: ${path.relative(process.cwd(), workspace)}/docs/`);
