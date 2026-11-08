# sdd-workflow-plugin — Spec-Driven Development для DeepSeek Harness

Плагин DSH, внедряющий **Spec-Driven Development (SDD)** как встроенный рабочий
процесс: машиночитаемая спецификация фичи, технический план, трассируемые
задачи, evidence-gated реализация, полная валидация соответствия и экспорт
пакета. Плюс панель **SDD Workflow** в левой навигации Web UI.

Плагин полностью локальный: без сети, облачных сервисов и телеметрии. Спецификация —
первичный артефакт и источник истины; плагин не «угадывает» требования, а при
неоднозначности возвращает пользователю конкретные вопросы.

---

## Принципы SDD, реализованные в плагине

- Каждая фича начинается с явной, проверяемой спецификации (`.sdd/spec.json`).
- Спецификация содержит цель, user stories, acceptance criteria, ограничения,
  контракты API/данных, edge cases и definition of done.
- План и задачи трассируемы к требованиям:
  `requirement → plan item → task → test → implementation → validation result`
  (матрица в `.sdd/traceability.json`).
- Ни одна задача не считается завершённой без объективного evidence:
  пройденные тесты, build, lint, type-check или явная ручная проверка.
- Изменение требований обновляет спецификацию (`/sdd-spec`), а плагин
  перегенерирует затронутые артефакты (`/sdd-plan`, `/sdd-tasks`) и валидирует
  (`/sdd-validate`).
- Переход к следующему этапу блокируется при критических несоответствиях:
  blocker-находки валидатора запрещают генерацию плана, задачи без evidence
  не могут стать `done`, `failed`/`blocked` blocker-проверки запрещают объявлять
  фичу завершённой.

## Установка и запуск

### Вариант 1. Overlay `--patch` (рекомендуется для разработки)

Однократно свяжите пакет с профилем (это штатный механизм разрешения
`@local/*`-пакетов в DSH: bare specifier резолвится из `node_modules` профиля):

```bash
dsh plugin --profile web add ./sdd-workflow-plugin
```

Затем запускайте с overlay-патчем:

```bash
pnpm dsh web --patch ./sdd-workflow-plugin/cordis.yml
```

Команда `--patch` подключает `cordis.yml` плагина как верхний слой композиции;
правки `client.js` подхватываются перезагрузкой страницы, правки host-части
(`dist/`) — перезапуском (после правок TypeScript выполните `pnpm build`).

> Важно: `pnpm dsh` требует, чтобы бинарник `dsh` был доступен в окружении pnpm
> (например, установлен глобально или через `package.json` проекта). При
> десктоп-установке DSH CLI доступен в комплекте приложения.

### Вариант 2. Plugin Manager / tool `plugin_manager`

Web UI: **Настройки → Плагины → Добавить плагин → Локальный каталог** — укажите
путь к каталогу `sdd-workflow-plugin`. Или через инструмент агента:

```
plugin_manager install_bundle target=<абсолютный путь к каталогу sdd-workflow-plugin>
```

### Сборка и проверки из каталога плагина

```bash
pnpm install        # зависимости для сборки (typescript, eslint)
pnpm typecheck      # tsc --noEmit, strict mode
pnpm lint           # eslint (src, tests, client.js, scripts)
pnpm build          # tsc -> dist/ + копирование JSON-схем
pnpm test           # сборка + node --test (unit + integration)
```

## Команды

DSH допускает в именах slash-команд только буквы, цифры, `_` и `-`
(регекс реестра команд: `/^\/([a-z][a-z0-9_-]*)/`), поэтому точное написание
`/sdd:init` в этой версии Harness невозможно. Плагин регистрирует **обе**
эквивалентные формы: 8 отдельных команд `sdd-*` и зонтичную `sdd`:

| Команда | Зонтичная форма | Назначение |
|---|---|---|
| `/sdd-init` | `/sdd init [json]` | создать `.sdd/`, вернуть вопросник интервью |
| `/sdd-spec` | `/sdd spec <op> [json]` | создать/обновить/проверить спецификацию |
| `/sdd-plan` | `/sdd plan generate [json]` | технический план из утверждённой спецификации |
| `/sdd-tasks` | `/sdd tasks <op> [json]` | план → атомарные задачи; статусы с evidence |
| `/sdd-implement` | `/sdd implement <op> [json]` | очередь задач и запись evidence |
| `/sdd-validate` | `/sdd validate` | полная проверка соответствия, отчёт |
| `/sdd-status` | `/sdd status` | стадия цикла, трассируемость, блокеры |
| `/sdd-export` | `/sdd export` | экспорт пакета в Markdown + JSON |

Операции: `sdd-spec` — `set | patch | validate | get | answer`; `sdd-tasks` —
`generate | update | list | ready`; `sdd-implement` — `queue | record`;
`sdd-plan` — `generate | get`.

## Agent-инструменты

`sdd_init`, `sdd_spec`, `sdd_plan`, `sdd_tasks`, `sdd_implement`,
`sdd_validate`, `sdd_status`, `sdd_export` — зеркала команд с JSON Schema
параметров; агент может вести SDD-цикл инструментами, а пользователь — командами.

## Артефакты `.sdd/`

| Файл | Содержимое |
|---|---|
| `spec.json` / `spec.md` | машиночитаемая/человекочитаемая спецификация |
| `plan.json` / `plan.md` | технический план (пункты `P-NNN` трассируемы к требованиям) |
| `tasks.json` | задачи `T-NNN` с `requirement_ids`, `plan_item_ids`, `evidence` |
| `traceability.json` | матрица `requirement → criterion → plan → task → tests` |
| `validation-report.json` | проверки `V-NNN` со статусами passed/failed/blocked/skipped/not_applicable |
| `history/` | снимки версий спецификации перед изменениями |
| `export/<метка>/` | экспортный пакет: spec, план, задачи, трассируемость, отчёт, changelog |

JSON Schema артефактов: `schema/spec.schema.json`, `schema/plan.schema.json`,
`schema/tasks.schema.json`, `schema/validation-report.schema.json` (в пакете —
`dist/schemas/`).

## Пример end-to-end сценария

```
/sdd-init {"answers":{"id":"FEAT-001","title":"Сводка статуса","owner":"anna","goal":"…","scope":"…"}}
/sdd-spec set {"patch":{"user_stories":[…],"functional_requirements":[…],"acceptance_criteria":[…],"edge_cases":[…],"constraints":[…],"definition_of_done":[…]}}
/sdd-spec validate                     → отчёт по severity; blockers = 0
/sdd-spec set {"patch":{"status":"approved"}}
/sdd-plan generate {"plan":{"codebase_analysis":"TypeScript ESM, node:test…"}}
/sdd-tasks generate
/sdd-implement queue                   → упорядоченная очередь с правилами
… реализация задач агентом …
/sdd-implement record {"task_id":"T-001","evidence":{"kind":"test","reference":"tests/unit/x.test.js","passed":true},"status":"done"}
/sdd-validate                          → overall=passed, feature_complete=true
/sdd-status                            → stage=complete
/sdd-export
```

## Панель Web UI

Элемент **SDD Workflow** в левой навигации показывает: стадию цикла и
рекомендуемое следующее действие, сводку спецификации и находки валидации,
план, задачи по статусам, покрытие трассируемости, последнюю валидацию и
блокеры; кнопки обновления, запуска валидации и экспорта.

## Гарантии качества

- TypeScript strict (`noUncheckedIndexedAccess`), без `any` в публичном API;
  граница с DSH (`ctx`) типизирована структурно и помечена документацией.
- Все записи атомарные: временный файл в том же каталоге, затем rename
  (через `ctx.fs.moveFile` DSH или `fs.rename`).
- Все пути относительные, от корня рабочего пространства сессии.
- Идемпотентность: повторный `/sdd-init` не перезаписывает артефакты без
  явного `confirm_overwrite`; перегенерация плана/требует подтверждения.
- Логирование `debug/info/warn/error` через `ctx.logger`.
- Ошибки несут код, файл, поле и подсказку по исправлению.

## Troubleshooting

| Симптом | Причина и решение |
|---|---|
| `Cannot find package '@local/sdd-workflow-plugin'` при `--patch` | пакет не связан с профилем: выполните `dsh plugin --profile web add ./sdd-workflow-plugin` |
| `cannot get property "subprocess" without inject` (старые версии) | служба subprocess не смонтирована в профиле; плагин объявляет её в `inject` и не активируется без неё |
| `/sdd-plan` отказывает: `SDD_BLOCKERS_PRESENT` | устраните blocker-находки `/sdd-spec validate` (в ответе — поле и минимальный fix) |
| `SDD_EVIDENCE_REQUIRED` при `done` | передайте evidence: `{kind, reference, passed: true}` |
| Проверки валидации `blocked: subprocess недоступна` | профиль не монтирует `dsh-subprocess-local`; запустите проверки вручную |
| Панель не появилась | перезагрузите страницу (client-HMR); изменения `dist/` требуют перезапуска хоста |

## Известные ограничения

- Точное написание `/sdd:init` недоступно из-за грамматики команд DSH
  (см. выше) — используйте `/sdd-init` или `/sdd init`.
- Плагин сам не редактирует код: `/sdd-implement` выдаёт очередь и правила
  исполнителю (агенту) и принимает объективный evidence обратно.
- Автоматические проверки (build/lint/tests) выполняются только когда в
  профиле смонтирована служба `subprocess` (`dsh-subprocess-local`); иначе они
  честно помечаются `blocked`, а не имитируются.
- Эвристики валидатора спецификации (неоднозначности, конфликты) — лексические,
  не семантические; они дополняют, но не заменяют ревью человеком.

## Лицензия

MIT
