/**
 * Трассируемость: требование → acceptance criterion → пункт плана → задача →
 * тест/evidence → результат валидации.
 */

import type { Plan } from './plan-generator.js';
import type { Spec } from './spec-model.js';
import type { TaskBoard } from './task-generator.js';
import type { ValidationReport } from './validation.js';

/** Версия схемы traceability.json. */
export const TRACEABILITY_SCHEMA_VERSION = 1;

export type CoverageStatus = 'covered' | 'partial' | 'uncovered';

/** Строка матрицы: один acceptance criterion. */
export interface TraceabilityRow {
  requirement_id: string;
  criterion_id: string;
  criterion: string;
  verification: string;
  plan_item_ids: string[];
  task_ids: string[];
  test_refs: string[];
  validation_status: string | null;
  status: CoverageStatus;
}

export interface TraceabilityMatrix {
  schemaVersion: typeof TRACEABILITY_SCHEMA_VERSION;
  spec_id: string;
  generated_at: string;
  rows: TraceabilityRow[];
  summary: {
    total: number;
    covered: number;
    partial: number;
    uncovered: number;
    /** Доля покрытия критериев задачами и тестами, 0..1. */
    coverage_ratio: number;
  };
}

/**
 * Построить матрицу трассируемости. Критерий считается `covered`, только
 * если у него есть и задача, и пройденное evidence (тест/проверка);
 * `partial` — есть задача, но нет пройденного evidence.
 */
export function buildTraceability(spec: Spec, plan: Plan, board: TaskBoard, report?: ValidationReport, now = new Date().toISOString()): TraceabilityMatrix {
  const criteriaByRequirement = new Map<string, Spec['acceptance_criteria']>();
  for (const criterion of spec.acceptance_criteria) {
    const list = criteriaByRequirement.get(criterion.requirement_id) ?? [];
    list.push(criterion);
    criteriaByRequirement.set(criterion.requirement_id, list);
  }

  const checkStatusByCriterion = new Map<string, string>();
  if (report) {
    for (const check of report.checks) {
      if (check.criterion_id && !checkStatusByCriterion.has(check.criterion_id)) {
        checkStatusByCriterion.set(check.criterion_id, check.status);
      }
    }
  }

  const rows: TraceabilityRow[] = [];
  for (const criterion of spec.acceptance_criteria) {
    const planItemIds = plan.items.filter((item) => item.requirement_ids.includes(criterion.requirement_id)).map((item) => item.id);
    const linkedTasks = board.tasks.filter(
      (task) => task.acceptance_criteria.includes(criterion.id) || (task.requirement_ids.includes(criterion.requirement_id) && criterion.requirement_id !== ''),
    );
    const taskIds = linkedTasks.map((task) => task.task_id);
    const testRefs = [
      ...new Set(
        linkedTasks.flatMap((task) => [...task.tests_to_add_or_update, ...task.evidence.filter((evidence) => evidence.passed).map((evidence) => evidence.reference)]),
      ),
    ];
    const hasPassedEvidence = linkedTasks.some((task) => task.evidence.some((evidence) => evidence.passed));
    let status: CoverageStatus;
    if (taskIds.length > 0 && hasPassedEvidence) status = 'covered';
    else if (taskIds.length > 0 || planItemIds.length > 0) status = 'partial';
    else status = 'uncovered';

    rows.push({
      requirement_id: criterion.requirement_id,
      criterion_id: criterion.id,
      criterion: criterion.statement,
      verification: criterion.verification,
      plan_item_ids: planItemIds,
      task_ids: taskIds,
      test_refs: testRefs,
      validation_status: checkStatusByCriterion.get(criterion.id) ?? null,
      status,
    });
  }

  const covered = rows.filter((row) => row.status === 'covered').length;
  const partial = rows.filter((row) => row.status === 'partial').length;
  const uncovered = rows.filter((row) => row.status === 'uncovered').length;
  return {
    schemaVersion: TRACEABILITY_SCHEMA_VERSION,
    spec_id: spec.id,
    generated_at: now,
    rows,
    summary: {
      total: rows.length,
      covered,
      partial,
      uncovered,
      coverage_ratio: rows.length === 0 ? 0 : (covered + partial * 0.5) / rows.length,
    },
  };
}

/** Структурный разбор сохранённой матрицы (минимально строгий). */
export function parseTraceability(raw: unknown, file = '.sdd/traceability.json'): TraceabilityMatrix {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: traceability.json должен быть JSON-объектом`);
  }
  const record = raw as Record<string, unknown>;
  return {
    schemaVersion: TRACEABILITY_SCHEMA_VERSION,
    spec_id: String(record.spec_id ?? ''),
    generated_at: String(record.generated_at ?? ''),
    rows: Array.isArray(record.rows) ? (record.rows as TraceabilityRow[]) : [],
    summary:
      typeof record.summary === 'object' && record.summary !== null
        ? (record.summary as TraceabilityMatrix['summary'])
        : { total: 0, covered: 0, partial: 0, uncovered: 0, coverage_ratio: 0 },
  };
}
