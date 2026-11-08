/**
 * Regression for skills CRUD (project .dsh/skills) and custom tools CRUD:
 * creates test data, mutates it, verifies discovery, registration, policy
 * integration, export/import round-trip, and cleanup.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DSH_PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-skills-'));

const { apply } = await import('../index.js');
const { buildSkillFile, parseSkillFile, validateCustomTool, validateImportDocument } = await import('../lib.js');

const GLOBAL_TOOLS = ['read', 'write', 'edit', 'glob', 'grep', 'bash'];

function makeHarness(cwd, { withGitAt = cwd } = {}) {
  const files = new Map(); // targetKey -> content
  const deleted = [];
  const state = { registered: [], listeners: new Map(), activations: [], commands: [] };
  const ctx = {
    effect: (factory) => factory(),
    on: (name, listener) => { state.listeners.set(name, listener); return () => {}; },
    logger: { info() {}, error() {}, warn() {} },
    tools: {
      register: (definition) => {
        state.registered = state.registered.filter((d) => d.name !== definition.name);
        state.registered.push(definition);
        return () => { state.registered = state.registered.filter((d) => d.name !== definition.name); };
      },
      guard: () => () => {},
      definitions: () => [
        ...GLOBAL_TOOLS.map((name) => ({ name })),
        ...state.registered.map((d) => ({ name: d.name })),
      ],
      get: (name) => state.registered.find((d) => d.name === name),
    },
    commands: { register: (definition) => state.commands.push(definition) },
    subagents: {
      getProvider: (name) => (name === 'spawn' ? { name } : undefined),
      resolveMaxDepth: (d) => d,
      startActivation: async (spec) => { state.activations.push(spec); return { childId: `child-${state.activations.length}` }; },
    },
    fs: {
      resolve: async (relative, { cwd: base } = {}) => {
        const key = path.isAbsolute(relative) ? relative : path.join(base ?? cwd, relative);
        return { key, displayPath: relative };
      },
      stat: async (target) => {
        // .git exists only at the designated project root marker.
        if (target.key === path.join(withGitAt, '.git')) return { type: 'directory' };
        return files.has(target.key) ? { type: 'file' } : undefined;
      },
      readText: async (target) => {
        if (!files.has(target.key)) {
          const error = new Error(`cannot read "${target.displayPath}": not found`);
          error.code = 'FS_NOT_FOUND';
          throw error;
        }
        return files.get(target.key);
      },
      writeText: async (target, content) => { files.set(target.key, content); return { operation: 'create' }; },
      deleteFile: async (target) => {
        if (!files.has(target.key)) {
          const error = new Error(`cannot delete "${target.displayPath}": not found`);
          error.code = 'FS_NOT_FOUND';
          throw error;
        }
        files.delete(target.key);
        deleted.push(target.key);
        return { operation: 'delete' };
      },
      listDir: async (target) => {
        const prefix = target.key.endsWith('/') ? target.key : `${target.key}/`;
        const names = new Map();
        for (const key of files.keys()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          const [head, second] = rest.split('/');
          if (second === 'SKILL.md') { if (!names.has(head)) names.set(head, { name: head, type: 'directory' }); }
          else names.set(head, { name: head, type: 'file' });
        }
        return [...names.values()];
      },
    },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: cwd }) },
    workingDirectory: { get: () => cwd },
    skills: { list: async () => [{ name: 'user-skill', description: 'User-level skill', source: 'user-dsh' }] },
  };
  apply(ctx, { provider: 'spawn', defaultMaxDepth: 2, globalDeny: [] });
  const command = state.commands[0];
  const agent = { id: 'parent', session: { header: { cwd } } };
  const call = async (args) => {
    const result = await command.handler({ agent, rawInput: JSON.stringify(args), signal: undefined });
    assert.equal(result.kind, 'success', result.text);
    return JSON.parse(result.text);
  };
  const callError = async (args) => {
    const result = await command.handler({ agent, rawInput: JSON.stringify(args), signal: undefined });
    assert.equal(result.kind, 'error');
    return JSON.parse(result.text);
  };
  return { ctx, state, call, callError, files, deleted, cwd, agent, withGitAt };
}

// -- test data ----------------------------------------------------------------

const SKILL_BODY = [
  '## When to use',
  'Reviewing API changes in this repository.',
  '',
  '## Steps',
  '1. Read docs/api-guidelines.md',
  '2. Check breaking changes',
].join('\n');

test('skill CRUD creates, reads, lists and deletes project skills', async () => {
  const h = makeHarness('/work/repo/subdir', { withGitAt: '/work/repo' }); // discovery must stop at /work/repo

  const missing = await h.callError({ op: 'skill-get', name: 'api-review' });
  assert.match(missing.error, /skill not found/);

  const saved = await h.call({ op: 'skill-save', name: 'api-review', description: 'Review API changes', body: SKILL_BODY });
  assert.equal(saved.ok, true);
  assert.equal(saved.file, '.dsh/skills/api-review/SKILL.md');
  assert.ok(saved.root.startsWith('/work/repo') && !saved.root.includes('/subdir'), saved.root);

  const skillPath = path.join('/work/repo', '.dsh/skills/api-review/SKILL.md');
  const text = h.files.get(skillPath);
  assert.ok(text.startsWith('---\nname: "api-review"'));
  const parsed = parseSkillFile(text);
  assert.equal(parsed.description, 'Review API changes');
  assert.ok(parsed.body.includes('docs/api-guidelines.md'));

  const got = await h.call({ op: 'skill-get', name: 'api-review' });
  assert.equal(got.ok, true);
  assert.equal(got.format, 'bundle');
  assert.equal(got.body, SKILL_BODY.trim());

  const listed = await h.call({ op: 'skill-list' });
  assert.equal(listed.ok, true);
  assert.ok(listed.managed.some((skill) => skill.name === 'api-review' && skill.format === 'bundle'));
  assert.ok(listed.rows.some((skill) => skill.name === 'user-skill' && skill.source === 'user-dsh'));
  assert.ok(listed.rows.find((skill) => skill.name === 'api-review'));

  const invalid = await h.callError({ op: 'skill-save', name: 'Bad_Name', description: 'd', body: 'b' });
  assert.match(invalid.error, /skill name must match/);
  const noBody = await h.callError({ op: 'skill-save', name: 'empty-skill', description: 'd', body: '  ' });
  assert.match(noBody.error, /body must be/);

  const removed = await h.call({ op: 'skill-delete', name: 'api-review' });
  assert.equal(removed.ok, true);
  assert.ok(h.deleted.includes(skillPath));
  assert.equal((await h.callError({ op: 'skill-get', name: 'api-review' })).error, 'skill not found: api-review');
  await h.callError({ op: 'skill-delete', name: 'api-review' }); // already gone
});

test('flat skill files are discovered and editable', async () => {
  const h = makeHarness('/work/repo2', { withGitAt: '/work/repo2' });
  h.files.set(path.join('/work/repo2', '.dsh/skills', 'deploy-check.md'), '---\nname: "deploy-check"\ndescription: "Pre-deploy checklist"\n---\n\nCheck dashboards.');
  const listed = await h.call({ op: 'skill-list' });
  const flat = listed.managed.find((skill) => skill.name === 'deploy-check');
  assert.ok(flat, 'flat skill must be discovered');
  assert.equal(flat.format, 'flat');
  const got = await h.call({ op: 'skill-get', name: 'deploy-check' });
  assert.equal(got.format, 'flat');
  assert.equal(got.body, 'Check dashboards.');
  const saved = await h.call({ op: 'skill-save', name: 'deploy-check', description: 'Pre-deploy checklist v2', body: 'Updated steps.' });
  assert.equal(saved.format, 'bundle'); // saving rewrites as a bundle
  assert.ok(h.files.has(path.join('/work/repo2', '.dsh/skills/deploy-check/SKILL.md')));
});

test('custom tools CRUD: save registers a live tool, name conflicts rejected, delete unmounts', async () => {
  const h = makeHarness('/work/repo3', { withGitAt: '/work/repo3' });

  const invalid = await h.callError({ op: 'tool-save', name: 'Bad-Name', description: 'd', content: 'c' });
  assert.match(invalid.error, /name must match/);
  const empty = await h.callError({ op: 'tool-save', name: 'release_notes', description: 'd', content: ' ' });
  assert.match(empty.error, /content must be/);
  const shadow = await h.callError({ op: 'tool-save', name: 'bash', description: 'd', content: 'c' });
  assert.match(shadow.error, /already registered/);

  const saved = await h.call({ op: 'tool-save', name: 'release_notes', description: 'Release process of this repo', content: '1. bump version\n2. tag\n3. publish' });
  assert.equal(saved.ok, true);
  const toolId = saved.tool.id;
  const definition = h.state.registered.find((d) => d.name === 'release_notes');
  assert.ok(definition, 'custom tool must be registered live');
  assert.match(definition.description, /Release process of this repo/);
  const executed = await definition.execute({}, { agent: h.agent, signal: undefined });
  assert.match(executed.content, /bump version/);

  const conflict = await h.callError({ op: 'tool-save', name: 'release_notes', description: 'dup', content: 'c' });
  assert.match(conflict.error, /already exists/);

  const listed = await h.call({ op: 'tool-list' });
  assert.ok(listed.rows.some((row) => row.id === toolId && row.name === 'release_notes' && row.live));
  const catalog = await h.call({ op: 'tools' });
  assert.ok(catalog.custom.some((row) => row.name === 'release_notes'));
  assert.ok(catalog.rows.some((row) => row.name === 'release_notes')); // appears in the registry listing too

  // update keeps one registration
  await h.call({ op: 'tool-save', id: toolId, name: 'release_notes', description: 'Updated', content: 'new content' });
  assert.equal(h.state.registered.filter((d) => d.name === 'release_notes').length, 1);
  assert.equal((await h.state.registered.find((d) => d.name === 'release_notes').execute({}, {})).content, 'new content');

  const removed = await h.call({ op: 'tool-delete', id: toolId });
  assert.equal(removed.ok, true);
  assert.ok(!h.state.registered.some((d) => d.name === 'release_notes'));
  await h.callError({ op: 'tool-delete', id: toolId });
  await h.call({ op: 'undo' }); // undo delete restores and re-mounts
  assert.ok(h.state.registered.some((d) => d.name === 'release_notes'));
  await h.callError({ op: 'tool-save', name: 'read', description: 'shadow', content: 'x' });
  const record = validateCustomTool({ name: 'ok_name', description: 'ok', content: 'ok' });
  assert.deepEqual(record, []);
});

test('custom tools participate in tool policy and exports/imports', async () => {
  const h = makeHarness('/work/repo4', { withGitAt: '/work/repo4' });
  await h.call({ op: 'tool-save', name: 'team_norms', description: 'Team norms', content: 'Always run lint before commit.' });
  await h.call({ op: 'save', template: { id: 'norms-bot', name: 'Norms Bot', role: 'Assistant', instructions: 'Use team_norms.', toolPolicy: { preset: 'custom', rules: { team_norms: 'allow', bash: 'deny' } } } });

  const exported = await h.call({ op: 'export', all: true });
  assert.ok(exported.document.customTools?.some((tool) => tool.name === 'team_norms'));

  // fresh profile simulates another machine: import restores templates and custom tools
  const previousProfile = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-import-'));
  const h2 = makeHarness('/work/repo5');
  const preview = await h2.call({ op: 'import', document: exported.document, strategy: 'merge' });
  assert.ok(preview.preview);
  assert.ok(preview.customDiff.some((entry) => entry.name === 'team_norms' && entry.action === 'create'));
  const applied = await h2.call({ op: 'import', document: exported.document, strategy: 'merge', apply: true });
  assert.ok(applied.customOutcomes.some((entry) => entry.name === 'team_norms' && entry.action === 'created'));
  assert.ok(h2.state.registered.some((d) => d.name === 'team_norms'));

  const run = await h2.call({ op: 'run', template: 'norms-bot', task: 'check norms' });
  assert.equal(run.ok, true);
  const spec = h2.state.activations.at(-1);
  assert.ok(spec.request.prompt[0].text.includes('team_norms') || spec.request.prompt[0].text.includes('Use team_norms.'));
  const denied = await h2.callError({ op: 'run', template: 'norms-bot', task: 'x', overrides: { tools: ['bash'] } });
  assert.match(denied.error, /tool denied/);

  // importing the same document again: same content -> unchanged with skip strategy
  const again = await h2.call({ op: 'import', document: exported.document, strategy: 'skip-existing', apply: true });
  assert.ok(again.customOutcomes.some((entry) => entry.name === 'team_norms' && entry.action === 'skipped'));
  process.env.DSH_PROFILE_DIR = previousProfile;
});

test('import validation still rejects malformed customTools', () => {
  const result = validateImportDocument({
    format: 'agent-studio/templates',
    schemaVersion: 1,
    templates: [],
    customTools: [{ name: 'Bad Name', description: '', content: '' }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('customTools')));
});
