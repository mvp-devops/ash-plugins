/**
 * Agent Studio pure logic: template validation, layer merge, tool-policy
 * resolution, and portable export/import. No Harness imports: this module is
 * unit-tested directly with node:test.
 */

import { BUILTIN_TEMPLATES, BUILTIN_IDS, TOOL_POLICY_PRESETS, SCHEMA_VERSION } from './builtin-templates.js';

export { BUILTIN_TEMPLATES, BUILTIN_IDS, TOOL_POLICY_PRESETS, SCHEMA_VERSION };

export const STATUSES = ['allow', 'deny', 'ask', 'inherit'];
/** 'ask' cannot be enforced without a confirmation waterfall on the child, so it is enforced conservatively. */
export const ASK_ENFORCEMENT = 'deny';

/**
 * Well-known model-facing tool names. Many Harness tools are registered in
 * each agent's own scope rather than the global registry, so policy
 * resolution unions the live registry with this list: presets stay meaningful
 * for per-agent tools and unknown future tools resolve through the preset.
 */
export const KNOWN_MODEL_TOOLS = [
  // filesystem / code editing
  'read', 'read_image', 'write', 'edit', 'apply_patch', 'glob', 'grep', 'lsp',
  'load_workspace_dependencies', 'present', 'todo_write',
  // shell
  'bash', 'pwsh', 'skill', 'terminal_open', 'terminal_list', 'terminal_read',
  'terminal_signal', 'terminal_close',
  // web
  'web_search', 'web_fetch',
  // sessions / background
  'job_list', 'job_output', 'job_kill', 'wait_agent', 'session_search',
  'session_trace', 'session_event_read', 'session_event_search',
  'session_event_trace',
  // goals / plans
  'create_goal', 'get_goal', 'update_goal', 'exit_plan_mode',
  // agents / teams
  'subagent', 'subagent_fork', 'list_subagent_models', 'list_agents',
  'send_message', 'interrupt_agent', 'spawn_teammate',
  'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update',
  // schedules
  'schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit',
  // questions / cards / misc
  'ask_user_question', 'propose_action', 'workflow', 'ralph',
  'working_directory', 'create_worktree', 'plugin_manager',
  'cordis_inspect_list', 'cordis_inspect_query', 'cordis_define',
  'cordis_undefine', 'cordis_run', 'cordis_stop',
  // agent studio
  'agent_studio_run_subagent',
];

export const TOOL_CATEGORIES = {
  filesystem: 'Filesystem',
  shell: 'Shell / terminal',
  web: 'Web search',
  browser: 'Browser',
  'code-editing': 'Code editing',
  git: 'Git',
  testing: 'Testing',
  documentation: 'Documentation',
  'project-specific': 'Project-specific',
  custom: 'Custom',
};

const CATEGORY_PATTERNS = [
  [/^(read|glob|grep|read_image|list|lsp|load_workspace_dependencies|present|todo_write|wait_agent|job_list|job_output|session_search|session_trace|schedule_list|schedule_view|get_goal|list_agents|list_subagent_models|team_task_list|team_task_get|cordis_inspect_list|cordis_inspect_query)$/, 'filesystem'],
  [/^(write|edit|apply_patch|str_replace|create_goal|update_goal|team_task_create|team_task_update|schedule_create|schedule_edit|job_kill|interrupt_agent|cordis_define|cordis_undefine)$/, 'code-editing'],
  [/^(bash|pwsh|terminal_|skill)$/, 'shell'],
  [/^web_(search|fetch)$/, 'web'],
  [/^(browser|computer|cua|screenshot|click|type_|navigate)/, 'browser'],
  [/^git[_-]/, 'git'],
  [/^(test|vitest|jest|playwright|pytest)/, 'testing'],
  [/^(doc|docs|wiki)/, 'documentation'],
];

/** Category of one model-facing tool name; unknown names land in `custom`. */
export function toolCategory(name) {
  for (const [pattern, category] of CATEGORY_PATTERNS) if (pattern.test(name)) return category;
  return 'custom';
}

/**
 * Preset defaults: each preset lists categories and explicit tools that stay
 * allowed; restrictive presets deny everything else. `custom` imposes nothing.
 */
export const PRESET_DEFAULTS = {
  'read-only': {
    allowCategories: ['filesystem', 'web', 'documentation', 'git'],
    allowTools: ['read', 'glob', 'grep', 'read_image', 'lsp', 'load_workspace_dependencies', 'web_search', 'web_fetch', 'present', 'todo_write', 'list_agents', 'list_subagent_models', 'wait_agent', 'job_list', 'job_output', 'schedule_list', 'schedule_view', 'get_goal', 'team_task_list', 'team_task_get', 'cordis_inspect_list', 'cordis_inspect_query', 'skill'],
  },
  'code-editing': {
    allowCategories: ['filesystem', 'shell', 'code-editing', 'git', 'testing', 'documentation', 'web'],
    allowTools: ['read', 'write', 'edit', 'glob', 'grep', 'read_image', 'bash', 'pwsh', 'skill', 'lsp', 'load_workspace_dependencies', 'web_search', 'web_fetch', 'apply_patch', 'present', 'todo_write', 'create_goal', 'update_goal', 'job_list', 'job_output', 'job_kill', 'wait_agent', 'schedule_list', 'schedule_view', 'schedule_create', 'get_goal', 'list_agents', 'list_subagent_models', 'team_task_list', 'team_task_get', 'cordis_inspect_list', 'cordis_inspect_query'],
  },
  'full-developer': {
    allowCategories: ['filesystem', 'shell', 'web', 'browser', 'code-editing', 'git', 'testing', 'documentation', 'project-specific', 'custom'],
    allowTools: [],
  },
  'safe-qa': {
    allowCategories: ['testing', 'browser', 'documentation'],
    allowTools: ['read', 'glob', 'grep', 'read_image', 'bash', 'pwsh', 'skill', 'web_search', 'web_fetch', 'present', 'todo_write', 'wait_agent', 'job_list', 'job_output', 'load_workspace_dependencies', 'schedule_list', 'schedule_view', 'get_goal', 'list_agents', 'cordis_inspect_list', 'cordis_inspect_query'],
  },
  'research-only': {
    allowCategories: ['web', 'documentation'],
    allowTools: ['read', 'glob', 'grep', 'read_image', 'skill', 'web_search', 'web_fetch', 'present', 'todo_write', 'wait_agent', 'job_list', 'job_output', 'load_workspace_dependencies', 'schedule_list', 'schedule_view', 'get_goal', 'list_agents', 'list_subagent_models', 'team_task_list', 'team_task_get', 'cordis_inspect_list', 'cordis_inspect_query', 'session_search', 'session_trace'],
  },
  custom: {
    allowCategories: [],
    allowTools: [],
  },
};

/** Preset-implied status of one tool before explicit rules. */
export function presetStatus(preset, toolName) {
  const defaults = PRESET_DEFAULTS[preset] ?? PRESET_DEFAULTS.custom;
  if (defaults.allowTools.includes(toolName)) return 'allow';
  const category = toolCategory(toolName);
  if (defaults.allowCategories.includes(category)) return 'allow';
  return preset === 'custom' ? 'inherit' : 'deny';
}

/** Strip null/undefined fields; arrays and plain objects validate recursively. */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = clean(item);
    return out;
  }
  return value;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/** Validate one template object; returns a list of human-readable problems. */
export function validateTemplate(input, { projectScopeAllowed = true } = {}) {
  const problems = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['template must be an object'];
  if (typeof input.id !== 'string' || !ID_RE.test(input.id)) problems.push('id must match [a-z0-9][a-z0-9_-]{0,63}');
  if (typeof input.name !== 'string' || input.name.trim().length === 0) problems.push('name must be a non-empty string');
  if (input.name && input.name.length > 80) problems.push('name must be at most 80 characters');
  if (typeof input.role !== 'string' || input.role.trim().length === 0) problems.push('role must be a non-empty string');
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 2000)) problems.push('description must be a string of at most 2000 characters');
  if (typeof input.instructions !== 'string' || input.instructions.trim().length === 0) problems.push('instructions must be a non-empty string');
  if (input.instructions && input.instructions.length > 20000) problems.push('instructions must be at most 20000 characters');
  if (input.skills !== undefined && (!Array.isArray(input.skills) || input.skills.some((s) => typeof s !== 'string' || s.trim().length === 0))) problems.push('skills must be an array of non-empty strings');
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((s) => typeof s !== 'string'))) problems.push('tags must be an array of strings');
  if (input.scope !== undefined && input.scope !== 'global' && input.scope !== 'project') problems.push('scope must be "global" or "project"');
  if (input.scope === 'project' && !projectScopeAllowed) problems.push('project scope is not allowed here');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') problems.push('enabled must be a boolean');
  if (input.model !== undefined && input.model !== null) {
    if (typeof input.model !== 'object' || Array.isArray(input.model)) problems.push('model must be an object or null');
    else {
      if (input.model.provider !== undefined && typeof input.model.provider !== 'string') problems.push('model.provider must be a string');
      if (input.model.model !== undefined && typeof input.model.model !== 'string') problems.push('model.model must be a string');
    }
  }
  const depth = input.maxDelegationDepth;
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 1 || depth > 4)) problems.push('maxDelegationDepth must be an integer between 1 and 4');
  const policy = input.toolPolicy;
  if (policy !== undefined) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) problems.push('toolPolicy must be an object');
    else {
      if (policy.preset !== undefined && !TOOL_POLICY_PRESETS.includes(policy.preset)) problems.push(`toolPolicy.preset must be one of: ${TOOL_POLICY_PRESETS.join(', ')}`);
      if (policy.rules !== undefined) {
        if (!policy.rules || typeof policy.rules !== 'object' || Array.isArray(policy.rules)) problems.push('toolPolicy.rules must be an object');
        else for (const [tool, status] of Object.entries(policy.rules)) {
          if (!/^[a-z][a-z0-9_-]*$/u.test(tool)) problems.push(`toolPolicy.rules.${tool}: invalid tool name`);
          if (!STATUSES.includes(status)) problems.push(`toolPolicy.rules.${tool}: status must be one of ${STATUSES.join(', ')}`);
        }
      }
      if (policy.notes !== undefined && (typeof policy.notes !== 'object' || Array.isArray(policy.notes) || Object.values(policy.notes).some((n) => typeof n !== 'string'))) problems.push('toolPolicy.notes must be an object of strings');
    }
  }
  return problems;
}

/** Normalize a validated template into storage shape (fills defaults). */
export function normalizeTemplate(input, { scope = 'global', now = new Date().toISOString() } = {}) {
  const template = clean({
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    name: input.name.trim(),
    role: input.role.trim(),
    description: (input.description ?? '').trim(),
    instructions: input.instructions,
    skills: Array.isArray(input.skills) ? [...new Set(input.skills.map((s) => s.trim()).filter(Boolean))] : [],
    toolPolicy: {
      preset: input.toolPolicy?.preset ?? 'custom',
      rules: input.toolPolicy?.rules ?? {},
      ...(input.toolPolicy?.notes ? { notes: input.toolPolicy.notes } : {}),
    },
    model: input.model ?? null,
    maxDelegationDepth: input.maxDelegationDepth ?? 2,
    tags: Array.isArray(input.tags) ? [...new Set(input.tags)] : [],
    scope,
    builtin: false,
    enabled: input.enabled ?? true,
    updatedAt: now,
  });
  return template;
}

export function builtinById(id) {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Merge one template field-by-field over a base. `fields` restricts which
 * keys the upper layer may override; every applied override is recorded so
 * the UI can show the effective value and its source.
 */
const MERGEABLE_FIELDS = ['name', 'role', 'description', 'instructions', 'skills', 'toolPolicy', 'model', 'maxDelegationDepth', 'tags', 'enabled'];

export function layerMerge(base, upper, source, fields = MERGEABLE_FIELDS) {
  const applied = [];
  const result = { ...base };
  for (const field of fields) {
    const value = upper?.[field];
    if (value === undefined) continue;
    if (field === 'toolPolicy' && value && base.toolPolicy) {
      const preset = value.preset !== undefined && value.preset !== 'custom' ? value.preset : base.toolPolicy.preset;
      result.toolPolicy = {
        preset,
        rules: { ...base.toolPolicy.rules, ...value.rules },
        ...(value.notes || base.toolPolicy.notes ? { notes: { ...base.toolPolicy.notes, ...value.notes } } : {}),
      };
    } else {
      result[field] = value;
    }
    applied.push({ field, source });
  }
  return { template: result, applied };
}

/**
 * Resolve the effective template: builtin -> global user -> project override
 * -> run-time overrides. Returns the effective template, the source of every
 * override, and the merge order that was followed.
 */
export function resolveTemplate({ id, globalTemplate, projectTemplate, runOverrides, projectRoot }) {
  const trail = [];
  let template;
  let origin;
  if (BUILTIN_IDS.has(id)) {
    template = { ...builtinById(id) };
    origin = 'builtin';
    trail.push({ source: 'builtin', applied: [] });
  } else if (globalTemplate) {
    template = { ...globalTemplate };
    origin = 'global';
    trail.push({ source: 'global', applied: [] });
  } else if (projectTemplate) {
    template = { ...projectTemplate, scope: 'project' };
    origin = 'project';
    trail.push({ source: 'project', applied: [] });
  } else {
    return { ok: false, error: `template "${id}" not found` };
  }
  const sources = {};
  const recordSources = (applied) => {
    for (const { field, source } of applied) sources[field] = source;
  };
  if (origin !== 'builtin' && BUILTIN_IDS.has(id)) {
    const merged = layerMerge(builtinById(id), template, origin);
    template = merged.template;
    recordSources(merged.applied);
  }
  if (globalTemplate && origin === 'builtin') {
    const merged = layerMerge(template, globalTemplate, 'global');
    template = merged.template;
    trail.push({ source: 'global', applied: merged.applied });
    recordSources(merged.applied);
  }
  if (projectTemplate && projectRootOk(projectTemplate, projectRoot)) {
    const merged = layerMerge(template, projectTemplate, 'project');
    template = merged.template;
    template.scope = 'project';
    trail.push({ source: 'project', applied: merged.applied });
    recordSources(merged.applied);
  }
  if (runOverrides) {
    const merged = layerMerge(template, runOverrides, 'run');
    template = merged.template;
    trail.push({ source: 'run', applied: merged.applied });
    recordSources(merged.applied);
  }
  return { ok: true, template, origin, trail, sources };
}

function projectRootOk(projectTemplate, projectRoot) {
  // A project override is only valid relative to a discovered project root.
  return Boolean(projectTemplate) && typeof projectRoot === 'string' && projectRoot.length > 0;
}

/**
 * Resolve the effective tool policy for a registry of tool names.
 *
 * Layer order: builtin -> global -> project -> run. A lower (earlier) layer's
 * `deny` cannot be loosened by a later layer: later layers may only keep or
 * tighten. Every conflict is reported instead of being applied silently.
 * `ask` is enforced as `deny` (ASK_ENFORCEMENT) because the child subagent has
 * no confirmation waterfall of its own.
 */
export function resolveToolPolicy({ toolPolicy, registryNames, origin = 'template' }) {
  const names = [...registryNames];
  const preset = toolPolicy?.preset ?? 'custom';
  const rules = toolPolicy?.rules ?? {};
  const notes = toolPolicy?.notes ?? {};
  const statuses = {};
  const sources = {};
  const conflicts = [];
  for (const name of names) {
    let status = presetStatus(preset, name);
    if (status === 'inherit') status = 'allow';
    sources[name] = { status, source: preset === 'custom' ? `${origin}:custom-default` : `${origin}:preset:${preset}` };
    const rule = rules[name];
    if (rule !== undefined && rule !== 'inherit') {
      // Within one layer the explicit rule is the author's intent and wins
      // over the preset default; loosening is only forbidden BETWEEN layers
      // (see mergeToolPolicies). `ask` stays visible as `ask` but is enforced
      // conservatively (ASK_ENFORCEMENT) because a child subagent has no
      // confirmation waterfall of its own.
      status = rule;
      sources[name] = { status, source: `${origin}:rule` };
    }
    statuses[name] = status;
  }
  const enforced = {};
  for (const name of names) enforced[name] = statuses[name] === 'ask' ? ASK_ENFORCEMENT : statuses[name];
  const denyList = names.filter((name) => enforced[name] === 'deny');
  const allowList = names.filter((name) => enforced[name] === 'allow');
  return { statuses, enforced, sources, conflicts, denyList, allowList, preset, notes, origin };
}

/**
 * Merge policy layers with the no-loosening guarantee. `layers` is ordered
 * from weakest to strongest: [{toolPolicy, origin}]. The first layer
 * establishes the base; every later layer may only tighten.
 */
export function mergeToolPolicies(layers, registryNames) {
  if (layers.length === 0) throw new Error('mergeToolPolicies requires at least one layer');
  let effective = resolveToolPolicy({ toolPolicy: layers[0].toolPolicy, registryNames, origin: layers[0].origin });
  const conflicts = [...effective.conflicts];
  for (let index = 1; index < layers.length; index++) {
    const layer = resolveToolPolicy({ toolPolicy: layers[index].toolPolicy, registryNames, origin: layers[index].origin });
    conflicts.push(...layer.conflicts);
    // The strongest layer that declares a preset owns the display preset.
    if (layers[index].toolPolicy !== undefined && layer.preset) effective.preset = layer.preset;
    for (const name of registryNames) {
      const current = effective.enforced[name];
      const next = layer.enforced[name];
      if (next === current) continue;
      if (current === 'deny' && next === 'allow') {
        conflicts.push({ tool: name, base: 'deny', attempted: 'allow', source: layer.origin, resolution: 'kept deny' });
        continue;
      }
      effective.statuses[name] = layer.statuses[name];
      effective.enforced[name] = next;
      effective.sources[name] = layer.sources[name];
    }
    effective.conflicts = conflicts;
    effective.denyList = registryNames.filter((name) => effective.enforced[name] === 'deny');
    effective.allowList = registryNames.filter((name) => effective.enforced[name] === 'allow');
  }
  return effective;
}

/** Effective-policy summary for list rows. */
export function policySummary(effective) {
  const categories = {};
  for (const [name, status] of Object.entries(effective.statuses)) {
    const category = toolCategory(name);
    categories[category] ??= { allow: 0, deny: 0, ask: 0 };
    categories[category][status] = (categories[category][status] ?? 0) + 1;
  }
  return { preset: effective.preset, deny: effective.denyList.length, allow: effective.allowList.length, byCategory: categories };
}

// ---------------------------------------------------------------------------
// Portable export / import
// ---------------------------------------------------------------------------

export const EXPORT_FORMAT = 'agent-studio/templates';
const SECRET_KEY_RE = /token|secret|password|api[-_]?key|credential|authorization|private[-_]?key/iu;

/** Replace machine-specific absolute paths with portable placeholders (all occurrences). */
export function placeholdPaths(value, { projectRoot, userHome }) {
  const replaceAll = (string, from, to) => {
    if (!from || !string.includes(from)) return string;
    return string.split(from).join(to);
  };
  if (typeof value === 'string') {
    let out = value;
    if (projectRoot) out = replaceAll(out, projectRoot, '${PROJECT_ROOT}');
    if (userHome) out = replaceAll(out, userHome, '${USER_HOME}');
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => placeholdPaths(item, { projectRoot, userHome }));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = placeholdPaths(item, { projectRoot, userHome });
    return out;
  }
  return value;
}

/** Restore placeholders using the current machine's project root and home. */
export function restorePlaceholders(value, { projectRoot, userHome }) {
  if (typeof value === 'string') {
    let out = value;
    if (out.includes('${PROJECT_ROOT}')) out = out.replaceAll('${PROJECT_ROOT}', projectRoot ?? '.');
    if (out.includes('${USER_HOME}')) out = out.replaceAll('${USER_HOME}', userHome ?? '~');
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => restorePlaceholders(item, { projectRoot, userHome }));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = restorePlaceholders(item, { projectRoot, userHome });
    return out;
  }
  return value;
}

/** Deep-clone JSON data. */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Sanitize one template for export: strip secret-shaped keys, placeholder
 * machine paths, and drop machine-local fields. Returns null when the
 * template becomes empty.
 */
export function sanitizeForExport(template, contexts) {
  const stripped = clone(template);
  delete stripped.updatedAt;
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk).filter((item) => item !== undefined);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        if (SECRET_KEY_RE.test(key)) continue;
        const next = walk(item);
        if (next !== undefined) out[key] = next;
      }
      return out;
    }
    if (typeof value === 'string' && SECRET_KEY_RE.test(value)) return undefined;
    return value;
  };
  const cleaned = walk(stripped);
  if (!cleaned || typeof cleaned !== 'object') return null;
  return placeholdPaths(cleaned, contexts);
}

/** Build a portable export document. */
export function buildExportDocument(templates, { pluginVersion, projectRoot, userHome, customTools = [], now = new Date().toISOString() } = {}) {
  const sanitized = templates
    .map((template) => sanitizeForExport(template, { projectRoot, userHome }))
    .filter(Boolean);
  const sanitizedTools = customTools
    .map((tool) => sanitizeForExport(tool, { projectRoot, userHome }))
    .filter(Boolean);
  const doc = {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      plugin: 'agent-studio',
      pluginVersion: pluginVersion ?? null,
      createdAt: now,
      name: 'Agent Studio configuration',
      description: `Export of ${sanitized.length} agent template(s)`,
      count: sanitized.length,
    },
    templates: sanitized,
  };
  if (sanitizedTools.length > 0) doc.customTools = sanitizedTools;
  return doc;
}

/** Validate an imported document; returns problems, warnings, templates and custom tools. */
export function validateImportDocument(doc) {
  const errors = [];
  const warnings = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, errors: ['document must be a JSON object'], warnings, templates: [], customTools: [] };
  if (doc.format !== EXPORT_FORMAT) errors.push(`format must be "${EXPORT_FORMAT}"`);
  const version = doc.schemaVersion;
  if (!Number.isInteger(version) || version < 1) errors.push('schemaVersion must be a positive integer');
  else if (version > SCHEMA_VERSION) warnings.push(`document schemaVersion ${version} is newer than this plugin (${SCHEMA_VERSION}); import may lose fields`);
  else if (version < SCHEMA_VERSION) warnings.push(`document schemaVersion ${version} is older than this plugin (${SCHEMA_VERSION}); fields will be migrated`);
  if (!Array.isArray(doc.templates)) errors.push('templates must be an array');
  const templates = [];
  if (Array.isArray(doc.templates)) {
    doc.templates.forEach((entry, index) => {
      const migrated = migrateTemplate(entry, version);
      for (const problem of migrateWarnings(entry, version)) warnings.push(`templates[${index}]: ${problem}`);
      const problems = validateTemplate(migrated);
      if (problems.length > 0) for (const problem of problems) errors.push(`templates[${index}] (${entry?.id ?? '?'}): ${problem}`);
      else templates.push(migrated);
    });
  }
  const ids = templates.map((t) => t.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) errors.push(`duplicate template id "${duplicate}" in document`);
  const customTools = [];
  if (doc.customTools !== undefined) {
    if (!Array.isArray(doc.customTools)) errors.push('customTools must be an array');
    else doc.customTools.forEach((entry, index) => {
      const problems = validateCustomTool(entry);
      if (problems.length > 0) for (const problem of problems) errors.push(`customTools[${index}] (${entry?.name ?? '?'}): ${problem}`);
      else customTools.push({ id: entry.id ?? `ct-${index}`, name: entry.name, description: entry.description, content: entry.content });
    });
  }
  return { ok: errors.length === 0, errors, warnings, templates, customTools };
}

/** Migrate one template between schema versions (v1 is the first version). */
export function migrateTemplate(entry, fromVersion) {
  const migrated = clone(entry) ?? {};
  if (!Number.isInteger(fromVersion) || fromVersion < 1) migrated.schemaVersion = SCHEMA_VERSION;
  if (typeof migrated.enabled !== 'boolean') migrated.enabled = true;
  if (migrated.scope !== 'project') migrated.scope = 'global';
  migrated.schemaVersion = SCHEMA_VERSION;
  return migrated;
}

function migrateWarnings(entry, fromVersion) {
  const warnings = [];
  if (entry && typeof entry === 'object' && Number.isInteger(fromVersion) && fromVersion > SCHEMA_VERSION) warnings.push(`template "${entry.id ?? '?'}" was written by a newer schema version`);
  return warnings;
}

/** Compare incoming templates with existing ones. */
export function diffImport(incoming, existingById) {
  return incoming.map((template) => {
    const existing = existingById[template.id];
    if (!existing) return { id: template.id, name: template.name, action: 'create' };
    const changes = [];
    for (const field of MERGEABLE_FIELDS) {
      const before = JSON.stringify(existing[field] ?? null);
      const after = JSON.stringify(template[field] ?? null);
      if (before !== after) changes.push({ field, before: existing[field] ?? null, after: template[field] ?? null });
    }
    return changes.length === 0
      ? { id: template.id, name: template.name, action: 'same' }
      : { id: template.id, name: template.name, action: 'update', changes };
  });
}

/**
 * Apply an import diff with a strategy. Returns the resulting global
 * template list plus per-entry outcomes. Overwriting existing templates
 * requires `confirmOverwrite` (the UI asks explicitly).
 */
export function applyImport(diff, existingList, incomingById, strategy, { confirmOverwrite = false, now = new Date().toISOString() } = {}) {
  const outcomes = [];
  let list = [...existingList];
  const index = new Map(list.map((t) => [t.id, t]));
  for (const entry of diff) {
    const incoming = incomingById[entry.id];
    if (entry.action === 'create') {
      const created = normalizeTemplate(incoming, { scope: 'global', now });
      list.push(created);
      index.set(created.id, created);
      outcomes.push({ id: entry.id, action: 'created' });
      continue;
    }
    if (entry.action === 'same') {
      outcomes.push({ id: entry.id, action: 'unchanged' });
      continue;
    }
    // action === 'update'
    if (strategy === 'skip-existing') {
      outcomes.push({ id: entry.id, action: 'skipped' });
      continue;
    }
    if (strategy === 'create-copy') {
      let copyId = `${entry.id}-imported`;
      let n = 2;
      while (index.has(copyId)) copyId = `${entry.id}-imported-${n++}`;
      const copy = normalizeTemplate({ ...incoming, id: copyId, name: `${incoming.name} (imported)` }, { scope: 'global', now });
      list.push(copy);
      index.set(copy.id, copy);
      outcomes.push({ id: entry.id, action: 'copied', copyId });
      continue;
    }
    if (strategy === 'merge') {
      const existing = index.get(entry.id);
      const merged = layerMerge(existing, incoming, 'import').template;
      merged.updatedAt = now;
      index.set(entry.id, merged);
      list = list.map((t) => (t.id === entry.id ? merged : t));
      outcomes.push({ id: entry.id, action: 'merged' });
      continue;
    }
    // strategy === 'overwrite'
    if (!confirmOverwrite) {
      outcomes.push({ id: entry.id, action: 'needs-confirmation' });
      continue;
    }
    const replaced = normalizeTemplate({ ...incoming, id: entry.id }, { scope: 'global', now });
    index.set(entry.id, replaced);
    list = list.map((t) => (t.id === entry.id ? replaced : t));
    outcomes.push({ id: entry.id, action: 'overwritten' });
  }
  return { templates: list, outcomes };
}

// ---------------------------------------------------------------------------
// Skills (project SKILL.md files) and custom tools
// ---------------------------------------------------------------------------

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/u;
export const CUSTOM_TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/u;

export const SKILLS_DIR = '.dsh/skills';
export const CUSTOM_TOOLS_DIR = '.agent-studio/tools';

/** Validate a skill name for project-scope creation. */
export function validateSkillName(name) {
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) {
    return ['skill name must match [a-z0-9][a-z0-9-]{0,63} (used as the skill directory name)'];
  }
  return [];
}

/** Build SKILL.md content with YAML frontmatter. */
export function buildSkillFile(name, description, body) {
  const escaped = String(description).replaceAll('"', '\\"');
  return `---\nname: "${name}"\ndescription: "${escaped}"\n---\n\n${String(body).trim()}\n`;
}

/** Parse a SKILL.md (frontmatter name/description + body); tolerant reader. */
export function parseSkillFile(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(text);
  if (!match) return { name: null, description: null, body: text.trim() };
  const [, frontmatter, body] = match;
  const name = /^name:\s*"?([^"\n]+)"?/mu.exec(frontmatter)?.[1]?.trim() ?? null;
  const description = /^description:\s*"?([^"\n]+)"?/mu.exec(frontmatter)?.[1]?.trim() ?? null;
  return { name, description, body: body.trim() };
}

/** Validate one custom tool record; returns problems. */
export function validateCustomTool(input) {
  const problems = [];
  if (!input || typeof input !== 'object') return ['custom tool must be an object'];
  if (input.id !== undefined && (typeof input.id !== 'string' || !ID_RE.test(input.id))) problems.push('id must match [a-z0-9][a-z0-9_-]{0,63}');
  if (typeof input.name !== 'string' || !CUSTOM_TOOL_NAME_RE.test(input.name)) problems.push('name must match [a-z][a-z0-9_]{0,63}');
  if (typeof input.description !== 'string' || input.description.trim().length === 0) problems.push('description must be a non-empty string');
  if (input.description && input.description.length > 500) problems.push('description must be at most 500 characters');
  if (typeof input.content !== 'string' || input.content.trim().length === 0) problems.push('content must be a non-empty string');
  if (input.content && input.content.length > 50000) problems.push('content must be at most 50000 characters');
  return problems;
}

/** A custom tool may not shadow an existing registry tool or reserved names. */
export function customToolNameConflict(name, existingNames) {
  if (existingNames.includes(name)) return `tool "${name}" is already registered`;
  return null;
}

// ---------------------------------------------------------------------------
// Project file helpers
// ---------------------------------------------------------------------------

export const PROJECT_DIR = '.agent-studio';
export const PROJECT_FILE = 'agent-templates.json';

/** Relative project path of the portable project configuration file. */
export function projectFilePath() {
  return `${PROJECT_DIR}/${PROJECT_FILE}`;
}

/**
 * Parse a project configuration document. The file stores only project-scope
 * templates and never machine-local values.
 */
export function parseProjectDocument(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error.message}` };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'document must be a JSON object' };
  if (doc.format !== EXPORT_FORMAT) return { ok: false, error: `format must be "${EXPORT_FORMAT}"` };
  if (!Array.isArray(doc.templates)) return { ok: false, error: 'templates must be an array' };
  const templates = [];
  const errors = [];
  doc.templates.forEach((entry, index) => {
    const template = { ...migrateTemplate(entry, doc.schemaVersion), scope: 'project' };
    const problems = validateTemplate(template);
    if (problems.length > 0) for (const problem of problems) errors.push(`templates[${index}]: ${problem}`);
    else templates.push(template);
  });
  return { ok: errors.length === 0, errors, templates };
}

/** Build the project document from project-scope templates. */
export function buildProjectDocument(templates, { now = new Date().toISOString() } = {}) {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    metadata: { updatedAt: now, count: templates.length },
    templates: templates.map((t) => sanitizeForExport({ ...t, scope: 'project' }, {})),
  };
}

/** A project override may never widen the global policy. */
export function projectMayNotWiden(globalPolicy, projectTemplate, registryNames) {
  const merged = mergeToolPolicies([
    { toolPolicy: globalPolicy, origin: 'global' },
    { toolPolicy: projectTemplate?.toolPolicy ?? {}, origin: 'project' },
  ], registryNames);
  return { policy: merged, widened: merged.conflicts };
}
