/**
 * Тест клиентской половины: бандл загружается в среде, эмулирующей
 * браузерный ModuleLoader, а безопасный Markdown-рендер экранирует
 * пользовательский ввод и не исполняет произвольный HTML/JS.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Эмуляция браузерного окружения до импорта client.js.
let factory = null;
const appendedStyles = [];
globalThis.window = {
  __ModuleLoader__: {
    load(definition) { factory = definition.factory; },
  },
};
globalThis.document = {
  querySelector: () => null,
  createElement: (tag) => ({ tag, dataset: {}, textContent: '' }),
  head: { appendChild: (node) => appendedStyles.push(node) },
};
class StubComponent {}
const stubReact = {
  Component: StubComponent,
  createElement: () => { throw new Error('React не требуется для чистых функций'); },
  useState: () => [null, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  useSyncExternalStore: () => null,
};
const stubRequire = (name) => {
  if (name === 'react') return stubReact;
  throw new Error(`unexpected require: ${name}`);
};

await import('../client.js');
assert.ok(factory, 'client.js должен зарегистрировать фабрику через window.__ModuleLoader__.load');

const client = factory(stubRequire);

test('client.js внедряет стили официальным паттерном <style data-plugin data-plugin-css>', () => {
  const tag = appendedStyles.find((node) => node.dataset?.pluginCss === '@local/doc-templates-panel/panel.css');
  assert.ok(tag, 'стиль панели должен быть добавлен в document.head при materialization');
  assert.equal(tag.dataset.plugin, '@local/doc-templates-panel');
  assert.ok(tag.textContent.includes('.dtp-panel'), 'стиль содержит правила панели');
  assert.ok(tag.textContent.includes('dsh-frame-top-clearance'), 'стиль учитывает отступ под кнопки окна macOS');
});

test('client.js экспортирует inject и apply (контракт клиента DSH)', () => {
  assert.ok(Array.isArray(client.inject));
  assert.deepEqual([...client.inject].sort(), ['locale', 'remote', 'remote.commands', 'sessions', 'slots'].sort());
  assert.equal(typeof client.apply, 'function');
});

test('renderMarkdown экранирует HTML и не исполняет скрипты', () => {
  const malicious = '# Заголовок <script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[javascript](javascript:alert(1))\n\n**жирный** и `код`';
  const html = client.renderMarkdown(malicious);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('onerror=&quot;alert(1)&quot;'), 'onerror остаётся лишь экранированным текстом');
  assert.ok(html.includes('<strong>жирный</strong>'));
  assert.ok(html.includes('<code>код</code>'));
  // javascript:-ссылки не превращаются в <a>.
  assert.ok(!html.includes('<a href="javascript:'));
});

test('renderMarkdown поддерживает заголовки, списки, таблицы и чек-листы', () => {
  const html = client.renderMarkdown(
    [
      '## Раздел',
      '',
      '- пункт 1',
      '- пункт 2',
      '',
      '1. шаг',
      '',
      '- [x] сделано',
      '- [ ] не сделано',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n'),
  );
  assert.ok(html.includes('<h2'));
  assert.ok(html.includes('<ul'));
  assert.ok(html.includes('<ol'));
  assert.ok(html.includes('dtp-check-on'));
  assert.ok(html.includes('<table'));
  assert.ok(html.includes('<th>A</th>'));
});

test('плейсхолдеры {{…}} подсвечиваются в предпросмотре', () => {
  const html = client.renderMarkdown('Проект: {{project_name}}, дата: {{date}}');
  assert.ok(html.includes('dtp-ph'));
  assert.ok(html.includes('{{project_name}}'));
});

test('блоки кода, включая mermaid, рендерятся без исполнения', () => {
  const html = client.renderMarkdown('```mermaid\nflowchart LR\n  A --> B\n```');
  assert.ok(html.includes('dtp-code-mermaid'));
  assert.ok(html.includes('flowchart LR'));
});

test('в TemplateEditor хуки вызываются до условных return (регрессия React #310)', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const source = await fs.readFile(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'client.js'), 'utf8');
  const start = source.indexOf('function TemplateEditor(');
  const end = source.indexOf('function ImportExportDialog(');
  assert.ok(start > 0 && end > start, 'компоненты найдены в исходнике');
  const body = source.slice(start, end);
  const lastHook = Math.max(
    body.lastIndexOf('useRef('),
    body.lastIndexOf('useCallback('),
    body.lastIndexOf('useState('),
    body.lastIndexOf('useEffect('),
  );
  const firstEarlyReturn = body.indexOf('if (state.busy)');
  assert.ok(lastHook >= 0 && firstEarlyReturn > 0);
  assert.ok(lastHook < firstEarlyReturn, 'все вызовы хуков должны стоять до первых условных return, иначе React error #310');
});
