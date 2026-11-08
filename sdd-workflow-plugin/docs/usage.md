# Использование sdd-workflow-plugin

Подробный справочник команд, форматов артефактов и типовых сценариев.
Краткая версия — в [README.md](../README.md).

## Запуск

```bash
# однократная привязка пакета к профилю (штатный механизм DSH)
dsh plugin --profile web add ./sdd-workflow-plugin

# запуск с overlay-патчем
pnpm dsh web --patch ./sdd-workflow-plugin/cordis.yml
```

Для проверки композиции без монтирования: `pnpm dsh web --patch ./sdd-workflow-plugin/cordis.yml --dump-config`.
Выбрать свободный порт: `--port 0`; без открытия браузера: `--no-open`.

## Цикл SDD

```
init → spec (интервью, поля, валидация) → approve → plan → tasks
     → implement (queue/record с evidence) → validate → status/export
```

Стадии цикла (`/sdd-status → stage`):
`not_initialized → spec_blocked → spec_ready → plan_missing → tasks_missing →
implementing → blocked_by_validation → validation_required → complete`.

### 1. `/sdd-init` — рабочее пространство и интервью

```text
/sdd-init
/sdd-init {"answers":{"id":"FEAT-001","title":"Экспорт отчётов","owner":"anna","goal":"…","scope":"…"}}
/sdd-init {"confirm_overwrite":true}   -- переинициализировать черновик
```

Создаёт `.sdd/` (spec, plan, tasks, traceability, validation-report, history) и
возвращает вопросник: цель, пользователи, сценарии, ограничения, интеграции,
нефункциональные требования, критерии приёмки. Незаполненные критические поля
помечаются `TBD` и порождают блокирующие открытые вопросы — до их закрытия
план не генерируется. Ответы на отдельные вопросы: `/sdd-spec answer {"question_id":"Q-goal","answer":"…"}`.

### 2. `/sdd-spec` — спецификация

Операции:

```text
/sdd-spec get
/sdd-spec set {"patch":{ … поля … }}          -- заменить перечисленные поля
/sdd-spec validate                            -- отчёт по severity
/sdd-spec answer {"question_id":"Q-…","answer":"…"}
```

Поля спецификации: `id, title, version, status, owner, goal, scope,
out_of_scope, user_stories, functional_requirements,
non_functional_requirements, acceptance_criteria, data_contracts,
api_contracts, edge_cases, constraints, risks, definition_of_done,
open_questions`.

Валидатор находит: критические поля без значений, дубликаты ID, требования без
acceptance criteria, критерии без проверяемого результата, битые ссылки,
конфликты requirements ↔ constraints ↔ edge cases, незакрытые вопросы,
неоднозначные формулировки, пересечение scope/out_of_scope. Каждая находка:
`severity (blocker|major|minor|info)`, поле, сообщение, минимальный fix.

`status: "approved"` обязателен для генерации плана (или `allow_draft: true`).

### 3. `/sdd-plan` — технический план

```text
/sdd-plan generate {"plan":{
  "codebase_analysis":"TypeScript ESM; node:test; ESLint; артефакты в .sdd/",
  "modules":[{"path":"src/commands","description":"…","requirement_ids":["FR-001"]}],
  "architecture_decisions":[{"title":"…","rationale":"…","requirement_ids":["FR-001"]}],
  "extra_items":[{"title":"Миграция хранилища","files":["src/storage.js"]}],
  "risks_and_rollback":"…"
}}
```

План включает анализ кодовой базы, модули, архитектурные решения, контракты,
последовательность, риски и rollback, критерии готовности. Каждый пункт `P-NNN`
ссылается на requirement ID. При blocker-находках валидатора план не создаётся.
Перегенерация — только с `confirm_overwrite: true`.

### 4. `/sdd-tasks` — задачи

```text
/sdd-tasks generate                     -- план → задачи T-NNN
/sdd-tasks list
/sdd-tasks ready                        -- готовые к выполнению (топологически)
/sdd-tasks update {"task_id":"T-001","status":"in_progress"}
/sdd-tasks update {"task_id":"T-001","status":"done","evidence":{"kind":"test","reference":"tests/unit/x.test.js","passed":true,"detail":"5 passed"}}
```

Поля задачи: `task_id, title, description, requirement_ids, plan_item_ids,
files_to_change, tests_to_add_or_update, acceptance_criteria,
status (todo|in_progress|blocked|review|done), evidence, dependencies`.
`done` без пройденного evidence запрещён; завершение блокируется незавершёнными
зависимостями и циклами.

### 5. `/sdd-implement` — реализация с evidence

```text
/sdd-implement queue                          -- очередь готовых задач + правила
/sdd-implement queue {"task_ids":["T-001","T-002"]}
/sdd-implement record {"task_id":"T-001","evidence":{"kind":"test","reference":"tests/unit/status.test.js","passed":true,"detail":"…"},"status":"done","tests_to_add_or_update":["tests/unit/status.test.js"]}
```

`queue` требует от исполнителя: проанализировать код, не ломать существующие
тесты, следовать стилю проекта, добавить тесты, вернуть evidence. `record`
записывает результат в `validation-report.json`, пересчитывает
`traceability.json` и меняет статус только при успешном результате
(неудачный evidence переводит задачу в `blocked`).

### 6. `/sdd-validate` — полная проверка

```text
/sdd-validate
```

Проверяет: сборку, type-check, lint, unit-тесты (команды берутся из скриптов
`package.json` рабочего пространства; запуск — через службу `subprocess`),
регрессии (состояние unit-тестов), покрытие каждого acceptance criteria,
контракты API/данных и edge cases (через задачи и evidence). Отчёт —
`validation-report.json`; для каждой непройденной проверки указываются
requirement ID, критерий, способ проверки, фактический результат, причина и
минимальный fix. `feature_complete: true` — только при отсутствии
`failed`/`blocked` blocker-проверок.

Статусы проверок: `passed | failed | blocked | skipped | not_applicable`.

### 7. `/sdd-status` — состояние цикла

Стадия, версия/статус спецификации, счётчики требований и критериев, план,
задачи по статусам, готовые задачи, покрытие трассируемости, непокрытые
критерии, последняя валидация, блокеры, рекомендуемое следующее действие,
число снимков истории.

### 8. `/sdd-export` — экспорт

Пишет `.sdd/export/<метка>/`: `spec.md|json`, `plan.md|json`, `tasks.json`,
`traceability.md|json`, `validation-report.md|json`, `changelog.md` — и
возвращает список файлов со сводкой.

## Форматы JSON

Полные JSON Schema — в `schema/` пакета (`dist/schemas/` после сборки):
`spec.schema.json`, `plan.schema.json`, `tasks.schema.json`,
`validation-report.schema.json`. Ключевые соглашения:

- Идентификаторы сквозные и уникальные: `FR-NNN`/`NFR-NNN` (требования),
  `AC-NNN` (критерии), `US-NNN` (истории), `EC-NNN` (edge cases),
  `P-NNN` (пункты плана), `T-NNN` (задачи), `V-NNN` (проверки), `Q-*` (вопросы).
- `evidence`: `{kind: test|build|lint|typecheck|integration|manual, reference, passed, recorded_at, detail?}`.
- `traceability.json`: строка на критерий —
  `{requirement_id, criterion_id, plan_item_ids, task_ids, test_refs, validation_status, status: covered|partial|uncovered}`.

## Изменение требований

1. `/sdd-spec set {"patch":{…}}` — изменения фиксируются, снимок предыдущей
   версии уходит в `.sdd/history/`.
2. `/sdd-spec validate` — убедитесь, что blockers нет.
3. `/sdd-plan generate {"confirm_overwrite":true,…}` и
   `/sdd-tasks generate {"confirm_overwrite":true,…}` — перегенерация затронутых
   артефактов (статусы и evidence сбрасываются — это осознанное подтверждение).
4. `/sdd-validate` — повторная проверка соответствия.
