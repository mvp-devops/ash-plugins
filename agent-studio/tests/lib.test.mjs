import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILTIN_TEMPLATES,
  validateTemplate,
  normalizeTemplate,
  resolveTemplate,
  mergeToolPolicies,
  presetStatus,
  resolveToolPolicy,
  toolCategory,
  buildExportDocument,
  validateImportDocument,
  diffImport,
  applyImport,
  parseProjectDocument,
  buildProjectDocument,
  placeholdPaths,
  restorePlaceholders,
  sanitizeForExport,
  projectFilePath,
} from '../lib.js';

const REGISTRY = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'web_search', 'web_fetch', 'apply_patch', 'read_image', 'lsp', 'custom_plugin_tool'];

const baseTemplate = {
  id: 'tester',
  name: 'Tester',
  role: 'QA',
  description: 'd',
  instructions: 'do things',
  skills: ['testing'],
  toolPolicy: { preset: 'safe-qa', rules: {} },
  maxDelegationDepth: 2,
  tags: [],
  scope: 'global',
  enabled: true,
};

// -- validation -----------------------------------------------------------------

test('validateTemplate accepts a valid template and rejects malformed ones', () => {
  assert.deepEqual(validateTemplate(baseTemplate), []);
  const problems = validateTemplate({ ...baseTemplate, id: 'Bad Id!', maxDelegationDepth: 9, toolPolicy: { preset: 'nope', rules: { bash: 'maybe' } } });
  assert.ok(problems.some((p) => p.includes('id')));
  assert.ok(problems.some((p) => p.includes('maxDelegationDepth')));
  assert.ok(problems.some((p) => p.includes('preset')));
  assert.ok(problems.some((p) => p.includes('bash')));
});

test('builtin templates all validate', () => {
  for (const template of BUILTIN_TEMPLATES) assert.deepEqual(validateTemplate(template), [], template.id);
});

// -- merge ----------------------------------------------------------------------

test('resolveTemplate follows builtin -> global -> project -> run order', () => {
  const global = { ...baseTemplate, id: 'builtin-architect', instructions: 'global instructions', maxDelegationDepth: 3, toolPolicy: { preset: 'custom', rules: { bash: 'deny' } } };
  const project = { ...baseTemplate, id: 'builtin-architect', instructions: 'project instructions', tags: ['project'] };
  const resolved = resolveTemplate({ id: 'builtin-architect', globalTemplate: global, projectTemplate: project, runOverrides: { maxDelegationDepth: 1 }, projectRoot: '/w' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.template.instructions, 'project instructions');
  assert.equal(resolved.template.maxDelegationDepth, 1);
  assert.equal(resolved.template.scope, 'project');
  assert.equal(resolved.sources.instructions, 'project');
  assert.equal(resolved.sources.maxDelegationDepth, 'run');
  assert.deepEqual(resolved.trail.map((s) => s.source), ['builtin', 'global', 'project', 'run']);
});

test('resolveTemplate reports not found', () => {
  const resolved = resolveTemplate({ id: 'nope', projectRoot: '/w' });
  assert.equal(resolved.ok, false);
});

test('project override without a project root is ignored', () => {
  const project = { ...baseTemplate, id: 'tester', instructions: 'project instructions' };
  const resolved = resolveTemplate({ id: 'tester', globalTemplate: baseTemplate, projectTemplate: project, projectRoot: null });
  assert.equal(resolved.template.instructions, 'do things');
});

// -- tool policy ------------------------------------------------------------------

test('tool categories map into the required groups', () => {
  assert.equal(toolCategory('bash'), 'shell');
  assert.equal(toolCategory('web_search'), 'web');
  assert.equal(toolCategory('read'), 'filesystem');
  assert.equal(toolCategory('apply_patch'), 'code-editing');
  assert.equal(toolCategory('totally_new_tool'), 'custom');
});

test('read-only preset denies write tools and allows research', () => {
  assert.equal(presetStatus('read-only', 'read'), 'allow');
  assert.equal(presetStatus('read-only', 'bash'), 'deny');
  assert.equal(presetStatus('read-only', 'web_search'), 'allow');
  assert.equal(presetStatus('custom', 'bash'), 'inherit');
});

test('explicit rules override the preset', () => {
  const policy = resolveToolPolicy({ toolPolicy: { preset: 'read-only', rules: { bash: 'allow' } }, registryNames: ['bash', 'read'] });
  assert.equal(policy.statuses.bash, 'allow');
  assert.equal(policy.sources.bash.source, 'template:rule');
  assert.equal(policy.statuses.read, 'allow');
});

test('ask is enforced conservatively as deny', () => {
  const policy = resolveToolPolicy({ toolPolicy: { preset: 'custom', rules: { bash: 'ask' } }, registryNames: ['bash'] });
  assert.equal(policy.statuses.bash, 'ask');
  assert.equal(policy.enforced.bash, 'deny');
  assert.ok(policy.denyList.includes('bash'));
});

test('mergeToolPolicies forbids a later layer from loosening a deny', () => {
  const merged = mergeToolPolicies([
    { toolPolicy: { preset: 'read-only', rules: {} }, origin: 'global' },
    { toolPolicy: { preset: 'full-developer', rules: {} }, origin: 'project' },
  ], REGISTRY);
  assert.equal(merged.enforced.write, 'deny');
  assert.equal(merged.enforced.read, 'allow');
  assert.ok(merged.conflicts.some((c) => c.tool === 'write' && c.resolution === 'kept deny'));
});

test('a later layer may tighten', () => {
  const merged = mergeToolPolicies([
    { toolPolicy: { preset: 'code-editing', rules: {} }, origin: 'global' },
    { toolPolicy: { preset: 'custom', rules: { bash: 'deny' } }, origin: 'project' },
  ], REGISTRY);
  assert.equal(merged.enforced.bash, 'deny');
  assert.equal(merged.enforced.write, 'allow');
});

// -- export / import ----------------------------------------------------------------

test('export placeholders machine paths and strips secrets', () => {
  const template = {
    ...baseTemplate,
    instructions: 'work in /Users/mvp/projects/demo and home /Users/mvp',
    apiKey: 'sk-secret',
    nested: { token: 'abc', note: 'safe' },
  };
  const doc = buildExportDocument([template], { pluginVersion: '1.0.0', projectRoot: '/Users/mvp/projects/demo', userHome: '/Users/mvp' });
  assert.equal(doc.format, 'agent-studio/templates');
  assert.equal(doc.schemaVersion, 1);
  assert.ok(doc.metadata.pluginVersion);
  const exported = doc.templates[0];
  assert.ok(!JSON.stringify(doc).includes('sk-secret'));
  assert.ok(!JSON.stringify(doc).includes('abc'));
  assert.ok(exported.instructions.includes('${PROJECT_ROOT}'));
  assert.ok(exported.instructions.includes('${USER_HOME}'));
});

test('import round-trips placeholders', () => {
  const template = { ...baseTemplate, instructions: 'path ${PROJECT_ROOT}/x home ${USER_HOME}' };
  const doc = buildExportDocument([template], { projectRoot: '/w', userHome: '/h' });
  const restored = restorePlaceholders(doc.templates[0], { projectRoot: '/data/proj', userHome: '/Users/me' });
  assert.equal(restored.instructions, 'path /data/proj/x home /Users/me');
});

test('import validation catches bad documents and newer schema versions warn', () => {
  assert.equal(validateImportDocument({ format: 'wrong', templates: [] }).ok, false);
  const doc = { format: 'agent-studio/templates', schemaVersion: 1, templates: [{ ...baseTemplate }] };
  const result = validateImportDocument(doc);
  assert.equal(result.ok, true);
  assert.equal(result.templates.length, 1);
  const newer = validateImportDocument({ ...doc, schemaVersion: 99 });
  assert.ok(newer.warnings.some((w) => w.includes('newer')));
});

test('import diff and strategies', () => {
  const existing = [normalizeTemplate(baseTemplate, { now: 't0' })];
  const incoming = [
    { ...baseTemplate, instructions: 'changed' },
    { ...baseTemplate, id: 'fresh', name: 'Fresh' },
  ];
  const incomingById = Object.fromEntries(incoming.map((t) => [t.id, t]));
  const diff = diffImport(incoming, Object.fromEntries(existing.map((t) => [t.id, t])));
  assert.deepEqual(diff.map((d) => d.action), ['update', 'create']);

  const skip = applyImport(diff, existing, incomingById, 'skip-existing');
  assert.deepEqual(skip.outcomes.map((o) => o.action), ['skipped', 'created']);
  assert.equal(skip.templates.find((t) => t.id === 'tester').instructions, 'do things');

  const copy = applyImport(diff, existing, incomingById, 'create-copy');
  assert.ok(copy.templates.some((t) => t.id === 'tester-imported'));

  const merge = applyImport(diff, existing, incomingById, 'merge');
  assert.equal(merge.templates.find((t) => t.id === 'tester').instructions, 'changed');

  const noConfirm = applyImport(diff, existing, incomingById, 'overwrite');
  assert.ok(noConfirm.outcomes.some((o) => o.action === 'needs-confirmation'));
  const confirmed = applyImport(diff, existing, incomingById, 'overwrite', { confirmOverwrite: true });
  assert.ok(confirmed.outcomes.some((o) => o.action === 'overwritten'));
  assert.equal(confirmed.templates.find((t) => t.id === 'tester').instructions, 'changed');
});

test('duplicate ids in an import document are rejected', () => {
  const doc = { format: 'agent-studio/templates', schemaVersion: 1, templates: [baseTemplate, { ...baseTemplate }] };
  const result = validateImportDocument(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate')));
});

// -- project file ------------------------------------------------------------------

test('project document round-trip', () => {
  const templates = [normalizeTemplate({ ...baseTemplate, scope: 'project' }, { now: 't1' })];
  const doc = buildProjectDocument(templates);
  const text = JSON.stringify(doc, null, 2);
  const parsed = parseProjectDocument(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.templates[0].id, 'tester');
  assert.equal(parsed.templates[0].scope, 'project');
  assert.equal(parsed.templates[0].toolPolicy.preset, 'safe-qa');
});

test('project file path is relative', () => {
  assert.equal(projectFilePath(), '.agent-studio/agent-templates.json');
});

test('project document rejects junk', () => {
  assert.equal(parseProjectDocument('not json').ok, false);
  assert.equal(parseProjectDocument('{"format":"x","templates":[]}').ok, false);
});

test('placeholdPaths does not touch relative values', () => {
  const out = placeholdPaths({ a: 'src/index.ts', b: '/elsewhere/file' }, { projectRoot: '/w', userHome: '/h' });
  assert.equal(out.a, 'src/index.ts');
  assert.equal(out.b, '/elsewhere/file');
});

test('sanitizeForExport removes machine-only fields', () => {
  const out = sanitizeForExport({ ...baseTemplate, updatedAt: 'now', apiKey: 'x', authorization: 'y' }, {});
  assert.equal(out.updatedAt, undefined);
  assert.equal(out.apiKey, undefined);
  assert.equal(out.authorization, undefined);
  assert.equal(out.name, 'Tester');
});

// -- cwd-sensitive project detection (logic used by readProjectTemplates) -------------

test('project overrides apply only when the host discovered that project root', () => {
  // The host reads project templates from the session's current working
  // directory and passes them with that root; a null root means "no project
  // configuration discovered" and the project layer is skipped entirely.
  const makeProject = (root) => ({ ...baseTemplate, id: 'tester', instructions: `from ${root}` });
  const atRoot = resolveTemplate({ id: 'tester', globalTemplate: baseTemplate, projectTemplate: makeProject('/a'), projectRoot: '/a' });
  assert.equal(atRoot.template.instructions, 'from /a');
  assert.equal(atRoot.sources.instructions, 'project');
  const noRoot = resolveTemplate({ id: 'tester', globalTemplate: baseTemplate, projectTemplate: makeProject('/a'), projectRoot: null });
  assert.equal(noRoot.template.instructions, 'do things');
});
