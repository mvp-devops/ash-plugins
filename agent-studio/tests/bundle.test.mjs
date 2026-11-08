/**
 * Bundle integrity regression: manifest, patch, locales, icon, schema and
 * the client module must be present, parseable and mutually consistent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('package manifest declares bundle, client and display resources', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@local/agent-studio');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(manifest.dsh.client.immediately === true);
  assert.ok(Array.isArray(manifest.dsh.client.inject) && manifest.dsh.client.inject.length > 0);
  for (const file of ['index.js', 'client.js', 'lib.js', 'builtin-templates.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/ru.json', 'schema/agent-templates.schema.json', 'README.md']) {
    assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
  }
  for (const entry of manifest.files) {
    if (entry.includes('*')) {
      const dir = path.join(root, path.dirname(entry));
      const pattern = new RegExp(`^${path.basename(entry).replace('*', '.+')}$`);
      const actual = fs.readdirSync(dir);
      assert.ok(actual.some((name) => pattern.test(name)), `no file matches files entry: ${entry}`);
    } else {
      assert.ok(fs.existsSync(path.join(root, entry)), `files entry missing on disk: ${entry}`);
    }
  }
});

test('patch inserts the plugin row with the manifest package name', () => {
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:/);
  assert.match(patch, /id: agent-studio/);
  assert.match(patch, /name: '@local\/agent-studio'/);
});

test('locale files carry meta title/description and parse', () => {
  for (const locale of ['en', 'ru']) {
    const dict = JSON.parse(fs.readFileSync(path.join(root, `locale/${locale}.json`), 'utf8'));
    assert.ok(dict.meta.title.length > 0);
    assert.ok(dict.meta.description.length > 0);
    assert.equal(dict.meta.title, 'Agent Studio');
  }
});

test('icon is a valid SVG inside size limits', () => {
  const icon = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');
  assert.match(icon, /<svg[\s>]/);
  assert.match(icon, /viewBox/);
  assert.ok(fs.statSync(path.join(root, 'icon.svg')).size <= 256 * 1024);
});

test('portable schema is valid JSON and pins the format', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema/agent-templates.schema.json'), 'utf8'));
  assert.equal(schema.properties.format.const, 'agent-studio/templates');
  assert.ok(schema.$defs.template);
  assert.ok(schema.properties.templates.items);
});

test('client module is self-contained and declares the required inject', async () => {
  const client = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
  assert.match(client, /window\.__ModuleLoader__\.load/);
  assert.match(client, /id: '@local\/agent-studio'/);
  assert.match(client, /'remote\.commands'/); // remote namespace must be injected explicitly
  assert.match(client, /sidebar\.panellist/);
  assert.match(client, /'main'/);
  assert.match(client, /shell\.overlay/);
  assert.match(client, /contextMenus\.register/);
  assert.match(client, /target: 'session'/);
  assert.doesNotMatch(client, /\brequire\('@deepseek-ai/); // no harness client package imports
  // styles must be injected into the head, not inline-only
  assert.match(client, /document\.head\.appendChild/);
  // panel root must not escape its container
  assert.doesNotMatch(client, /asx-panel\{position:absolute/);
  // no absolute user paths anywhere
  assert.doesNotMatch(client, /\/Users\//);
});

test('host module carries no secrets and no absolute user paths', () => {
  for (const file of ['index.js', 'lib.js', 'builtin-templates.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /sk-[A-Za-z0-9]{8,}/);
    assert.doesNotMatch(source, /\/Users\/[a-z]+\/(?!projects\/deepseek\/agent-studio)/);
  }
});

test('built-in templates satisfy the portable schema shape', async () => {
  const { BUILTIN_TEMPLATES } = await import('../builtin-templates.js');
  assert.equal(BUILTIN_TEMPLATES.length, 7);
  const ids = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
  assert.equal(ids.size, 7);
  for (const template of BUILTIN_TEMPLATES) {
    assert.ok(template.instructions.length > 40, template.id);
    assert.ok(['read-only', 'code-editing', 'full-developer', 'safe-qa', 'research-only', 'custom'].includes(template.toolPolicy.preset), template.id);
    assert.ok(template.skills.length > 0, template.id);
    assert.ok(template.maxDelegationDepth >= 1 && template.maxDelegationDepth <= 4, template.id);
  }
});
