/**
 * Валидация соответствия реализации спецификации: сборка проверок,
 * отчёт `validation-report.json` и решение о завершённости фичи.
 *
 * Статусы проверок: passed | failed | blocked | skipped | not_applicable.
 * Проверка уровня blocker (failed или blocked) запрещает объявление фичи
 * завершённой.
 */

import type { VerificationMethod } from './spec-model.js';

/** Версия схемы validation-report.json. */
export const REPORT_SCHEMA_VERSION = 1;

export type CheckStatus = 'passed' | 'failed' | 'blocked' | 'skipped' | 'not_applicable';
export type CheckKind = 'build' | 'typecheck' | 'lint' | 'unit' | 'integration' | 'criterion' | 'contract' | 'edge_case' | 'regression' | 'coverage';

/** Одна проверка отчёта. */
export interface ValidationCheck {
  check_id: string;
  kind: CheckKind;
  status: CheckStatus;
  /** Требование спецификации, к которому относится проверка. */
  requirement_id?: string;
  /** Acceptance criterion, к которому относится проверка. */
  criterion_id?: string;
  /** Способ проверки: команда или описание. */
  method: string;
  /** Фактический результат. */
  actual: string;
  /** Предполагаемая причина (для failed/blocked). */
  probable_cause?: string;
  /** Минимальный fix (для failed/blocked). */
  minimal_fix?: string;
  /** Уровень важности: blocker-проверки блокируют завершение фичи. */
  blocking: boolean;
}

export interface ValidationReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  spec_id: string;
  generated_at: string;
  overall: 'passed' | 'failed' | 'blocked';
  feature_complete: boolean;
  checks: ValidationCheck[];
  summary: Record<CheckStatus, number>;
}

/** Ввод проверок: результаты выполнения команд и критериев. */
export interface CheckInput {
  kind: CheckKind;
  status: CheckStatus;
  method: string;
  actual: string;
  requirement_id?: string;
  criterion_id?: string;
  probable_cause?: string;
  minimal_fix?: string;
  blocking?: boolean;
  exit_code?: number;
}

const BLOCKING_KINDS: readonly CheckKind[] = ['build', 'typecheck', 'unit'];

/** Виды проверок, блокирующие по умолчанию. */
export function isBlockingKind(kind: CheckKind, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  return BLOCKING_KINDS.includes(kind);
}

let checkCounter = 0;

/** Собрать отчёт валидации из входов проверок. */
export function buildValidationReport(specId: string, inputs: CheckInput[], now = new Date().toISOString()): ValidationReport {
  const checks: ValidationCheck[] = inputs.map((input) => {
    checkCounter += 1;
    const check: ValidationCheck = {
      check_id: `V-${String(checkCounter).padStart(3, '0')}`,
      kind: input.kind,
      status: input.status,
      method: input.method,
      actual: input.actual,
      blocking: isBlockingKind(input.kind, input.blocking),
    };
    if (input.requirement_id !== undefined) check.requirement_id = input.requirement_id;
    if (input.criterion_id !== undefined) check.criterion_id = input.criterion_id;
    if (input.status === 'failed' || input.status === 'blocked') {
      if (input.probable_cause !== undefined) check.probable_cause = input.probable_cause;
      if (input.minimal_fix !== undefined) check.minimal_fix = input.minimal_fix;
    }
    return check;
  });

  const summary: Record<CheckStatus, number> = { passed: 0, failed: 0, blocked: 0, skipped: 0, not_applicable: 0 };
  for (const check of checks) summary[check.status] += 1;

  const blockingFailures = checks.filter((check) => check.blocking && (check.status === 'failed' || check.status === 'blocked'));
  const overall: ValidationReport['overall'] = blockingFailures.length > 0 ? (checks.some((c) => c.status === 'blocked') ? 'blocked' : 'failed') : 'passed';

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    spec_id: specId,
    generated_at: now,
    overall,
    feature_complete: blockingFailures.length === 0 && summary.not_applicable !== checks.length,
    checks,
    summary,
  };
}

/** Структурный разбор сохранённого отчёта. */
export function parseValidationReport(raw: unknown, file = '.sdd/validation-report.json'): ValidationReport {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: validation-report.json должен быть JSON-объектом`);
  }
  const record = raw as Record<string, unknown>;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    spec_id: String(record.spec_id ?? ''),
    generated_at: String(record.generated_at ?? ''),
    overall: (record.overall === 'failed' || record.overall === 'blocked' ? record.overall : 'passed') as ValidationReport['overall'],
    feature_complete: Boolean(record.feature_complete),
    checks: Array.isArray(record.checks) ? (record.checks as ValidationCheck[]) : [],
    summary:
      typeof record.summary === 'object' && record.summary !== null
        ? (record.summary as Record<CheckStatus, number>)
        : { passed: 0, failed: 0, blocked: 0, skipped: 0, not_applicable: 0 },
  };
}

/**
 * Сопоставить acceptance criteria с проверками: для каждого критерия
 * определяется, покрыт ли он проверкой, и формируется вход проверки
 * `coverage` при отсутствии покрытия.
 */
export function criterionCoverageInputs(
  criteria: { id: string; requirement_id: string; statement: string; verification: VerificationMethod }[],
  tasks: { acceptance_criteria: string[]; evidence: { passed: boolean; kind: VerificationMethod; reference: string }[]; task_id: string }[],
): CheckInput[] {
  const inputs: CheckInput[] = [];
  for (const criterion of criteria) {
    const linked = tasks.filter((task) => task.acceptance_criteria.includes(criterion.id));
    const passedEvidence = linked.flatMap((task) => task.evidence.filter((evidence) => evidence.passed));
    const method = criterion.verification === 'manual' ? 'ручная проверка по описанию критерия' : `автоматическая проверка (${criterion.verification})`;
    if (passedEvidence.length > 0) {
      inputs.push({
        kind: 'criterion',
        status: 'passed',
        requirement_id: criterion.requirement_id,
        criterion_id: criterion.id,
        method,
        actual: `покрыт evidence: ${passedEvidence.map((evidence) => evidence.reference).join('; ')}`,
      });
    } else {
      inputs.push({
        kind: 'criterion',
        status: linked.length > 0 ? 'failed' : 'skipped',
        requirement_id: criterion.requirement_id,
        criterion_id: criterion.id,
        method,
        actual: linked.length > 0 ? 'задачи связаны, но пройденного evidence нет' : 'нет связанных задач с этим критерием',
        probable_cause: linked.length > 0 ? 'задачи не завершены или evidence не записан' : 'критерий не отражён в задачах',
        minimal_fix: linked.length > 0 ? 'завершите задачи с evidence (тест/сборка/проверка)' : 'добавьте критерий в acceptance_criteria соответствующей задачи',
        blocking: criterion.verification !== 'manual',
      });
    }
  }
  return inputs;
}
