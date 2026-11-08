/**
 * Генератор технического плана из утверждённой спецификации.
 *
 * План детерминированно выводится из требований: по одному пункту плана на
 * каждое требование (плюс пункты качества для нефункциональных требований).
 * Содержательные поля (анализ кодовой базы, архитектурные решения, файлы)
 * заполняются агентом/пользователем через аргументы команды — плагин ничего
 * не «угадывает». План не создаётся, если спецификация содержит blocker-
 * проблемы (проверяет вызывающая сторона через validateSpec/hasBlockers).
 */

import { ArtifactValidationError } from './errors.js';
import type { Spec } from './spec-model.js';

/** Версия схемы плана. */
export const PLAN_SCHEMA_VERSION = 1;

export type PlanStatus = 'draft' | 'approved';

/** Пункт плана, трассируемый к требованиям спецификации. */
export interface PlanItem {
  id: string;
  title: string;
  description: string;
  requirement_ids: string[];
  files: string[];
  notes: string;
}

export interface PlanModule {
  id: string;
  path: string;
  description: string;
  requirement_ids: string[];
}

export interface ArchitectureDecision {
  id: string;
  title: string;
  rationale: string;
  requirement_ids: string[];
}

export interface PlanStep {
  order: number;
  description: string;
  item_ids: string[];
}

export interface Plan {
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  spec_id: string;
  spec_version: string;
  status: PlanStatus;
  codebase_analysis: string;
  modules: PlanModule[];
  architecture_decisions: ArchitectureDecision[];
  contracts: { id: string; kind: 'api' | 'data'; description: string; requirement_ids: string[] }[];
  sequence: PlanStep[];
  items: PlanItem[];
  risks_and_rollback: string;
  readiness_criteria: string[];
  generated_at: string;
}

/** Вход генерации плана — всё содержательное приходит извне. */
export interface PlanInput {
  /** Анализ текущей кодовой базы (обязателен). */
  codebase_analysis: string;
  /** Затрагиваемые модули: путь + описание. */
  modules?: { path: string; description: string; requirement_ids?: string[] }[];
  /** Архитектурные решения. */
  architecture_decisions?: { title: string; rationale: string; requirement_ids?: string[] }[];
  /** Дополнительные пункты плана сверх выводимых из требований. */
  extra_items?: { title: string; description?: string; requirement_ids?: string[]; files?: string[] }[];
  /** Риски и rollback-стратегия (текст). */
  risks_and_rollback?: string;
  /** Критерии готовности; по умолчанию — из definition_of_done спецификации. */
  readiness_criteria?: string[];
  /** Последовательность изменений; по умолчанию — порядок пунктов. */
  sequence?: { description: string; item_ids?: string[] }[];
  /** Метка времени генерации. */
  now: string;
}

let counter = 0;

/** Генерация следующего идентификатора пункта плана (P-001, P-002, …). */
function nextItemId(): string {
  counter += 1;
  return `P-${String(counter).padStart(3, '0')}`;
}

/** Сброс счётчика идентификаторов (для тестов и повторной генерации). */
export function resetItemCounter(start = 0): void {
  counter = start;
}

/**
 * Сгенерировать план из спецификации. Бросает {@link ArtifactValidationError},
 * если анализ кодовой базы не передан.
 */
export function generatePlan(spec: Spec, input: PlanInput): Plan {
  if (!input.codebase_analysis || input.codebase_analysis.trim() === '') {
    throw new ArtifactValidationError('Для генерации плана нужен анализ текущей кодовой базы (codebase_analysis).', {
      file: '.sdd/plan.md',
      field: 'codebase_analysis',
      hint: 'Передайте результат анализа кодовой базы в аргументах команды sdd-plan.',
    });
  }

  const items: PlanItem[] = [];
  for (const requirement of spec.functional_requirements) {
    items.push({
      id: nextItemId(),
      title: `Реализовать требование ${requirement.id}: ${requirement.title}`,
      description: requirement.description,
      requirement_ids: [requirement.id],
      files: [],
      notes: '',
    });
  }
  for (const requirement of spec.non_functional_requirements) {
    items.push({
      id: nextItemId(),
      title: `Обеспечить нефункциональное требование ${requirement.id}: ${requirement.title}`,
      description: requirement.description,
      requirement_ids: [requirement.id],
      files: [],
      notes: 'Нефункциональное требование: проверить измеримо.',
    });
  }
  for (const extra of input.extra_items ?? []) {
    items.push({
      id: nextItemId(),
      title: extra.title,
      description: extra.description ?? '',
      requirement_ids: extra.requirement_ids ?? [],
      files: extra.files ?? [],
      notes: 'Дополнительный пункт (инфраструктура/миграция/документация).',
    });
  }

  const edgeCaseItemNeeded = spec.edge_cases.length > 0;
  if (edgeCaseItemNeeded) {
    items.push({
      id: nextItemId(),
      title: `Покрыть edge cases (${spec.edge_cases.map((edgeCase) => edgeCase.id).join(', ')})`,
      description: spec.edge_cases.map((edgeCase) => `${edgeCase.id}: ${edgeCase.description} → ${edgeCase.expected_behavior}`).join('; '),
      requirement_ids: [...new Set(spec.edge_cases.flatMap((edgeCase) => edgeCase.requirement_ids))],
      files: [],
      notes: 'Каждый edge case должен получить явный тест.',
    });
  }

  const modules: PlanModule[] = (input.modules ?? []).map((module, index) => ({
    id: `M-${String(index + 1).padStart(3, '0')}`,
    path: module.path,
    description: module.description,
    requirement_ids: module.requirement_ids ?? [],
  }));

  const architecture_decisions: ArchitectureDecision[] = (input.architecture_decisions ?? []).map((decision, index) => ({
    id: `AD-${String(index + 1).padStart(3, '0')}`,
    title: decision.title,
    rationale: decision.rationale,
    requirement_ids: decision.requirement_ids ?? [],
  }));

  const contracts = [
    ...spec.api_contracts.map((contract) => ({ id: contract.id, kind: 'api' as const, description: contract.description, requirement_ids: contract.requirement_ids })),
    ...spec.data_contracts.map((contract) => ({ id: contract.id, kind: 'data' as const, description: contract.description, requirement_ids: contract.requirement_ids })),
  ];

  const sequence: PlanStep[] =
    input.sequence && input.sequence.length > 0
      ? input.sequence.map((step, index) => ({ order: index + 1, description: step.description, item_ids: step.item_ids ?? [] }))
      : items.map((item, index) => ({ order: index + 1, description: item.title, item_ids: [item.id] }));

  const readiness = input.readiness_criteria ?? [...spec.definition_of_done];

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    spec_id: spec.id,
    spec_version: spec.version,
    status: 'draft',
    codebase_analysis: input.codebase_analysis,
    modules,
    architecture_decisions,
    contracts,
    sequence,
    items,
    risks_and_rollback: input.risks_and_rollback ?? (spec.risks.length > 0 ? spec.risks.map((risk) => `${risk.id}: ${risk.description} → смягчение: ${risk.mitigation}`).join('\n') : ''),
    readiness_criteria: readiness,
    generated_at: input.now,
  };
}

/** Структурный разбор сохранённого плана. Минимальная, но строгая проверка. */
export function parsePlan(raw: unknown, file = '.sdd/plan.json'): Plan {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ArtifactValidationError('План должен быть JSON-объектом.', { file, hint: 'Перегенерируйте план командой sdd-plan.' });
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new ArtifactValidationError(`Неподдерживаемая schemaVersion плана: ${String(record.schemaVersion)}.`, {
      file,
      field: 'schemaVersion',
      hint: 'Перегенерируйте план командой sdd-plan.',
    });
  }
  const items = Array.isArray(record.items) ? record.items : [];
  const parsedItems: PlanItem[] = items.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new ArtifactValidationError(`items[${index}] должен быть объектом.`, { file, field: `items[${index}]` });
    }
    const entry = item as Record<string, unknown>;
    return {
      id: String(entry.id ?? `P-${index + 1}`),
      title: String(entry.title ?? ''),
      description: String(entry.description ?? ''),
      requirement_ids: Array.isArray(entry.requirement_ids) ? entry.requirement_ids.map(String) : [],
      files: Array.isArray(entry.files) ? entry.files.map(String) : [],
      notes: String(entry.notes ?? ''),
    };
  });
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    spec_id: String(record.spec_id ?? ''),
    spec_version: String(record.spec_version ?? ''),
    status: record.status === 'approved' ? 'approved' : 'draft',
    codebase_analysis: String(record.codebase_analysis ?? ''),
    modules: Array.isArray(record.modules) ? (record.modules as PlanModule[]) : [],
    architecture_decisions: Array.isArray(record.architecture_decisions) ? (record.architecture_decisions as ArchitectureDecision[]) : [],
    contracts: Array.isArray(record.contracts)
      ? (record.contracts as Plan['contracts'])
      : [],
    sequence: Array.isArray(record.sequence) ? (record.sequence as PlanStep[]) : [],
    items: parsedItems,
    risks_and_rollback: String(record.risks_and_rollback ?? ''),
    readiness_criteria: Array.isArray(record.readiness_criteria) ? record.readiness_criteria.map(String) : [],
    generated_at: String(record.generated_at ?? ''),
  };
}

/** Экспорт плана в Markdown (`.sdd/plan.md`). */
export function renderPlanMarkdown(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# Технический план — ${plan.spec_id} (спецификация v${plan.spec_version})`);
  lines.push('');
  lines.push(`Статус: **${plan.status}**. Сгенерирован: ${plan.generated_at}.`);
  lines.push('');
  lines.push('## Анализ кодовой базы');
  lines.push('');
  lines.push(plan.codebase_analysis);
  lines.push('');
  if (plan.modules.length > 0) {
    lines.push('## Затрагиваемые модули');
    lines.push('');
    for (const module of plan.modules) {
      lines.push(`- **${module.id}** \`${module.path}\` — ${module.description}${module.requirement_ids.length > 0 ? ` (требования: ${module.requirement_ids.join(', ')})` : ''}`);
    }
    lines.push('');
  }
  if (plan.architecture_decisions.length > 0) {
    lines.push('## Архитектурные решения');
    lines.push('');
    for (const decision of plan.architecture_decisions) {
      lines.push(`- **${decision.id}** ${decision.title} — ${decision.rationale}${decision.requirement_ids.length > 0 ? ` (требования: ${decision.requirement_ids.join(', ')})` : ''}`);
    }
    lines.push('');
  }
  if (plan.contracts.length > 0) {
    lines.push('## Контракты данных и API');
    lines.push('');
    for (const contract of plan.contracts) {
      lines.push(`- **${contract.id}** (${contract.kind}) — ${contract.description}${contract.requirement_ids.length > 0 ? ` (требования: ${contract.requirement_ids.join(', ')})` : ''}`);
    }
    lines.push('');
  }
  lines.push('## Последовательность изменений');
  lines.push('');
  for (const step of plan.sequence) {
    lines.push(`${step.order}. ${step.description}${step.item_ids.length > 0 ? ` [${step.item_ids.join(', ')}]` : ''}`);
  }
  lines.push('');
  lines.push('## Пункты плана');
  lines.push('');
  lines.push('| ID | Пункт | Требования | Файлы |');
  lines.push('| --- | --- | --- | --- |');
  for (const item of plan.items) {
    lines.push(`| ${item.id} | ${item.title} | ${item.requirement_ids.join(', ') || '—'} | ${item.files.join(', ') || '—'} |`);
  }
  lines.push('');
  lines.push('## Риски и rollback-стратегия');
  lines.push('');
  lines.push(plan.risks_and_rollback || 'Не заданы.');
  lines.push('');
  lines.push('## Критерии готовности');
  lines.push('');
  for (const criterion of plan.readiness_criteria) {
    lines.push(`- [ ] ${criterion}`);
  }
  lines.push('');
  return lines.join('\n');
}
