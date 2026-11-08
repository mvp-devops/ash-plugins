# ash-plugins

Набор локальных плагинов для [DeepSeek Harness](https://github.com/mvp-devops/ash-plugins). Плагины подключаются как bundles DSH и работают локально, без облачных сервисов и телеметрии.

## Плагины

### `agent-studio`

Студия сабагентов с готовыми ролями и granular tool policy.

Возможности:

- панель Agent Studio в Web UI;
- семь встроенных ролей (Backend Developer, Frontend Developer, QA Engineer, Code Reviewer, DevOps Engineer, Architect, Business Analyst);
- создание, редактирование, дублирование, поиск и экспорт шаблонов;
- уровни конфигурации built-in → global → project → run-time;
- политики инструментов `allow` / `deny` / `ask` / `inherit` и безопасное ограничение инструментов child-агента;
- запуск сабагентов через панель, контекстное меню, команду `/agent-studio` и tool `agent_studio_run_subagent`.

Документация: [`agent-studio/README.md`](agent-studio/README.md).

### `doc-templates-panel`

Панель шаблонов проектной документации.

Возможности:

- глобальные и проектные шаблоны;
- восемь встроенных шаблонов: требования, спецификация, архитектура, дизайн-документ, тест-кейс, протокол тестирования и чек-лист приёмки;
- CRUD, поиск, фильтры, пользовательские типы и Markdown-редактор;
- генерация документов из `{{placeholder}}` и сохранение в `<workspace>/docs/`;
- импорт/экспорт JSON, резервные копии и восстановление;
- команды `/doc-templates` и agent tools `doc_templates_*`.

Документация: [`doc-templates-panel/README.md`](doc-templates-panel/README.md).

### `sdd-workflow-plugin`

Полный Spec-Driven Development workflow.

Возможности:

- машиночитаемая спецификация в `.sdd/spec.json`;
- технический план, атомарные задачи и матрица трассируемости;
- evidence-gated переходы задач и проверка соответствия реализации;
- validation report и экспорт пакета Markdown + JSON;
- панель SDD Workflow в Web UI;
- команды `/sdd-init`, `/sdd-spec`, `/sdd-plan`, `/sdd-tasks`, `/sdd-implement`, `/sdd-validate`, `/sdd-status`, `/sdd-export` и зеркальные agent tools.

Документация: [`sdd-workflow-plugin/README.md`](sdd-workflow-plugin/README.md).

## Требования

- DeepSeek Harness с поддержкой локальных bundles и `--patch`;
- Node.js 22+ для `doc-templates-panel` и `sdd-workflow-plugin`;
- для SDD-сборки — pnpm, TypeScript и зависимости из его `package.json`.

## Установка

### Через Plugin Manager (рекомендуется)

В Web UI откройте **Настройки → Плагины → Добавить плагин → Локальный каталог** и выберите каталог нужного плагина. То же можно выполнить инструментом `plugin_manager`:

```text
plugin_manager install_bundle target=<абсолютный путь>/agent-studio
plugin_manager install_bundle target=<абсолютный путь>/doc-templates-panel
plugin_manager install_bundle target=<абсолютный путь>/sdd-workflow-plugin
```

Перезапустите DSH, если профиль загружает плагины только при старте.

### Через CLI / overlay

```bash
# Agent Studio и шаблоны документации
dsh plugin --profile <имя-профиля> add ./agent-studio
dsh plugin --profile <имя-профиля> add ./doc-templates-panel

# SDD
dsh plugin --profile web add ./sdd-workflow-plugin
pnpm dsh web --patch ./sdd-workflow-plugin/cordis.yml
```

Для разработки можно запускать плагин с соответствующим patch-файлом. Подробные команды, ограничения, хранение данных и troubleshooting приведены в README каждого плагина.

## Проверка

```bash
(cd agent-studio && node --test tests/)
(cd doc-templates-panel && npm test)
(cd sdd-workflow-plugin && pnpm install && pnpm test)
```

## Структура репозитория

```text
ash-plugins/
├── agent-studio/
├── doc-templates-panel/
├── sdd-workflow-plugin/
├── .gitignore
└── README.md
```

## Лицензия

Плагины распространяются согласно лицензиям, указанным в их каталогах. Для `doc-templates-panel` и `sdd-workflow-plugin` используется MIT.
