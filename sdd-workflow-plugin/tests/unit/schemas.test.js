/**
 * Unit-тесты упаковки: JSON-схемы собираются в dist/schemas, являются
 * корректным JSON и описывают обязательные поля артефактов SDD.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemasDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'schemas');

const EXPECTED = {
  'spec.schema.json': ['schemaVersion', 'id', 'title', 'goal', 'scope', 'user_stories', 'functional_requirements', 'acceptance_criteria', 'definition_of_done'],
  'plan.schema.json': ['schemaVersion', 'spec_id', 'codebase_analysis', 'items', 'risks_and_rollback'],
  'tasks.schema.json': ['schemaVersion', 'spec_id', 'tasks', 'evidence', 'status'],
  'validation-report.schema.json': ['schemaVersion', 'spec_id', 'overall', 'feature_complete', 'checks', 'summary'],
};

for (const [file, requiredProperties] of Object.entries(EXPECTED)) {
  test(`схема ${file} собирается в dist и описывает контракт`, () => {
    const raw = fs.readFileSync(path.join(schemasDir, file), 'utf8');
    const schema = JSON.parse(raw);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    const collect = (node, acc = new Set()) => {
      if (Array.isArray(node)) node.forEach((item) => collect(item, acc));
      else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'properties' && value && typeof value === 'object') Object.keys(value).forEach((name) => acc.add(name));
          collect(value, acc);
        }
      }
      return acc;
    };
    const properties = collect(schema);
    for (const property of requiredProperties) {
      assert.ok(properties.has(property), `${file}: нет описания свойства ${property}`);
    }
  });
}
