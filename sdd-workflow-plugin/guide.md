# Guide: настройка и использование sdd-workflow-plugin

Пошаговое руководство по установке, настройке и повседневной работе с плагином
Spec-Driven Development (SDD) для DeepSeek Harness. Краткая справка — в
[README.md](README.md), полный справочник команд — в [docs/usage.md](docs/usage.md).

---

## Содержание

1. [Что даёт плагин](#1-что-даёт-плагин)
2. [Требования](#2-требования)
3. [Установка](#3-установка)
4. [Запуск и проверка](#4-запуск-и-проверка)
5. [Быстрый старт: первая фича за 10 команд](#5-быстрый-старт-первая-фича-за-10-команд)
6. [Настройка](#6-настройка)
7. [Повседневная работа: шпаргалка команд](#7-повседневная-работа-шпаргалка-команд)
8. [Работа с evidence (правила завершения задач)](#8-работа-с-evidence)
9. [Изменение требований](#9-изменение-требований)
10. [Панель Web UI](#10-панель-web-ui)
11. [Чтение артефактов .sdd/](#11-чтение-артефактов-sdd)
12. [CI и внешний контроль качества](#12-ci-и-внешний-контроль-качества)
13. [Диагностика проблем](#13-диагностика-проблем)
14. [Часто задаваемые вопросы](#14-часто-задаваемые-вопросы)

---

## 1. Что даёт плагин

Плагин внедряет дисциплину Spec-Driven Development: ни одна строка кода не
пишется, пока не существует проверяемая спецификация, и ни одна задача не
считается выполненной, пока нет объективного доказательства (тесты, сборка,
линтер, type-check или описанная ручная проверка).

В рабочем каталоге проекта появляется папка `.sdd/` — единый источник истины:

```
.sdd/
├── spec.json / spec.md          # спецификация фичи (первичный артефакт)
├── plan.json / plan.md          # технический план, трассируемый к требованиям
├── tasks.json                   # задачи с evidence и зависимостями
├── traceability.json            # матрица: требование → критерий → план → задача → тест
├── validation-report.json       # результаты полной проверки
├── changelog.md                 # история изменений SDD
├── history/                     # снимки версий спецификации
└── export/<метка>/              # экспортные пакеты (Markdown + JSON)
```

Ключевые гарантии:

- **Блокировка этапов**: план не генерируется при blocker-находках в
  спецификации; задача не станет `done` без evidence; фича не объявляется
  завершённой при `failed`/`blocked` blocker-проверках.
- **Идемпотентность**: повторный запуск команд не создаёт дубликатов и не
  затирает артефакты без явного подтверждения (`confirm_overwrite: true`).
- **Атомарность**: каждая запись — временный файл + rename.
- **Относительные пути**: всё работает внутри рабочего каталога сессии.
- **Никаких догадок**: при неоднозначности плагин возвращает конкретные
  вопросы, а не выдумывает требования.

## 2. Требования

| Компонент | Версия |
|---|---|
| DeepSeek Harness (DSH) | ≥ 0.2.0 (проверено на 0.2.2-rc.1) |
| Node.js | ≥ 22 (для сборки плагина) |
| pnpm | любой актуальный (10/11) |
| Профиль DSH | любой; для автопроверок нужна служба `subprocess` (`dsh-subprocess-local`) |

Плагин не требует сети, не собирает телеметрию и не хранит секреты.

## 3. Установка

### Вариант A — через Plugin Manager (рекомендуется для постоянного использования)

1. Откройте Web UI: **Настройки → Плагины → Добавить плагин → Локальный каталог**.
2. Укажите путь к каталогу `sdd-workflow-plugin`.
3. Перезапустите DSH, если профиль применяется только при старте.

Или через инструмент агента в сессии:

```
plugin_manager install_bundle target=<абсолютный путь к каталогу sdd-workflow-plugin>
```

### Вариант B — CLI (для разработки)

```bash
# из каталога, где лежит sdd-workflow-plugin/
dsh plugin --profile web add ./sdd-workflow-plugin
```

Эта команда связывает пакет с профилем (symlink в `node_modules` профиля) —
это штатный механизм разрешения `@local/*`-пакетов DSH. Она нужна **один раз**
на профиль; правки кода после неё подхватываются перезапуском хоста.

### Вариант C — без установки, overlay `--patch`

Патч-файл `cordis.yml` можно подключить и без Variant B, но DSH резолвит имя
`@local/sdd-workflow-plugin` из `node_modules` профиля, поэтому один раз
выполнить привязку (Вариант A или B) всё равно нужно. После этого запуск:

```bash
pnpm dsh web --patch ./sdd-workflow-plugin/cordis.yml
```

> **Примечание про `pnpm dsh`.** Команда работает, если бинарник `dsh`
> доступен в окружении (глобальная установка или `PATH`). При десктоп-установке
> DSH CLI поставляется вместе с приложением.

## 4. Запуск и проверка

```bash
# обычный запуск (откроет браузер)
pnpm dsh web --patch ./sdd-workflow-plugin/cordis.yml

# на свободном порту и без открытия браузера
pnpm dsh web --patch ./sdd-workflow-plugin/cordis.yml --port 0 --no-open

# проверить композицию конфигурации без монтирования
pnpm dsh web --patch ./sdd-workflow-plugin/cordis.yml --dump-config
```

В выводе `--dump-config` найдите блок:

```yaml
# == /…/sdd-workflow-plugin/cordis.yml
- id: sdd-workflow
  name: '@local/sdd-workflow-plugin'
  config: {}
```

Признаки успешного запуска: адрес `dsh web: http://127.0.0.1:<порт>/…` без
предупреждений `entry did not activate`; в левой навигации Web UI появился
элемент **SDD Workflow**; в палитре slash-команд доступны `/sdd-*`.

Сборка и тесты самого плагина:

```bash
cd sdd-workflow-plugin
pnpm install && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

## 5. Быстрый старт: первая фича за 10 команд

Сценарий: добавляем фичу «Сводка статуса проекта». Выполняйте команды в чате
сессии, чей рабочий каталог — корень вашего проекта.

```text
1) /sdd-init {"answers":{"id":"FEAT-001","title":"Сводка статуса","owner":"anna","goal":"Дать сводку статуса SDD-цикла","scope":"Команда sdd-status и панель"}}
2) /sdd-spec set {"patch":{
     "user_stories":[{"id":"US-001","as_a":"разработчик","i_want":"видеть статус","so_that":"понимать следующий шаг","priority":"must"}],
     "functional_requirements":[{"id":"FR-001","title":"Сводка статуса","description":"sdd-status выводит стадию и следующее действие","priority":"must"}],
     "acceptance_criteria":[{"id":"AC-001","requirement_id":"FR-001","statement":"sdd-status возвращает stage и recommended_next_action","verification":"test"}],
     "edge_cases":[{"id":"EC-001","description":"workspace не инициализирован","expected_behavior":"stage=not_initialized и подсказка","requirement_ids":["FR-001"]}],
     "constraints":[{"id":"C-001","description":"Только локальные файлы, без сети"}],
     "definition_of_done":["Критерии покрыты тестами","Валидация overall=passed"]}}
3) /sdd-spec validate                        ← blockers должно быть 0
4) /sdd-spec set {"patch":{"status":"approved"}}
5) /sdd-plan generate {"plan":{"codebase_analysis":"TypeScript ESM; node:test; артефакты в .sdd/"}}
6) /sdd-tasks generate
7) /sdd-implement queue                      ← выдать задачи исполнителю-агенту
8) /sdd-implement record {"task_id":"T-001","tests_to_add_or_update":["tests/unit/status.test.js"],"evidence":{"kind":"test","reference":"tests/unit/status.test.js","passed":true},"status":"done"}
9) /sdd-validate                             ← overall=passed → фича завершена
10) /sdd-status && /sdd-export
```

Полезно знать на старте:

- На шаге 1 плагин вернёт **вопросник интервью** (16 вопросов: цель, пользователи,
  сценарии, ограничения, интеграции, НФТ, критерии приёмки…). Отвечайте
  частями через `/sdd-spec set` или точечно через
  `/sdd-spec answer {"question_id":"Q-goal","answer":"…"}`.
- Если ответов не хватило, критические поля останутся `TBD` с блокирующими
  вопросами — `/sdd-plan` откажется работать, пока они не закрыты. Это по
  замыслу, а не ошибка.

## 6. Настройка

### Конфигурация плагина

Плагин работает без обязательной конфигурации (строка `config: {}` в
`cordis.yml`). Все данные плагин хранит в `<workspace>/.sdd/` проекта, а не в
профиле, поэтому «настройка» — это в первую очередь содержимое спецификации.

### Что настраивается в проекте

Автопроверки `/sdd-validate` берут команды из скриптов `package.json`
рабочего пространства:

```jsonc
// package.json проекта
{
  "scripts": {
    "build": "…",        // проверка kind=build (опциональна)
    "typecheck": "…",    // или type-check / check-types / tsc
    "lint": "…",
    "test": "…"          // проверка kind=unit; также источник проверки регрессий
  }
}
```

- Скрипта нет → проверка получает `not_applicable` (не провал).
- Служба `subprocess` недоступна в профиле → проверки получают `blocked`
  с инструкцией запустить вручную (успех не имитируется).
- Запуск — через `pnpm run <script>` (при отсутствии pnpm — `npm run`).

### Локализация интерфейса

Панель использует язык сессии (словари `locale/ru.json`, `locale/en.json`).
Файлы можно расширять — добавляйте ключи по образцу существующих.

## 7. Повседневная работа: шпаргалка команд

| Ситуация | Команда |
|---|---|
| Начать фичу | `/sdd-init {"answers":{…}}` |
| Ответить на вопрос интервью | `/sdd-spec answer {"question_id":"Q-goal","answer":"…"}` |
| Обновить поля спецификации | `/sdd-spec set {"patch":{…}}` |
| Проверить спецификацию | `/sdd-spec validate` |
| Утвердить спецификацию | `/sdd-spec set {"patch":{"status":"approved"}}` |
| Сгенерировать план | `/sdd-plan generate {"plan":{"codebase_analysis":"…"}}` |
| Перегенерировать план | `/sdd-plan generate {"confirm_overwrite":true,"plan":{…}}` |
| Создать задачи | `/sdd-tasks generate` |
| Кто готов к выполнению | `/sdd-tasks ready` |
| Взять задачу в работу | `/sdd-tasks update {"task_id":"T-001","status":"in_progress"}` |
| Завершить задачу | `/sdd-tasks update {"task_id":"T-001","status":"done","evidence":{…}}` |
| Очередь для агента | `/sdd-implement queue` |
| Записать результат | `/sdd-implement record {"task_id":"T-001","evidence":{…}}` |
| Полная проверка | `/sdd-validate` |
| Состояние цикла | `/sdd-status` |
| Экспорт пакета | `/sdd-export` |

Каждая команда доступна и в зонтичной форме: `/sdd init`, `/sdd spec set …`,
`/sdd implement queue` и т. д. Полный JSON-ответ каждой команды содержит
`next_step` — подсказку, что делать дальше.

## 8. Работа с evidence

`evidence` — объективное доказательство выполнения задачи:

```json
{
  "kind": "test | build | lint | typecheck | integration | manual",
  "reference": "tests/unit/status.test.js  |  pnpm build  |  описание ручной проверки",
  "passed": true,
  "detail": "5 passed (необязательно: вывод команды, ссылка на лог)"
}
```

Правила, которые плагин enforced'ит:

1. `status: "done"` без хотя бы одного `passed: true` — запрещён
   (ошибка `SDD_EVIDENCE_REQUIRED` с подсказкой).
2. Задача не завершится, пока не завершены её зависимости
   (`dependencies`) — защита от «done поверх незакрытой базы».
3. `/sdd-implement record` с неудачным evidence (`passed: false`) переводит
   задачу в `blocked` и пишет провал в `validation-report.json`.
4. Покрытие каждого acceptance criteria считается в `traceability.json`:
   `covered` требует и задачу, и пройденный evidence.

Рекомендация: записывайте evidence сразу после запуска проверок —
`/sdd-implement record` одновременно обновляет `validation-report.json` и
`traceability.json`.

## 9. Изменение требований

Спецификация — живой документ. Цикл изменения:

```text
1) /sdd-spec set {"patch":{"functional_requirements":[…],"acceptance_criteria":[…]}}
   ← предыдущая версия автоматически уходит в .sdd/history/
2) /sdd-spec validate                      ← убедиться, что blockers нет
3) /sdd-plan generate {"confirm_overwrite":true,"plan":{…}}
4) /sdd-tasks generate {"confirm_overwrite":true}
5) /sdd-validate
```

`confirm_overwrite: true` — осознанное подтверждение: перегенерация сбрасывает
статусы и evidence задач, поскольку требования изменились. Историю можно
просмотреть: `/sdd-status` показывает число снимков, файлы — в `.sdd/history/`.

## 10. Панель Web UI

Элемент **SDD Workflow** в левой навигации показывает на одном экране:

- стадию цикла и рекомендуемое следующее действие;
- сводку спецификации (требования, критерии, открытые вопросы) и находки
  валидации с бейджами severity;
- план, задачи по статусам (`todo/in_progress/blocked/review/done`);
- покрытие трассируемости и непокрытые критерии;
- последнюю валидацию и текущие блокеры.

Кнопки: **Обновить**, **Запустить валидацию** (`/sdd-validate`), **Экспортировать
пакет** (`/sdd-export`). Панель читает данные через сессионные команды хоста —
никаких прямых обращений к файлам из браузера.

## 11. Чтение артефактов .sdd/

| Файл | Что смотреть |
|---|---|
| `spec.json` | `open_questions` (что не закрыто), `acceptance_criteria` (что проверяем) |
| `spec.md` | человекочитаемый вид спецификации для ревью |
| `plan.md` | таблица пунктов `P-NNN` со ссылками на требования |
| `tasks.json` | `evidence[]` каждой задачи; статусы; зависимости |
| `traceability.json` | `summary.coverage_ratio`, строки со `status: uncovered` |
| `validation-report.json` | `checks[].minimal_fix` для каждого провала |
| `history/` | снимки `specJson-<метка>.json` до каждого изменения |

## 12. CI и внешний контроль качества

JSON-артефакты спроектированы для машинной проверки:

- JSON Schema: `sdd-workflow-plugin/schema/*.json` (после сборки — `dist/schemas/`).
- `validation-report.json`: `feature_complete === true` — готовый гейт для пайплайна.
- `traceability.json`: `summary.uncovered === 0` — критерий полноты покрытия.

Пример мини-гейта в CI:

```bash
node -e "const r=require('./.sdd/validation-report.json');process.exit(r.feature_complete?0:1)" \
  || { echo 'SDD: фича не прошла валидацию'; exit 1; }
```

## 13. Диагностика проблем

| Сообщение / симптом | Причина | Решение |
|---|---|---|
| `Cannot find package '@local/sdd-workflow-plugin'` при `--patch` | пакет не связан с профилем | `dsh plugin --profile web add ./sdd-workflow-plugin` (один раз) |
| `cannot get property "subprocess" without inject` | старая копия плагина или профиль без `dsh-subprocess-local` | обновите сборку (`pnpm build`), перезапустите; либо смонтируйте службу |
| `SDD_NOT_INITIALIZED` | нет `.sdd/spec.json` в рабочем каталоге | `/sdd-init`; проверьте, что сессия открыта в корне проекта |
| `SDD_BLOCKERS_PRESENT` при `/sdd-plan` | blocker-находки валидатора или спецификация не `approved` | `/sdd-spec validate` → исправить поля по подсказкам; `/sdd-spec set {"patch":{"status":"approved"}}` |
| `SDD_EVIDENCE_REQUIRED` | попытка `done` без evidence | передайте `evidence: {kind, reference, passed: true}` |
| `SDD_OVERWRITE_DECLINED` | артефакт уже существует | добавьте `confirm_overwrite: true`, если перезапуск нужен осознанно |
| Проверки `blocked: subprocess недоступна` | профиль не монтирует `dsh-subprocess-local` | смонтируйте службу или запускайте проверки вручную и записывайте evidence |
| Панель не появилась | клиентский модуль не перезагрузился | перезагрузите страницу; правки `dist/` требуют перезапуска хоста |
| `/sdd-validate` ругается на `package.json` | нет скриптов или файл повреждён | добавьте скрипты `test/lint/build/typecheck` |

Логи хоста: `~/.dsh/logs/startup-*.log` (детали ошибок активации).

## 14. Часто задаваемые вопросы

**Почему `/sdd:init` не работает, а `/sdd-init` работает?**
Реестр команд DSH допускает в именах только буквы, цифры, `_` и `-`. Плагин
регистрирует `sdd-*` и зонтичную `sdd` (`/sdd init`) как эквивалент.

**Плагин сам пишет код?**
Нет. `/sdd-implement queue` выдаёт исполнителю (агенту) упорядоченную очередь
задач с правилами (анализ кода, стиль проекта, тесты не ломаются), а
`/sdd-implement record` принимает обратно объективное evidence. Так связь
«требование → задача → тест → код» остаётся честной.

**Можно ли вести несколько фич в одном проекте?**
В текущей версии `.sdd/` — одна спецификация на рабочее пространство. Для
параллельных фич используйте разные ветки/worktree; экспорт (`/sdd-export`)
удобен для архивации завершённой фичи перед стартом следующей.

**Что если тестов в проекте нет?**
Скрипт `test` отсутствует → проверка `not_applicable`, но критерии приёмки с
`verification: test` останутся `failed`/`skipped`, пока задачи не принесут
evidence — добавить тесты можно в `tests_to_add_or_update` задачи.

**Где хранятся данные плагина?**
Только в `<workspace>/.sdd/` проекта. В профиле DSH — лишь symlink пакета;
никаких секретов и абсолютных путей внутри артефактов.
