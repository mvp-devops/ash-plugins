/**
 * Agent Studio — Host half. (reload marker: regression probe 1)
 *
 * Owns: portable template storage (machine-local JSON file), project override
 * discovery (cwd-sensitive, via ctx.fs), the merge engine, the granular tool
 * policy, the `agent_studio_run_subagent` tool, the `/agent-studio` session
 * command (the UI bridge), per-child tool restrictions, and export/import.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BUILTIN_TEMPLATES,
  BUILTIN_IDS,
  SCHEMA_VERSION,
  TOOL_CATEGORIES,
  STATUSES,
  KNOWN_MODEL_TOOLS,
  SKILLS_DIR,
  validateSkillName,
  buildSkillFile,
  parseSkillFile,
  validateCustomTool,
  customToolNameConflict,
  validateTemplate,
  normalizeTemplate,
  builtinById,
  resolveTemplate,
  mergeToolPolicies,
  policySummary,
  toolCategory,
  buildExportDocument,
  validateImportDocument,
  diffImport,
  applyImport,
  parseProjectDocument,
  buildProjectDocument,
  projectFilePath,
  restorePlaceholders,
} from './lib.js';

const PLUGIN_VERSION = '1.0.0';
const GLOBAL_FORMAT = 'agent-studio/global-templates';
const STORE_VERSION = 1;

// ---------------------------------------------------------------------------
// Config: hand-rolled Standard Schema (no runtime dependency on schemastery).
// ---------------------------------------------------------------------------

function makeStandardSchema(fields) {
  return {
    '~standard': {
      vendor: 'agent-studio',
      version: 1,
      validate(value) {
        const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const out = {};
        const issues = [];
        for (const [key, field] of Object.entries(fields)) {
          const raw = input[key];
          if (raw === undefined || raw === null) {
            if (field.required) issues.push({ message: `${key} is required`, path: [key] });
            else if (field.default !== undefined) out[key] = field.default;
            continue;
          }
          if (field.type === 'string') {
            if (typeof raw !== 'string') { issues.push({ message: `${key} must be a string`, path: [key] }); continue; }
            out[key] = raw;
          } else if (field.type === 'number') {
            const num = typeof raw === 'number' ? raw : Number(raw);
            if (!Number.isFinite(num)) { issues.push({ message: `${key} must be a number`, path: [key] }); continue; }
            out[key] = num;
          } else if (field.type === 'boolean') {
            out[key] = Boolean(raw);
          } else if (field.type === 'string[]') {
            if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) { issues.push({ message: `${key} must be an array of strings`, path: [key] }); continue; }
            out[key] = raw;
          }
        }
        return issues.length > 0 ? { issues } : { value: out };
      },
    },
  };
}

export const Config = makeStandardSchema({
  provider: { type: 'string', default: 'spawn' },
  defaultMaxDepth: { type: 'number', default: 2 },
  globalDeny: { type: 'string[]', default: [] },
});

export const inject = ['tools', 'commands', 'subagents', 'fs', 'sandboxPolicy', 'workingDirectory', 'skills'];

// ---------------------------------------------------------------------------
// Machine-local storage (global user templates). Portable via export/import.
// ---------------------------------------------------------------------------

function storeDirectory() {
  const profile = process.env.DSH_PROFILE_DIR;
  if (profile) return path.join(profile, 'agent-studio');
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, 'agent-studio');
}

class CustomToolStore {
  #file = path.join(storeDirectory(), 'custom-tools.json');
  #tools = [];
  #loaded = false;

  async load() {
    if (this.#loaded) return this.#tools;
    this.#loaded = true;
    try {
      const text = await fsp.readFile(this.#file, 'utf8');
      const doc = JSON.parse(text);
      if (Array.isArray(doc?.tools)) this.#tools = doc.tools.filter((t) => validateCustomTool(t).length === 0);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return this.#tools;
  }

  async current() {
    if (!this.#loaded) await this.load();
    return this.#tools;
  }

  async save(tools) {
    this.#tools = tools;
    await fsp.mkdir(path.dirname(this.#file), { recursive: true });
    const doc = { format: 'agent-studio/custom-tools', version: 1, updatedAt: new Date().toISOString(), tools };
    const temp = `${this.#file}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(doc, null, 2), 'utf8');
    await fsp.rename(temp, this.#file);
  }
}

class GlobalStore {
  #file = path.join(storeDirectory(), 'templates.json');
  #templates = [];
  #loaded = false;

  async load() {
    if (this.#loaded) return this.#templates;
    this.#loaded = true;
    try {
      const text = await fsp.readFile(this.#file, 'utf8');
      const doc = JSON.parse(text);
      if (Array.isArray(doc?.templates)) {
        this.#templates = doc.templates.filter((t) => validateTemplate(t).length === 0);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return this.#templates;
  }

  /** Current in-memory templates; performs the first load on demand. */
  async current() {
    if (!this.#loaded) await this.load();
    return this.#templates;
  }

  async save(templates) {
    this.#templates = templates;
    await fsp.mkdir(path.dirname(this.#file), { recursive: true });
    const doc = {
      format: GLOBAL_FORMAT,
      storeVersion: STORE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      templates,
    };
    const temp = `${this.#file}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(doc, null, 2), 'utf8');
    await fsp.rename(temp, this.#file);
  }
}

// ---------------------------------------------------------------------------
// Host plugin
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const store = new GlobalStore();
  const customToolStore = new CustomToolStore();
  const pendingChildren = new Map(); // childSessionId -> { denyList, label }
  const undoJournal = []; // { label, undo: () => Promise<string> }
  const liveCustomTools = new Map(); // id -> { name, dispose }
  const loadPromise = store.load().catch((error) => {
    ctx.logger.error(`agent-studio: failed to load global templates: ${error?.message ?? error}`);
    return [];
  });

  // -- custom tool live registration -----------------------------------------

  function customToolDefinition(record) {
    return {
      name: record.name,
      description: `${record.description} (Agent Studio project tool)`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object', additionalProperties: true, properties: { content: { type: 'string' } }, required: ['content'] },
        render: () => [{ type: 'text', text: record.content }],
      },
      isConcurrencySafe: () => true,
      async execute() {
        return { content: record.content };
      },
    };
  }

  function mountCustomTool(record) {
    if (liveCustomTools.has(record.id)) unmountCustomTool(record.id);
    const dispose = ctx.tools.register(customToolDefinition(record));
    liveCustomTools.set(record.id, { name: record.name, dispose });
  }

  function unmountCustomTool(id) {
    const live = liveCustomTools.get(id);
    if (!live) return;
    try {
      live.dispose();
    } catch (error) {
      ctx.logger.error(`agent-studio: failed to unregister custom tool ${live.name}: ${error?.message ?? error}`);
    }
    liveCustomTools.delete(id);
  }

  async function restoreCustomTools() {
    try {
      for (const record of await customToolStore.load()) {
        const persistedNames = new Set((await customToolStore.current()).map((tool) => tool.name));
        const conflict = customToolNameConflict(record.name, ctx.tools.definitions().map((d) => d.name).filter((name) => !persistedNames.has(name)));
        if (conflict) {
          ctx.logger.error(`agent-studio: custom tool "${record.name}" not restored: ${conflict}`);
          continue;
        }
        mountCustomTool(record);
      }
    } catch (error) {
      ctx.logger.error(`agent-studio: failed to restore custom tools: ${error?.message ?? error}`);
    }
  }
  void loadPromise.then(restoreCustomTools);

  const denySanitize = (list) => [...new Set(list.filter((name) => name !== 'agent_studio_run_subagent'))];

  // -- child tool policy -----------------------------------------------------
  //
  // Two enforcement layers:
  // 1. `ctx.tools.guard()` denies execution by name for tracked child agents,
  //    regardless of where the tool is registered (many Harness tools are
  //    mounted in each agent's own scope and cannot be removed by restrict()).
  // 2. `ctx.tools.restrict()` on the child's context removes globally
  //    registered tools from the child's presentation entirely.

  ctx.effect(() => ctx.tools.guard((exec) => {
    const pending = pendingChildren.get(exec.agent?.id);
    if (!pending) return undefined;
    if (pending.denyList.includes(exec.name)) {
      return `tool "${exec.name}" is denied by the Agent Studio tool policy of template "${pending.label}"`;
    }
    return undefined;
  }), 'agent-studio: child policy guard');

  // -- child tool restrictions ---------------------------------------------

  ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
    const pending = pendingChildren.get(agent.id);
    if (!pending) return;
    // The pending entry stays until agent/disposed so the execution guard
    // covers the child's whole lifetime, not only its first step.
    try {
      const known = new Set(ctx.tools.definitions().map((definition) => definition.name));
      const deny = pending.denyList.filter((name) => known.has(name));
      if (deny.length === 0) return;
      agent.ctx.effect(() => agent.ctx.tools.restrict({ deny }), 'agent-studio: child tool policy');
    } catch (error) {
      ctx.logger.error(`agent-studio: failed to restrict child ${agent.id}: ${error?.message ?? error}`);
    }
  }), 'agent-studio: child policy applier');

  ctx.effect(() => ctx.on('agent/disposed', ({ agent }) => {
    pendingChildren.delete(agent.id);
  }), 'agent-studio: pending cleanup');

  // -- project configuration (cwd-sensitive) --------------------------------

  async function projectRootOf(agent) {
    try {
      return ctx.workingDirectory.get(agent.session);
    } catch {
      return agent.session?.header?.cwd ?? null;
    }
  }

  async function readProjectTemplates(agent) {
    const root = await projectRootOf(agent);
    if (!root || !ctx.fs) return { root: null, templates: [], exists: false, error: null };
    try {
      const target = await ctx.fs.resolve(projectFilePath(), { cwd: root });
      const text = await ctx.fs.readText(target);
      const parsed = parseProjectDocument(text);
      if (!parsed.ok) return { root, templates: [], exists: true, error: parsed.errors.join('; ') };
      const templates = parsed.templates.map((template) => restorePlaceholders(template, { projectRoot: root, userHome: os.homedir() }));
      return { root, templates, exists: true, error: null };
    } catch (error) {
      const code = error?.code ?? '';
      const message = error?.message ?? String(error);
      const missing = code === 'FS_NOT_FOUND' || code === 'FS_NOT_REGULAR_FILE'
        || /ENOENT|\bnot found\b|not a regular file|FS_NOT/i.test(message);
      if (missing) return { root, templates: [], exists: false, error: null };
      return { root, templates: [], exists: false, error: message };
    }
  }

  async function writeProjectTemplates(agent, templates, { confirmOverwrite = true } = {}) {
    const root = await projectRootOf(agent);
    if (!root) return { ok: false, error: 'no working directory for this session' };
    if (!ctx.fs) return { ok: false, error: 'filesystem service unavailable' };
    const relative = projectFilePath();
    const target = await ctx.fs.resolve(relative, { cwd: root });
    let previous = null;
    let existed = false;
    try {
      previous = await ctx.fs.readText(target);
      existed = true;
    } catch {
      existed = false;
    }
    if (existed && !confirmOverwrite) return { ok: false, error: 'existing project configuration requires confirmation', needsConfirmation: true };
    const doc = buildProjectDocument(templates);
    const policy = ctx.sandboxPolicy?.resolve ? ctx.sandboxPolicy.resolve({ session: agent.session }) : undefined;
    try {
      await ctx.fs.writeText(target, `${JSON.stringify(doc, null, 2)}\n`, existed ? undefined : { kind: 'createIfAbsent' }, undefined, policy);
    } catch (error) {
      return { ok: false, error: `project write failed: ${error?.message ?? error}` };
    }
    return { ok: true, path: relative, root, previous, created: !existed };
  }

  // -- template resolution ---------------------------------------------------

  async function globalTemplates() {
    return store.current();
  }

  async function resolveLayers(id, agent, runOverrides = undefined) {
    const globals = await globalTemplates();
    const globalTemplate = globals.find((t) => t.id === id) ?? null;
    const project = await readProjectTemplates(agent);
    const projectTemplate = project.templates.find((t) => t.id === id) ?? null;
    const resolved = resolveTemplate({ id, globalTemplate, projectTemplate, runOverrides, projectRoot: project.root });
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      ...resolved,
      layers: {
        builtin: BUILTIN_IDS.has(id) ? builtinById(id) : null,
        global: globalTemplate,
        project: projectTemplate,
        projectRoot: project.root,
        projectError: project.error,
      },
    };
  }

  // -- registry names & effective policy ------------------------------------

  function registryNames() {
    const registered = ctx.tools.definitions().map((definition) => definition.name);
    return [...new Set([...registered, ...KNOWN_MODEL_TOOLS])];
  }

  /**
   * Build the ordered policy layers for one template. Layer separation is
   * what enforces "a later layer may only tighten": builtin/global is one
   * layer, project and run each get their own, so a project preset cannot
   * replace the global one before the policy math runs.
   */
  function composePolicyLayers({ builtin, global: globalTemplate, project, run }) {
    const layers = [];
    if (builtin?.toolPolicy && globalTemplate?.toolPolicy) {
      const preset = globalTemplate.toolPolicy.preset && globalTemplate.toolPolicy.preset !== 'custom'
        ? globalTemplate.toolPolicy.preset
        : builtin.toolPolicy.preset;
      layers.push({
        toolPolicy: { preset, rules: { ...builtin.toolPolicy.rules, ...globalTemplate.toolPolicy.rules } },
        origin: 'global',
      });
    } else if (builtin?.toolPolicy) {
      layers.push({ toolPolicy: builtin.toolPolicy, origin: 'builtin' });
    } else {
      layers.push({ toolPolicy: globalTemplate?.toolPolicy ?? { preset: 'custom', rules: {} }, origin: 'global' });
    }
    if (project?.toolPolicy) layers.push({ toolPolicy: project.toolPolicy, origin: 'project' });
    if (run?.toolPolicy) layers.push({ toolPolicy: run.toolPolicy, origin: 'run' });
    return layers;
  }

  function effectivePolicyLayered(layerSpecs, names) {
    const denyRules = Object.fromEntries((config.globalDeny ?? []).map((name) => [name, 'deny']));
    return mergeToolPolicies([
      { toolPolicy: { preset: 'custom', rules: denyRules }, origin: 'global-default' },
      ...layerSpecs,
    ], names);
  }

  /** Effective policy for a resolved template (layers come from resolveLayers). */
  function policyForLayers(layers, names, runOverrides = undefined) {
    return effectivePolicyLayered(composePolicyLayers({
      builtin: layers.builtin,
      global: layers.global,
      project: layers.project,
      run: runOverrides ? { toolPolicy: runOverrides.toolPolicy } : undefined,
    }), names);
  }

  // -- run -------------------------------------------------------------------

  function composePrompt(template, task, context) {
    const sections = [];
    sections.push(`# Role: ${template.role} (Agent Studio template "${template.name}")`);
    if (template.description) sections.push(`Purpose: ${template.description}`);
    if (template.instructions) sections.push(`## Operating instructions\n${template.instructions}`);
    if (template.skills?.length) {
      sections.push(`## Recommended skills\nLoad these project/user skills with the \`skill\` tool when relevant: ${template.skills.join(', ')}.`);
    }
    const notes = template.toolPolicy?.notes;
    if (notes && Object.keys(notes).length > 0) {
      sections.push(`## Tool usage notes\n${Object.entries(notes).map(([tool, note]) => `- ${tool}: ${note}`).join('\n')}`);
    }
    sections.push(`## Task\n${task}`);
    if (context) sections.push(`## Context\n${context}`);
    return sections.join('\n\n');
  }

  async function runSubagent(agent, request, signal) {
    if (!agent) return { ok: false, error: 'agent_studio_run_subagent requires a calling agent' };
    if (!ctx.subagents) return { ok: false, error: 'provider unavailable: the subagents service is not composed' };
    const provider = ctx.subagents.getProvider(config.provider);
    if (!provider) return { ok: false, error: `provider unavailable: subagent provider "${config.provider}" is not registered` };

    const id = request.template;
    const resolved = await resolveLayers(id, agent, request.overrides);
    if (!resolved.ok) return { ok: false, error: `template not found: ${id}` };
    const template = resolved.template;
    if (template.enabled === false) return { ok: false, error: `template disabled: ${template.name} (${id})` };
    const task = typeof request.task === 'string' ? request.task.trim() : '';
    if (!task) return { ok: false, error: 'task is required' };

    const names = registryNames();
    const policy = policyForLayers(resolved.layers, names, request.overrides);
    const deniedTool = request.overrides?.tools?.find((tool) => policy.enforced[tool] === 'deny');
    if (deniedTool) return { ok: false, error: `tool denied: "${deniedTool}" is denied by the effective policy of template "${template.name}"` };

    const depth = Math.min(
      Number.isInteger(template.maxDelegationDepth) ? template.maxDelegationDepth : config.defaultMaxDepth,
      config.defaultMaxDepth ?? 2,
    );
    const prompt = composePrompt(template, task, request.context);
    const agentOptions = {};
    if (template.model?.provider) agentOptions.provider = template.model.provider;
    if (template.model?.model) agentOptions.model = template.model.model;
    const hasOptions = Object.keys(agentOptions).length > 0;
    const maxDepth = ctx.subagents.resolveMaxDepth(depth);
    try {
      const activation = await ctx.subagents.startActivation({
        provider: config.provider,
        label: `Agent Studio: ${template.name}`,
        request: {
          prompt: [{ type: 'text', text: prompt }],
          parent: agent,
          ...(hasOptions ? { agentOptions } : {}),
          ...(maxDepth !== undefined ? { maxDepth } : {}),
        },
        signal,
        delivery: 'parent',
      });
      pendingChildren.set(activation.childId, { denyList: denySanitize(policy.denyList), label: template.name });
      return {
        ok: true,
        subagentId: activation.childId,
        provider: config.provider,
        template: { id: template.id, name: template.name, role: template.role },
        policy: policySummary(policy),
        conflicts: policy.conflicts,
      };
    } catch (error) {
      return { ok: false, error: `subagent start failed: ${error?.message ?? error}` };
    }
  }

  // -- tools & skills catalogs ----------------------------------------------

  function toolsCatalog() {
    const names = registryNames();
    const categories = {};
    const rows = names.map((name) => {
      const category = toolCategory(name);
      categories[category] = (categories[category] ?? 0) + 1;
      return { name, category, categoryLabel: TOOL_CATEGORIES[category] ?? category };
    }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return { rows, categories, categoriesLabels: TOOL_CATEGORIES };
  }

  async function skillsCatalog() {
    if (!ctx.skills) return { rows: [], error: 'skills service unavailable' };
    try {
      const summaries = await ctx.skills.list();
      const rows = summaries.map((skill) => ({
        name: skill.name,
        description: skill.description ?? '',
        source: skill.source ?? undefined,
      }));
      return { rows };
    } catch (error) {
      return { rows: [], error: error?.message ?? String(error) };
    }
  }

  // -- mutations + undo -------------------------------------------------------

  function pushUndo(label, undo) {
    undoJournal.push({ label, undo, at: Date.now() });
    if (undoJournal.length > 20) undoJournal.shift();
  }

  async function saveGlobalTemplate(input, { now } = {}) {
    const problems = validateTemplate(input);
    if (problems.length > 0) return { ok: false, error: `invalid configuration: ${problems.join('; ')}` };
    if (BUILTIN_IDS.has(input.id)) return { ok: false, error: 'built-in templates are read-only; duplicate one to customize it' };
    const templates = await globalTemplates();
    const existing = templates.find((t) => t.id === input.id);
    const next = normalizeTemplate(input, { scope: 'global', now: now ?? new Date().toISOString() });
    const previous = existing ? { ...existing } : null;
    const list = existing ? templates.map((t) => (t.id === input.id ? next : t)) : [...templates, next];
    await store.save(list);
    pushUndo(existing ? `update ${input.id}` : `create ${input.id}`, async () => {
      const current = await globalTemplates();
      const restored = previous
        ? current.map((t) => (t.id === input.id ? previous : t))
        : current.filter((t) => t.id !== input.id);
      await store.save(restored);
      return previous ? `restored previous version of ${input.id}` : `removed ${input.id}`;
    });
    return { ok: true, template: next, created: !existing };
  }

  async function deleteGlobalTemplate(id) {
    if (BUILTIN_IDS.has(id)) return { ok: false, error: 'built-in templates cannot be deleted' };
    const templates = await globalTemplates();
    const existing = templates.find((t) => t.id === id);
    if (!existing) return { ok: false, error: `template not found: ${id}` };
    await store.save(templates.filter((t) => t.id !== id));
    pushUndo(`delete ${id}`, async () => {
      const current = await globalTemplates();
      if (!current.some((t) => t.id === id)) {
        await store.save([...current, existing]);
        return `restored ${id}`;
      }
      return `${id} already exists; delete skipped`;
    });
    return { ok: true };
  }

  async function duplicateTemplate(id, name, agent) {
    const resolved = await resolveLayers(id, agent);
    if (!resolved.ok) return { ok: false, error: `template not found: ${id}` };
    const source = resolved.template;
    const baseName = (name ?? `${source.name} copy`).trim() || `${source.name} copy`;
    let newId = `${source.id}-copy`;
    let n = 2;
    const templates = await globalTemplates();
    while (templates.some((t) => t.id === newId) || BUILTIN_IDS.has(newId)) newId = `${source.id}-copy-${n++}`;
    return saveGlobalTemplate({ ...source, id: newId, name: baseName, builtin: undefined });
  }

  async function toggleTemplate(id, enabled) {
    if (BUILTIN_IDS.has(id)) return { ok: false, error: 'built-in templates are always enabled; duplicate one to customize' };
    const templates = await globalTemplates();
    const existing = templates.find((t) => t.id === id);
    if (!existing) return { ok: false, error: `template not found: ${id}` };
    const nextValue = typeof enabled === 'boolean' ? enabled : !existing.enabled;
    const next = { ...existing, enabled: nextValue, updatedAt: new Date().toISOString() };
    await store.save(templates.map((t) => (t.id === id ? next : t)));
    pushUndo(`toggle ${id}`, async () => {
      const current = await globalTemplates();
      await store.save(current.map((t) => (t.id === id ? existing : t)));
      return `restored enabled=${existing.enabled} for ${id}`;
    });
    return { ok: true, template: next };
  }

  // -- export / import ---------------------------------------------------------

  async function exportTemplates(agent, { ids, all } = {}) {
    const globals = await globalTemplates();
    const selected = [];
    if (all) selected.push(...globals, ...BUILTIN_TEMPLATES);
    else if (Array.isArray(ids)) {
      for (const id of ids) {
        const global = globals.find((t) => t.id === id);
        if (global) selected.push(global);
        else if (BUILTIN_IDS.has(id)) selected.push(builtinById(id));
      }
    } else selected.push(...globals);
    const project = await readProjectTemplates(agent);
    const contexts = {
      projectRoot: project.root ?? undefined,
      userHome: os.homedir(),
    };
    const customTools = await customToolStore.current();
    const doc = buildExportDocument(selected, { pluginVersion: PLUGIN_VERSION, projectRoot: contexts.projectRoot, userHome: contexts.userHome, customTools });
    return { ok: true, document: doc, placeholders: { projectRoot: contexts.projectRoot ? '${PROJECT_ROOT}' : null, userHome: '${USER_HOME}' } };
  }

  async function importTemplates(agent, { document, strategy = 'merge', confirmOverwrite = false, apply = false } = {}) {
    let doc = document;
    if (typeof doc === 'string') {
      try {
        doc = JSON.parse(doc);
      } catch (error) {
        return { ok: false, error: `invalid JSON: ${error.message}` };
      }
    }
    const validation = validateImportDocument(doc);
    if (!validation.ok) return { ok: false, error: `validation failed: ${validation.errors.join('; ')}`, warnings: validation.warnings };
    const globals = await globalTemplates();
    const existingById = Object.fromEntries(globals.map((t) => [t.id, t]));
    const incomingById = Object.fromEntries(validation.templates.map((t) => [t.id, t]));
    const diff = diffImport(validation.templates, existingById);
    const existingCustom = await customToolStore.current();
    const customDiff = validation.customTools.map((tool) => {
      const existing = existingCustom.find((t) => t.name === tool.name);
      if (!existing) return { name: tool.name, action: 'create' };
      return existing.content === tool.content && existing.description === tool.description
        ? { name: tool.name, action: 'same' }
        : { name: tool.name, action: 'update' };
    });
    if (!apply) return { ok: true, preview: true, diff, customDiff, warnings: validation.warnings, needsConfirmation: diff.some((d) => d.action === 'update') };
    const applied = applyImport(diff, globals, incomingById, strategy, { confirmOverwrite, now: new Date().toISOString() });
    const needsConfirmation = applied.outcomes.some((o) => o.action === 'needs-confirmation');
    if (needsConfirmation && !confirmOverwrite) {
      return { ok: false, needsConfirmation: true, outcomes: applied.outcomes, error: 'overwriting existing templates requires explicit confirmation' };
    }
    const previous = globals.map((t) => ({ ...t }));
    const previousCustom = existingCustom.map((t) => ({ ...t }));
    const customOutcomes = [];
    const nextCustom = [...existingCustom];
    for (const tool of validation.customTools) {
      const existing = nextCustom.find((t) => t.name === tool.name);
      if (existing) {
        if (strategy === 'skip-existing') { customOutcomes.push({ name: tool.name, action: 'skipped' }); continue; }
        if (!confirmOverwrite) { customOutcomes.push({ name: tool.name, action: 'needs-confirmation' }); continue; }
      }
      const record = { id: existing?.id ?? tool.id ?? `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: tool.name, description: tool.description, content: tool.content, updatedAt: new Date().toISOString() };
      const index = nextCustom.findIndex((t) => t.name === tool.name);
      if (index === -1) nextCustom.push(record);
      else nextCustom[index] = record;
      mountCustomTool(record);
      customOutcomes.push({ name: tool.name, action: existing ? 'overwritten' : 'created' });
    }
    if (customOutcomes.some((o) => o.action === 'needs-confirmation')) {
      return { ok: false, needsConfirmation: true, outcomes: applied.outcomes, customOutcomes, error: 'overwriting existing custom tools requires explicit confirmation' };
    }
    await customToolStore.save(nextCustom);
    await store.save(applied.templates);
    pushUndo('import configuration', async () => {
      await store.save(previous);
      await customToolStore.save(previousCustom);
      for (const record of previousCustom) mountCustomTool(record);
      for (const record of nextCustom) {
        if (!previousCustom.some((t) => t.id === record.id)) unmountCustomTool(record.id);
      }
      return 'restored configuration from before the import';
    });
    return { ok: true, applied: true, outcomes: applied.outcomes, customOutcomes, warnings: validation.warnings };
  }

  // -- listing ---------------------------------------------------------------

  async function listTemplates(agent, filter = {}) {
    const globals = await globalTemplates();
    const project = await readProjectTemplates(agent);
    const names = registryNames();
    const rows = [];
    const consider = (template, origin) => {
      if (filter.role && template.role !== filter.role) return;
      if (filter.scope && (origin === 'project' ? 'project' : template.scope) !== filter.scope) return;
      if (filter.tag && !template.tags.includes(filter.tag)) return;
      if (filter.status === 'enabled' && template.enabled === false) return;
      if (filter.status === 'disabled' && template.enabled !== false) return;
      if (filter.query) {
        const q = String(filter.query).toLowerCase();
        const haystack = `${template.name} ${template.role} ${template.description} ${template.tags.join(' ')}`.toLowerCase();
        if (!haystack.includes(q)) return;
      }
      const resolved = resolveTemplate({
        id: template.id,
        globalTemplate: origin === 'global' ? template : globals.find((t) => t.id === template.id) ?? null,
        projectTemplate: project.templates.find((t) => t.id === template.id) ?? null,
        projectRoot: project.root,
      });
      const effective = resolved.ok ? resolved.template : template;
      const policy = policyForLayers({
        builtin: BUILTIN_IDS.has(template.id) ? builtinById(template.id) : null,
        global: origin === 'global' ? template : globals.find((t) => t.id === template.id) ?? null,
        project: project.templates.find((t) => t.id === template.id) ?? null,
      }, names);
      rows.push({
        id: template.id,
        name: template.name,
        role: template.role,
        description: template.description,
        enabled: template.enabled !== false,
        scope: origin === 'project' ? 'project' : template.scope,
        origin,
        builtin: Boolean(template.builtin),
        skills: template.skills.length,
        tools: Object.keys(template.toolPolicy?.rules ?? {}).length,
        policy: policySummary(policy),
        tags: template.tags,
        updatedAt: template.updatedAt,
        hasProjectOverride: project.templates.some((t) => t.id === template.id),
      });
    };
    for (const template of BUILTIN_TEMPLATES) consider(template, 'builtin');
    for (const template of globals) {
      if (BUILTIN_IDS.has(template.id)) continue;
      consider(template, 'global');
    }
    for (const template of project.templates) {
      if (BUILTIN_IDS.has(template.id) || globals.some((t) => t.id === template.id)) continue;
      consider(template, 'project');
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return {
      ok: true,
      rows,
      project: { root: project.root, file: projectFilePath(), exists: project.exists, error: project.error },
    };
  }

  async function effectiveReport(id, agent) {
    const resolved = await resolveLayers(id, agent);
    if (!resolved.ok) return resolved;
    const names = registryNames();
    const policy = policyForLayers(resolved.layers, names);
    return {
      ok: true,
      template: resolved.template,
      trail: resolved.trail,
      sources: resolved.sources,
      policy: {
        preset: policy.preset,
        statuses: policy.statuses,
        sources: policy.sources,
        conflicts: policy.conflicts,
        denyList: policy.denyList,
        allowList: policy.allowList,
        categories: Object.fromEntries(names.map((name) => [name, toolCategory(name)])),
        summary: policySummary(policy),
      },
      layers: resolved.layers,
    };
  }

  // -- skills CRUD (project .dsh/skills) ---------------------------------------

  /** Nearest project root (directory containing .git), like the skill provider's discovery. */
  async function projectRootForSkills(agent) {
    const start = await projectRootOf(agent);
    if (!start || !ctx.fs?.stat) return null;
    let current = start;
    for (let depth = 0; depth < 32; depth += 1) {
      try {
        const target = await ctx.fs.resolve('.git', { cwd: current });
        const info = await ctx.fs.stat(target);
        if (info) return current;
      } catch { /* keep walking */ }
      const parent = path.dirname(current);
      if (!parent || parent === current) return start;
      current = parent;
    }
    return start;
  }

  async function skillsRoot(agent) {
    const root = await projectRootForSkills(agent);
    if (!root) return { ok: false, error: 'no working directory for this session' };
    if (!ctx.fs) return { ok: false, error: 'filesystem service unavailable' };
    return { ok: true, root, dir: SKILLS_DIR };
  }

  function skillWritePolicy(agent) {
    return ctx.sandboxPolicy?.resolve ? ctx.sandboxPolicy.resolve({ session: agent.session }) : undefined;
  }

  async function skillList(agent) {
    const rootInfo = await skillsRoot(agent);
    const catalog = await skillsCatalog();
    const managed = [];
    if (rootInfo.ok) {
      try {
        const dir = await ctx.fs.resolve(SKILLS_DIR, { cwd: rootInfo.root });
        const entries = await ctx.fs.listDir(dir);
        for (const entry of entries) {
          if (entry.type === 'directory') {
            try {
              const file = await ctx.fs.resolve(`${SKILLS_DIR}/${entry.name}/SKILL.md`, { cwd: rootInfo.root });
              const text = await ctx.fs.readText(file);
              const parsed = parseSkillFile(text);
              managed.push({ name: entry.name, format: 'bundle', description: parsed.description ?? '', managed: true });
            } catch { /* bundle without SKILL.md is ignored */ }
          } else if (entry.name.endsWith('.md')) {
            try {
              const file = await ctx.fs.resolve(`${SKILLS_DIR}/${entry.name}`, { cwd: rootInfo.root });
              const text = await ctx.fs.readText(file);
              const parsed = parseSkillFile(text);
              managed.push({ name: entry.name.replace(/\.md$/u, ''), format: 'flat', description: parsed.description ?? '', managed: true });
            } catch { /* unreadable flat file is ignored */ }
          }
        }
      } catch { /* no skills dir yet: managed list stays empty */ }
    }
    return {
      ok: true,
      rows: [
        ...managed.map((skill) => ({ name: skill.name, description: skill.description, source: 'project-dsh' })),
        ...catalog.rows.filter((skill) => !managed.some((managedSkill) => managedSkill.name === skill.name)),
      ],
      managed,
      managedDir: rootInfo.ok ? `${SKILLS_DIR} (${rootInfo.root})` : null,
      error: rootInfo.ok ? catalog.error : rootInfo.error,
    };
  }

  async function skillGet(agent, name) {
    const rootInfo = await skillsRoot(agent);
    if (!rootInfo.ok) return rootInfo;
    for (const [format, relative] of [['bundle', `${SKILLS_DIR}/${name}/SKILL.md`], ['flat', `${SKILLS_DIR}/${name}.md`]]) {
      try {
        const target = await ctx.fs.resolve(relative, { cwd: rootInfo.root });
        const text = await ctx.fs.readText(target);
        const parsed = parseSkillFile(text);
        return { ok: true, name, format, description: parsed.description ?? '', body: parsed.body ?? '', root: rootInfo.root, file: relative };
      } catch (error) {
        const code = error?.code ?? '';
        if (code !== 'FS_NOT_FOUND' && !/not found|ENOENT/i.test(error?.message ?? '')) {
          return { ok: false, error: `skill read failed: ${error?.message ?? error}` };
        }
      }
    }
    return { ok: false, error: `skill not found: ${name}` };
  }

  async function skillSave(agent, { name, description, body }) {
    const nameProblems = validateSkillName(name);
    if (nameProblems.length > 0) return { ok: false, error: nameProblems.join('; ') };
    if (typeof description !== 'string' || description.trim().length === 0) return { ok: false, error: 'description must be a non-empty string' };
    if (typeof body !== 'string' || body.trim().length === 0) return { ok: false, error: 'body must be a non-empty string' };
    const rootInfo = await skillsRoot(agent);
    if (!rootInfo.ok) return rootInfo;
    const relative = `${SKILLS_DIR}/${name}/SKILL.md`;
    const target = await ctx.fs.resolve(relative, { cwd: rootInfo.root });
    try {
      await ctx.fs.writeText(target, buildSkillFile(name, description.trim(), body), undefined, undefined, skillWritePolicy(agent));
    } catch (error) {
      return { ok: false, error: `skill write failed: ${error?.message ?? error}` };
    }
    return { ok: true, name, format: 'bundle', file: relative, root: rootInfo.root };
  }

  async function skillDelete(agent, name) {
    const nameProblems = validateSkillName(name);
    if (nameProblems.length > 0) return { ok: false, error: nameProblems.join('; ') };
    const rootInfo = await skillsRoot(agent);
    if (!rootInfo.ok) return rootInfo;
    const policy = skillWritePolicy(agent);
    for (const relative of [`${SKILLS_DIR}/${name}/SKILL.md`, `${SKILLS_DIR}/${name}.md`]) {
      try {
        const target = await ctx.fs.resolve(relative, { cwd: rootInfo.root });
        await ctx.fs.deleteFile(target, undefined, undefined, policy);
        return { ok: true, name, deleted: relative };
      } catch (error) {
        const code = error?.code ?? '';
        if (code !== 'FS_NOT_FOUND' && !/not found|ENOENT/i.test(error?.message ?? '')) {
          return { ok: false, error: `skill delete failed: ${error?.message ?? error}` };
        }
      }
    }
    return { ok: false, error: `skill not found: ${name}` };
  }

  // -- custom tools CRUD --------------------------------------------------------

  async function customToolSave(agent, { id, name, description, content }) {
    const problems = validateCustomTool({ id, name, description, content });
    if (problems.length > 0) return { ok: false, error: problems.join('; ') };
    const tools = await customToolStore.current();
    const existing = id ? tools.find((t) => t.id === id) : undefined;
    const byName = tools.find((t) => t.name === name && t.id !== id);
    if (byName) return { ok: false, error: `custom tool with name "${name}" already exists` };
    // Custom-vs-custom collisions are handled above; the registry check only
    // guards against shadowing non-custom (plugin) tools.
    const customNames = new Set(tools.map((t) => t.name));
    const registeredNames = ctx.tools.definitions().map((d) => d.name).filter((n) => !customNames.has(n));
    const conflict = customToolNameConflict(name, registeredNames);
    if (conflict) return { ok: false, error: conflict };
    const record = {
      id: existing?.id ?? `ct-${Date.now().toString(36)}`,
      name,
      description: description.trim(),
      content,
      updatedAt: new Date().toISOString(),
    };
    const next = existing ? tools.map((t) => (t.id === record.id ? record : t)) : [...tools, record];
    await customToolStore.save(next);
    mountCustomTool(record);
    pushUndo(existing ? `update tool ${name}` : `create tool ${name}`, async () => {
      const current = await customToolStore.current();
      const restored = existing ? current.map((t) => (t.id === record.id ? existing : t)) : current.filter((t) => t.id !== record.id);
      await customToolStore.save(restored);
      if (existing) mountCustomTool(existing);
      else unmountCustomTool(record.id);
      return existing ? `restored previous version of ${name}` : `removed ${name}`;
    });
    return { ok: true, tool: { id: record.id, name: record.name, description: record.description } };
  }

  async function customToolDelete(agent, id) {
    const tools = await customToolStore.current();
    const existing = tools.find((t) => t.id === id);
    if (!existing) return { ok: false, error: `custom tool not found: ${id}` };
    await customToolStore.save(tools.filter((t) => t.id !== id));
    unmountCustomTool(id);
    pushUndo(`delete tool ${existing.name}`, async () => {
      const current = await customToolStore.current();
      if (!current.some((t) => t.id === id)) {
        await customToolStore.save([...current, existing]);
        mountCustomTool(existing);
        return `restored ${existing.name}`;
      }
      return `${existing.name} already exists; delete skipped`;
    });
    return { ok: true, name: existing.name };
  }

  async function customToolList() {
    const tools = await customToolStore.current();
    return { ok: true, rows: tools.map((t) => ({ id: t.id, name: t.name, description: t.description, content: t.content, live: liveCustomTools.has(t.id) })) };
  }

  // -- session command (UI bridge + command palette) --------------------------

  const COMMAND_OPS = new Set(['help', 'list', 'get', 'save', 'delete', 'duplicate', 'toggle', 'run', 'effective', 'skills', 'tools', 'export', 'import', 'project-save', 'project-status', 'undo', 'skill-list', 'skill-get', 'skill-save', 'skill-delete', 'tool-save', 'tool-delete', 'tool-list']);

  function parseCommand(rawInput) {
    const input = (rawInput ?? '').trim();
    if (!input) return { op: 'help' };
    if (input.startsWith('{')) {
      try {
        const parsed = JSON.parse(input);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.op === 'string') return parsed;
        return { error: 'JSON input must be an object with an "op" field' };
      } catch (error) {
        return { error: `invalid JSON: ${error.message}` };
      }
    }
    const space = input.indexOf(' ');
    const op = (space === -1 ? input : input.slice(0, space)).toLowerCase();
    const rest = space === -1 ? '' : input.slice(space + 1).trim();
    if (rest) {
      try {
        const args = JSON.parse(rest);
        return { op, ...(args && typeof args === 'object' && !Array.isArray(args) ? args : { value: args }) };
      } catch {
        return { op, value: rest };
      }
    }
    return { op };
  }

  const text = (payload) => JSON.stringify(payload);

  ctx.effect(() => ctx.commands.register({
    name: 'agent-studio',
    description: 'Agent Studio: create, configure, export and run subagent templates',
    input: { hint: '<op> [json] — try: /agent-studio help' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const args = parseCommand(rawInput);
      if (args.error) return { kind: 'error', text: `/agent-studio: ${args.error}` };
      if (!COMMAND_OPS.has(args.op)) return { kind: 'error', text: `/agent-studio: unknown op "${args.op}". Ops: ${[...COMMAND_OPS].join(', ')}` };
      try {
        const result = await dispatch(args, agent, signal);
        if (result === undefined) return { kind: 'success' };
        return result.ok === false ? { kind: 'error', text: text(result) } : { kind: 'success', text: text(result) };
      } catch (error) {
        ctx.logger.error(`agent-studio: op ${args.op} failed: ${error?.message ?? error}`);
        return { kind: 'error', text: text({ ok: false, error: error?.message ?? String(error) }) };
      }
    },
  }), 'agent-studio: session command');

  async function dispatch(args, agent, signal) {
    switch (args.op) {
      case 'help':
        return { ok: true, ops: [...COMMAND_OPS], json: 'Pass JSON after the op, e.g. /agent-studio list {"query":"review"}' };
      case 'list':
        return listTemplates(agent, args);
      case 'get': {
        const resolved = await resolveLayers(args.id, agent);
        if (!resolved.ok) return resolved;
        return { ok: true, ...resolved };
      }
      case 'save':
        return saveGlobalTemplate(args.template ?? args, {});
      case 'delete':
        return deleteGlobalTemplate(args.id);
      case 'duplicate':
        return duplicateTemplate(args.id, args.name, agent);
      case 'toggle':
        return toggleTemplate(args.id, args.enabled);
      case 'run':
        return runSubagent(agent, args, signal);
      case 'effective':
        return effectiveReport(args.id, agent);
      case 'skills':
        return skillsCatalog();
      case 'tools':
        return { ok: true, ...toolsCatalog(), custom: (await customToolList()).rows };
      case 'tool-list':
        return customToolList();
      case 'tool-save':
        return customToolSave(agent, args);
      case 'tool-delete':
        return customToolDelete(agent, args.id);
      case 'skill-list':
        return skillList(agent);
      case 'skill-get':
        return skillGet(agent, args.name);
      case 'skill-save':
        return skillSave(agent, args);
      case 'skill-delete':
        return skillDelete(agent, args.name);
      case 'tools':
        return { ok: true, ...toolsCatalog() };
      case 'export':
        return exportTemplates(agent, args);
      case 'import':
        return importTemplates(agent, args);
      case 'project-save': {
        const globals = await globalTemplates();
        const ids = Array.isArray(args.ids) ? args.ids : args.all === true ? globals.map((t) => t.id) : null;
        const project = await readProjectTemplates(agent);
        const existing = project.templates;
        const all = new Map(existing.map((t) => [t.id, t]));
        const chosen = ids ?? [];
        for (const id of chosen) {
          const global = globals.find((t) => t.id === id);
          const source = global ?? (BUILTIN_IDS.has(id) ? builtinById(id) : null);
          if (!source) continue;
          all.set(id, { ...source, scope: 'project', builtin: false, enabled: source.enabled !== false });
        }
        const templates = [...all.values()];
        const result = await writeProjectTemplates(agent, templates, { confirmOverwrite: args.confirm !== false });
        if (result.ok) {
          const prev = project.exists ? project.templates : null;
          pushUndo(`project-save (${templates.length})`, async () => {
            if (prev) await writeProjectTemplates(agent, prev, { confirmOverwrite: true });
            return 'restored previous project configuration';
          });
          return { ok: true, ...result, templates: templates.length };
        }
        return result;
      }
      case 'project-status': {
        const project = await readProjectTemplates(agent);
        return { ok: true, root: project.root, file: projectFilePath(), exists: project.exists, error: project.error, ids: project.templates.map((t) => t.id) };
      }
      case 'undo': {
        const last = undoJournal.pop();
        if (!last) return { ok: false, error: 'nothing to undo' };
        const message = await last.undo();
        return { ok: true, undone: last.label, message };
      }
      default:
        return { ok: false, error: `unsupported op ${args.op}` };
    }
  }

  // -- model-facing tool -------------------------------------------------------

  ctx.effect(() => ctx.tools.register({
    name: 'agent_studio_run_subagent',
    description: 'Run a subagent from an Agent Studio template: built-in role, global user template, or project override. Resolves the effective configuration (builtin -> global -> project -> run overrides), enforces the template tool policy on the child, and starts the child through the standard subagent seam. Returns the child agent id immediately; completion is notified by the runtime.',
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template name or id, e.g. "builtin-code-reviewer".' },
        task: { type: 'string', description: 'The task for the subagent. Include everything it needs: it does not inherit your conversation.' },
        context: { type: 'string', description: 'Optional extra context (files, constraints, links).' },
        run_in_background: { type: 'boolean', description: 'Optional. Starts are always async; this flag is accepted for compatibility and does not change delivery.' },
        overrides: {
          type: 'object',
          description: 'Optional per-run overrides merged over the template. A project or run layer can never loosen a global tool-policy deny.',
          properties: {
            model: { type: 'string', description: 'Model override, "provider/model" or bare model id.' },
            skills: { type: 'array', items: { type: 'string' }, description: 'Replacement recommended-skills list.' },
            tools: { type: 'array', items: { type: 'string' }, description: 'Replacement tool visibility hint; denied tools stay denied.' },
            tool_policy: { type: 'object', description: 'Tool policy override {preset?, rules?}.' },
            max_delegation_depth: { type: 'integer', description: 'Override delegation depth (1-4, capped by plugin config).' },
          },
        },
      },
      required: ['template', 'task'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          kind: { type: 'string', const: 'activation' },
          subagentId: { type: 'string' },
        },
        required: ['kind', 'subagentId'],
      },
      render: (_args, value) => [{ type: 'text', text: `started Agent Studio subagent ${value.subagentId}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const overrides = {};
      const raw = args.overrides ?? {};
      if (raw.model && typeof raw.model === 'string') {
        const slash = raw.model.indexOf('/');
        overrides.model = slash > 0 ? { provider: raw.model.slice(0, slash), model: raw.model.slice(slash + 1) } : { model: raw.model };
      }
      if (Array.isArray(raw.skills)) overrides.skills = raw.skills;
      if (Array.isArray(raw.tools)) overrides.tools = raw.tools;
      if (raw.tool_policy && typeof raw.tool_policy === 'object') overrides.toolPolicy = raw.tool_policy;
      if (Number.isInteger(raw.max_delegation_depth)) overrides.maxDelegationDepth = raw.max_delegation_depth;
      const result = await runSubagent(exec.agent, { ...args, overrides }, exec.signal);
      if (!result.ok) throw new Error(result.error);
      return { kind: 'activation', subagentId: result.subagentId, ...result };
    },
  }), 'agent-studio: run tool');

  return () => {
    pendingChildren.clear();
    for (const id of [...liveCustomTools.keys()]) unmountCustomTool(id);
  };
}

// Re-exported for tests.
export { PLUGIN_VERSION };
