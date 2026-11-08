/**
 * Общая фикстура для unit-тестов: согласованные спецификация, план и задачи.
 */

import { parseSpec } from '../../dist/core/spec-model.js';
import { generatePlan, resetItemCounter } from '../../dist/core/plan-generator.js';
import { generateTasks, resetTaskCounter } from '../../dist/core/task-generator.js';

const NOW = '2026-01-01T00:00:00.000Z';

/** Спецификация с двумя требованиями и двумя критериями + план + задачи. */
export function buildSpecAndBoard() {
  const spec = parseSpec(
    {
      schemaVersion: 1,
      id: 'FEAT-001',
      title: 'Фича',
      version: '1.0.0',
      status: 'approved',
      owner: 'team',
      goal: 'Цель',
      scope: 'Объём',
      out_of_scope: [],
      user_stories: [],
      functional_requirements: [
        { id: 'FR-001', title: 'Первое', description: 'Описание 1', priority: 'must' },
        { id: 'FR-002', title: 'Второе', description: 'Описание 2', priority: 'must' },
      ],
      non_functional_requirements: [],
      acceptance_criteria: [
        { id: 'AC-001', requirement_id: 'FR-001', statement: 'Условие 1', verification: 'test' },
        { id: 'AC-002', requirement_id: 'FR-002', statement: 'Условие 2', verification: 'build' },
      ],
      data_contracts: [],
      api_contracts: [],
      edge_cases: [],
      constraints: [],
      risks: [],
      definition_of_done: ['Тесты зелёные'],
      open_questions: [],
      updated_at: NOW,
    },
    '.sdd/spec.json',
  );
  resetItemCounter(0);
  const plan = generatePlan(spec, { codebase_analysis: 'Анализ кодовой базы', now: NOW });
  resetTaskCounter(0);
  const board = generateTasks(spec, plan, NOW);
  return { spec, plan, board };
}
