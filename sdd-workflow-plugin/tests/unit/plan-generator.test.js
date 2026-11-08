/**
 * Unit-тесты генератора плана: пункты из требований, edge cases, ID P-NNN,
 * трассировка requirement_ids, обязательный анализ кодовой базы,
 * парсинг сохранённого плана, Markdown-рендер.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSpec } from '../../dist/core/spec-model.js';
import { generatePlan, parsePlan, renderPlanMarkdown, resetItemCounter, PLAN_SCHEMA_VERSION } from '../../dist/core/plan-generator.js';
import { ArtifactValidationError } from '../../dist/core/errors.js';

const NOW = '2026-01-01T00:00:00.000Z';

function buildSpec() {
  return parseSpec(
    {
      schemaVersion: 1,
      id: 'FEAT-001',
      title: 'Фича',
      version: '1.2.0',
      status: 'approved',
      owner: 'team',
      goal: 'Цель',
      scope: 'Объём',
      out_of_scope: [],
      user_stories: [],
      functional_requirements: [
        { id: 'FR-001', title: 'Первое', description: 'Описание первого', priority: 'must' },
        { id: 'FR-002', title: 'Второе', description: 'Описание второго', priority: 'should' },
      ],
      non_functional_requirements: [{ id: 'NFR-001', title: 'Производительность', description: 'Ответ < 100 мс', priority: 'must' }],
      acceptance_criteria: [{ id: 'AC-001', requirement_id: 'FR-001', statement: 'Условие', verification: 'test' }],
      data_contracts: [{ id: 'DC-001', name: 'Хранилище', description: 'JSON-файл', requirement_ids: ['FR-001'] }],
      api_contracts: [],
      edge_cases: [{ id: 'EC-001', description: 'Пустой ввод', expected_behavior: 'Ошибка валидации', requirement_ids: ['FR-001'] }],
      constraints: [],
      risks: [{ id: 'R-001', description: 'Регрессия', mitigation: 'Полный прогон тестов' }],
      definition_of_done: ['Тесты зелёные'],
      open_questions: [],
      updated_at: NOW,
    },
    '.sdd/spec.json',
  );
}

test('generatePlan строит пункт на каждое требование + edge cases, с ID и трассировкой', () => {
  resetItemCounter(0);
  const spec = buildSpec();
  const plan = generatePlan(spec, { codebase_analysis: 'TypeScript, node:test, ESLint.', now: NOW });
  assert.equal(plan.schemaVersion, PLAN_SCHEMA_VERSION);
  assert.equal(plan.spec_id, 'FEAT-001');
  assert.equal(plan.spec_version, '1.2.0');
  // FR-001, FR-002, NFR-001, EC-объединённый пункт
  assert.equal(plan.items.length, 4);
  assert.deepEqual(plan.items.map((item) => item.id), ['P-001', 'P-002', 'P-003', 'P-004']);
  assert.deepEqual(plan.items[0].requirement_ids, ['FR-001']);
  assert.deepEqual(plan.items[2].requirement_ids, ['NFR-001']);
  assert.ok(plan.items[3].title.includes('EC-001'));
  assert.deepEqual(plan.items[3].requirement_ids, ['FR-001']);
  assert.equal(plan.sequence.length, plan.items.length);
  assert.deepEqual(plan.readiness_criteria, ['Тесты зелёные']);
  assert.match(plan.risks_and_rollback, /R-001/);
  assert.deepEqual(plan.contracts.map((contract) => contract.id), ['DC-001']);
});

test('generatePlan без анализа кодовой базы — ошибка с полем', () => {
  assert.throws(() => generatePlan(buildSpec(), { codebase_analysis: '   ', now: NOW }), (error) => {
    assert.ok(error instanceof ArtifactValidationError);
    assert.equal(error.field, 'codebase_analysis');
    return true;
  });
});

test('extra_items, modules и architecture_decisions получают стабильные ID', () => {
  resetItemCounter(0);
  const plan = generatePlan(buildSpec(), {
    codebase_analysis: 'Анализ',
    now: NOW,
    extra_items: [{ title: 'Миграция хранилища', files: ['src/storage.js'] }],
    modules: [{ path: 'src/core', description: 'Ядро', requirement_ids: ['FR-001'] }],
    architecture_decisions: [{ title: 'Файловое хранилище', rationale: 'Простота', requirement_ids: ['FR-001'] }],
  });
  assert.equal(plan.modules[0].id, 'M-001');
  assert.equal(plan.architecture_decisions[0].id, 'AD-001');
  const extra = plan.items.find((item) => item.title === 'Миграция хранилища');
  assert.ok(extra);
  assert.deepEqual(extra.files, ['src/storage.js']);
});

test('parsePlan восстанавливает план и терпит отсутствие необязательных полей', () => {
  resetItemCounter(0);
  const plan = generatePlan(buildSpec(), { codebase_analysis: 'Анализ', now: NOW });
  const restored = parsePlan(JSON.parse(JSON.stringify(plan)), '.sdd/plan.json');
  assert.deepEqual(restored.items, plan.items);
  const minimal = parsePlan({ schemaVersion: 1, items: [{ id: 'P-001', title: 'x' }] }, '.sdd/plan.json');
  assert.equal(minimal.items.length, 1);
  assert.throws(() => parsePlan({ schemaVersion: 7 }, '.sdd/plan.json'), ArtifactValidationError);
});

test('renderPlanMarkdown содержит все разделы и ссылки на требования', () => {
  resetItemCounter(0);
  const plan = generatePlan(buildSpec(), { codebase_analysis: 'Анализ кодовой базы', now: NOW });
  const markdown = renderPlanMarkdown(plan);
  for (const heading of ['Анализ кодовой базы', 'Последовательность изменений', 'Пункты плана', 'Риски и rollback-стратегия', 'Критерии готовности']) {
    assert.ok(markdown.includes(heading), `нет раздела «${heading}»`);
  }
  assert.ok(markdown.includes('FR-001'));
  assert.ok(markdown.includes('| P-001 |'));
});
