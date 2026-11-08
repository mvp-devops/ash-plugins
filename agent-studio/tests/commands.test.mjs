/**
 * Host-half regression tests with a mocked Cordis context: exercises the full
 * `/agent-studio` command surface, the `agent_studio_run_subagent` tool, the
 * child policy guard, agent/created restriction wiring, project-file sync and
 * undo — without a running Harness.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DSH_PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-test-'));

const { apply } = await import('../index.js');
const { builtinById, BUILTIN_IDS } = await import('../lib.js');
const { BUILTIN_TEMPLATES } = await import('../builtin-templates.js');

// -- mock Cordis context -------------------------------------------------------

const GLOBAL_TOOLS = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'web_search', 'web_fetch', 'agent_studio_run_subagent'];

function makeHarness(cwd) {
  const files = new Map();
  const state = {
    registeredTools: [],
    guards: [],
    commands: [],
    listeners: new Map(),
    activations: [],
    restrictions: [],
  };
  const ctx = {
    effect: (factory) => factory(),
    on: (name, listener) => {
      state.listeners.set(name, listener);
      return () => {};
    },
    logger: { info() {}, error() {}, warn() {} },
    tools: {
      register: (definition) => state.registeredTools.push(definition),
      guard: (guard) => state.guards.push(guard),
      definitions: () => GLOBAL_TOOLS.map((name) => ({ name })),
    },
    commands: { register: (definition) => state.commands.push(definition) },
    subagents: {
      getProvider: (name) => (name === 'spawn' ? { name, capabilities: {} } : undefined),
      resolveMaxDepth: (depth) => depth,
      startActivation: async (spec) => {
        state.activations.push(spec);
        return { childId: `child-${state.activations.length}` };
      },
    },
    fs: {
      resolve: async (relative, { cwd: base } = {}) => ({ key: path.join(base ?? cwd, relative), displayPath: relative }),
      readText: async (target) => {
        if (!files.has(target.key)) {
          const error = new Error(`cannot read "${target.displayPath}": not found`);
          error.code = 'FS_NOT_FOUND';
          throw error;
        }
        return files.get(target.key);
      },
      writeText: async (target, content) => {
        files.set(target.key, content);
        return { operation: files.has(target.key) ? 'update' : 'create' };
      },
    },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: cwd }) },
    workingDirectory: { get: () => cwd },
    skills: { list: async () => [{ name: 'demo-skill', description: 'Demo skill', source: 'project' }] },
  };
  apply(ctx, { provider: 'spawn', defaultMaxDepth: 2, globalDeny: [] });
  const command = state.commands[0];
  const tool = state.registeredTools.find((definition) => definition.name === 'agent_studio_run_subagent');
  const fakeAgent = { id: 'parent-1', session: { header: { cwd } } };
  const call = async (args) => {
    const result = await command.handler({ agent: fakeAgent, rawInput: JSON.stringify(args), signal: undefined });
    assert.equal(result.kind, 'success', result.text);
    return JSON.parse(result.text);
  };
  const callError = async (args) => {
    const result = await command.handler({ agent: fakeAgent, rawInput: JSON.stringify(args), signal: undefined });
    assert.equal(result.kind, 'error');
    return JSON.parse(result.text);
  };
  return { ctx, state, command, tool, fakeAgent, call, callError, files, cwd };
}

const CHILD_AGENT = { id: 'child-1', ctx: {
  effect: (factory) => factory(),
  tools: { restrict: (filter) => { harness.state.restrictions.push(filter); return () => {}; } },
} };

let harness;

test('apply registers exactly one run tool and one command, plus a policy guard', () => {
  harness = makeHarness('/proj-a');
  assert.equal(harness.state.registeredTools.length, 1);
  assert.equal(harness.tool.name, 'agent_studio_run_subagent');
  assert.equal(harness.state.commands.length, 1);
  assert.equal(harness.state.guards.length, 1);
  assert.deepEqual(harness.tool.parameters.required, ['template', 'task']);
});

test('list returns the seven built-in templates with policy summaries', async () => {
  const result = await harness.call({ op: 'list' });
  assert.equal(result.rows.length, BUILTIN_TEMPLATES.length);
  assert.ok(result.rows.every((row) => row.builtin && row.enabled && row.scope === 'global'));
  const reviewer = result.rows.find((row) => row.id === 'builtin-code-reviewer');
  assert.equal(reviewer.policy.preset, 'read-only');
  assert.ok(reviewer.policy.deny > 0);
  const filtered = await harness.call({ op: 'list', query: 'reviewer' });
  assert.ok(filtered.rows.every((row) => `${row.name} ${row.role} ${row.tags.join(' ')}`.toLowerCase().includes('review')));
  assert.ok(filtered.rows.length >= 1);
});

test('save / duplicate / toggle / delete mutate global store; undo reverts each', async () => {
  await harness.call({ op: 'save', template: { id: 't1', name: 'T1', role: 'Dev', instructions: 'work', toolPolicy: { preset: 'custom' } } });
  const created = await harness.call({ op: 'get', id: 't1' });
  assert.equal(created.template.name, 'T1');

  await harness.call({ op: 'duplicate', id: 't1', name: 'T1 copy' });
  const afterCopy = await harness.call({ op: 'list' });
  assert.ok(afterCopy.rows.some((row) => row.id === 't1-copy'));

  const toggled = await harness.call({ op: 'toggle', id: 't1' });
  assert.equal(toggled.template.enabled, false);

  await harness.callError({ op: 'run', template: 't1', task: 'x' }); // disabled

  await harness.call({ op: 'undo' }); // undo toggle
  const untoggled = await harness.call({ op: 'get', id: 't1' });
  assert.equal(untoggled.template.enabled, true);

  await harness.call({ op: 'delete', id: 't1-copy' });
  assert.ok(!(await harness.call({ op: 'list' })).rows.some((row) => row.id === 't1-copy'));
  await harness.call({ op: 'undo' }); // undo delete
  assert.ok((await harness.call({ op: 'list' })).rows.some((row) => row.id === 't1-copy'));

  await harness.callError({ op: 'delete', id: 'builtin-architect' }); // built-ins protected
  await harness.callError({ op: 'save', template: { ...builtinById('builtin-architect') } });
  assert.ok(BUILTIN_IDS.has('builtin-architect'));

  await harness.callError({ op: 'save', template: { id: 'bad id!', name: 'x', role: 'r', instructions: 'i' } });
  const clean = await harness.call({ op: 'list' });
  assert.ok(!clean.rows.some((row) => row.id.startsWith('bad')));
});

test('export sanitizes and imports with strategies and undo', async () => {
  await harness.call({ op: 'save', template: { id: 't2', name: 'T2', role: 'Dev', instructions: 'path /proj-a/x home marker', toolPolicy: { preset: 'read-only' } } });
  const exported = await harness.call({ op: 'export', all: true });
  assert.equal(exported.document.format, 'agent-studio/templates');
  assert.ok(exported.document.metadata.pluginVersion);
  assert.ok(JSON.stringify(exported.document).includes('${PROJECT_ROOT}'));

  const preview = await harness.call({ op: 'import', document: exported.document, strategy: 'merge' });
  assert.ok(preview.preview);
  assert.ok(preview.diff.every((entry) => entry.action === 'same' || entry.action === 'create' || entry.action === 'update'));

  const doc2 = JSON.parse(JSON.stringify(exported.document));
  doc2.templates = doc2.templates.filter((t) => t.id === 't2');
  doc2.templates[0].instructions = 'changed instructions';
  const skip = await harness.call({ op: 'import', document: doc2, strategy: 'skip-existing', apply: true });
  assert.deepEqual(skip.outcomes.map((o) => o.action), ['skipped']);
  assert.equal((await harness.call({ op: 'get', id: 't2' })).template.instructions, 'path /proj-a/x home marker');

  const merged = await harness.call({ op: 'import', document: doc2, strategy: 'merge', apply: true });
  assert.deepEqual(merged.outcomes.map((o) => o.action), ['merged']);
  assert.equal((await harness.call({ op: 'get', id: 't2' })).template.instructions, 'changed instructions');
  await harness.call({ op: 'undo' });
  assert.equal((await harness.call({ op: 'get', id: 't2' })).template.instructions, 'path /proj-a/x home marker');
});

test('effective reports merge trail and per-tool sources', async () => {
  await harness.call({ op: 'project-save', ids: ['builtin-architect'], confirm: true });
  const report = await harness.call({ op: 'effective', id: 'builtin-architect' });
  assert.deepEqual(report.trail.map((step) => step.source), ['builtin', 'project']);
  assert.equal(report.policy.preset, 'read-only');
  assert.equal(report.policy.statuses.write, 'deny');
  assert.ok(Object.keys(report.policy.categories).length > 0);
  assert.ok(report.policy.conflicts.length === 0);
});

test('project-save writes the portable file; project override affects runs', async () => {
  // A missing project file is the normal initial state: no error surfaced.
  const fresh = makeHarness('/proj-fresh');
  const initial = await fresh.call({ op: 'project-status' });
  assert.equal(initial.exists, false);
  assert.equal(initial.error, null);
  const status = await harness.call({ op: 'project-status' });
  assert.equal(status.exists, true);
  assert.equal(status.file, '.agent-studio/agent-templates.json');
  assert.ok(status.ids.includes('builtin-architect'));
  const text = harness.files.get(path.join(harness.cwd, '.agent-studio/agent-templates.json'));
  const doc = JSON.parse(text);
  assert.equal(doc.format, 'agent-studio/templates');
  assert.ok(!JSON.stringify(doc).includes('/proj-a')); // sanitized
  assert.equal(JSON.parse(text).templates[0].scope, 'project');
});

test('run resolves layers, composes the prompt and starts through the seam', async () => {
  const result = await harness.call({ op: 'run', template: 'builtin-architect', task: 'Design a cache', context: 'c1', overrides: { maxDelegationDepth: 1 } });
  assert.equal(result.ok, true);
  assert.equal(result.subagentId, 'child-1');
  const spec = harness.state.activations[0];
  assert.equal(spec.provider, 'spawn');
  assert.equal(spec.delivery, 'parent');
  assert.equal(spec.request.maxDepth, 1);
  assert.ok(spec.request.prompt[0].text.includes('# Role: Architect'));
  assert.ok(spec.request.prompt[0].text.includes('Design a cache'));
  assert.ok(spec.request.prompt[0].text.includes('c1'));
  assert.ok(spec.request.prompt[0].text.includes('demo-skill') === false); // architect has no skills matching catalog names, but skills section renders only when set
  assert.ok(spec.label.startsWith('Agent Studio:'));

  const pending = harness.state.listeners.get('agent/created');
  pending({ agent: CHILD_AGENT });
  assert.ok(harness.state.restrictions.length === 1);
  assert.ok(harness.state.restrictions[0].deny.includes('write'));
  assert.ok(!harness.state.restrictions[0].deny.includes('read'));

  // guard denies a denied tool for the tracked child
  const guard = harness.state.guards[0];
  assert.match(guard({ agent: { id: 'child-1' }, name: 'bash' }), /denied by the Agent Studio tool policy/);
  assert.equal(guard({ agent: { id: 'child-1' }, name: 'read' }), undefined);
  assert.equal(guard({ agent: { id: 'other' }, name: 'bash' }), undefined);
});

test('run errors: unknown template, disabled template, denied override, empty task', async () => {
  await harness.callError({ op: 'run', template: 'missing', task: 'x' });
  await harness.call({ op: 'save', template: { id: 't3', name: 'T3', role: 'R', instructions: 'i', enabled: false } });
  const disabled = await harness.callError({ op: 'run', template: 't3', task: 'x' });
  assert.match(disabled.error, /disabled/);
  const denied = await harness.callError({ op: 'run', template: 'builtin-code-reviewer', task: 'x', overrides: { tools: ['bash'] } });
  assert.match(denied.error, /tool denied/);
  await harness.callError({ op: 'run', template: 'builtin-architect', task: '   ' });
});

test('tool execute wraps the same path (denied override throws, success returns activation)', async () => {
  await assert.rejects(
    () => harness.tool.execute({ template: 'builtin-code-reviewer', task: 'x', overrides: { tools: ['write'] } }, { agent: harness.fakeAgent, signal: undefined }),
    /tool denied/,
  );
  const value = await harness.tool.execute({ template: 'builtin-architect', task: 'plan it' }, { agent: harness.fakeAgent, signal: undefined });
  assert.equal(value.kind, 'activation');
  assert.match(value.subagentId, /^child-/);
  const spec = harness.state.activations.at(-1);
  assert.ok(spec.request.prompt[0].text.includes('plan it'));
});

test('model override reaches the child agent options', async () => {
  await harness.call({ op: 'save', template: { id: 't4', name: 'T4', role: 'R', instructions: 'i', model: { provider: 'prov', model: 'm1' } } });
  await harness.call({ op: 'run', template: 't4', task: 'x' });
  const spec = harness.state.activations.at(-1);
  assert.deepEqual(spec.request.agentOptions, { provider: 'prov', model: 'm1' });
});

test('skills and tools catalogs respond', async () => {
  const skills = await harness.call({ op: 'skills' });
  assert.equal(skills.rows[0].name, 'demo-skill');
  const tools = await harness.call({ op: 'tools' });
  assert.ok(tools.rows.some((row) => row.name === 'bash' && row.category === 'shell'));
  assert.ok(tools.rows.some((row) => row.category === 'custom'));
});

test('project override tightens but never loosens the global policy', async () => {
  // project copy of code-reviewer tries to allow bash; the effective run must keep bash denied
  const doc = {
    format: 'agent-studio/templates',
    schemaVersion: 1,
    templates: [{ id: 'builtin-code-reviewer', name: 'Code Reviewer', role: 'Code Reviewer', instructions: 'project variant', toolPolicy: { preset: 'full-developer' } }],
  };
  const target = path.join(harness.cwd, '.agent-studio/agent-templates.json');
  const existing = JSON.parse(harness.files.get(target));
  existing.templates.push(doc.templates[0]);
  harness.files.set(target, `${JSON.stringify(existing, null, 2)}\n`);
  const run = await harness.callError({ op: 'run', template: 'builtin-code-reviewer', task: 'x', overrides: { tools: ['bash'] } });
  assert.match(run.error, /tool denied/);
  const report = await harness.call({ op: 'effective', id: 'builtin-code-reviewer' });
  assert.equal(report.template.instructions, 'project variant');
  assert.ok(report.policy.conflicts.length > 0);
});
