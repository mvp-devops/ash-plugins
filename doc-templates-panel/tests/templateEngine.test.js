import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractPlaceholders,
  renderTemplate,
  generateDocument,
  sanitizeFileName,
  buildDocumentFileName,
  nextAvailableFileName,
  matchesQuery,
  compareVersions,
  missingRequired,
  defaultValues,
} from '../src/templates/templateEngine.js';

test('extractPlaceholders находит уникальные ключи', () => {
  const keys = extractPlaceholders('Привет, {{project_name}} и {{project_name}} и {{date}}!');
  assert.deepEqual(keys, ['project_name', 'date']);
});

test('renderTemplate подставляет значения и defaultValue', () => {
  const result = renderTemplate(
    'Проект: {{name}}, дата: {{date}}, статус: {{status}}',
    [
      { key: 'name', required: true },
      { key: 'date' },
      { key: 'status', defaultValue: 'Черновик' },
    ],
    { name: 'Альфа', date: '2026-11-08' },
  );
  assert.equal(result.ok, true);
  assert.equal(result.document, 'Проект: Альфа, дата: 2026-11-08, статус: Черновик');
  assert.deepEqual(result.unfilled, []);
});

test('renderTemplate оставляет плейсхолдер и сообщает о незаполненных необязательных', () => {
  const result = renderTemplate('A {{a}} B {{b}}', [{ key: 'a' }, { key: 'b', defaultValue: 'x' }], { a: '1' });
  assert.equal(result.ok, true);
  assert.equal(result.document, 'A 1 B x');
});

test('renderTemplate отвергает документ без обязательных переменных', () => {
  const result = renderTemplate('Проект {{project_name}}', [{ key: 'project_name', label: 'Название проекта', required: true }], {});
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['Название проекта']);
});

test('missingRequired и defaultValues', () => {
  const variables = [
    { key: 'a', required: true },
    { key: 'b', defaultValue: 'готово' },
    { key: 'c', required: true },
  ];
  assert.deepEqual(missingRequired({ variables }, { a: ' ', c: 'ok' }), ['a']);
  assert.deepEqual(defaultValues(variables), { b: 'готово' });
});

test('generateDocument автоматически заполняет date и project_name', () => {
  const template = {
    content: 'Проект {{project_name}} от {{date}}',
    variables: [{ key: 'project_name' }, { key: 'date' }],
  };
  const result = generateDocument(template, {}, { date: '2026-11-08', projectName: 'Бета' });
  assert.equal(result.ok, true);
  assert.equal(result.document, 'Проект Бета от 2026-11-08');
});

test('sanitizeFileName убирает запрещённые символы', () => {
  assert.equal(sanitizeFileName('Требования: к "функциональности"/v1?'), 'Требования к функциональности v1');
  assert.equal(sanitizeFileName('  ...  '), 'Документ');
  assert.equal(sanitizeFileName('a\\b|c*d'), 'a b c d');
});

test('buildDocumentFileName даёт имя «Название_ГГГГ-ММ-ДД.md»', () => {
  const name = buildDocumentFileName('Требования к функциональности', new Date('2026-11-08T09:00:00Z'));
  assert.equal(name, 'Требования к функциональности_2026-11-08.md');
});

test('buildDocumentFileName учитывает формат plaintext', () => {
  assert.equal(buildDocumentFileName('Заметка', new Date('2026-01-02T00:00:00Z'), 'plaintext'), 'Заметка_2026-01-02.txt');
});

test('nextAvailableFileName добавляет суффиксы _2, _3', () => {
  const contents = [
    'Требования_2026-11-08.md',
    'Требования_2026-11-08_2.md',
    'Требования_2026-11-08_3.md',
  ];
  assert.equal(nextAvailableFileName(contents, 'Требования_2026-11-08.md'), 'Требования_2026-11-08_4.md');
  assert.equal(nextAvailableFileName([], 'Отчёт.md'), 'Отчёт.md');
});

test('matchesQuery ищет по названию, описанию, тегам и содержимому', () => {
  const template = { name: 'Требования', description: 'про требования', tags: ['qa'], content: 'внутри слово Парус' };
  assert.equal(matchesQuery(template, 'парус'), true);
  assert.equal(matchesQuery(template, 'QA'), true);
  assert.equal(matchesQuery(template, 'требования внутр'), true);
  assert.equal(matchesQuery(template, 'нет такого'), false);
  assert.equal(matchesQuery(template, ''), true);
});

test('compareVersions сравнивает semver-числа', () => {
  assert.ok(compareVersions('1.2.0', '1.10.0') < 0);
  assert.ok(compareVersions('2.0.0', '1.9.9') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});
