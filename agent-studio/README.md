# Agent Studio

DeepSeek Harness plugin (`agent-studio`) для создания, настройки и запуска сабагентов
с заданными ролями, системными инструкциями, skills и granular tool policy.

## Возможности

- Пункт **Agent Studio** в левой навигации Web UI; разделы «Сабагенты», «Skills», «Tools», «Настройки», «Импорт / экспорт».
- 7 встроенных read-only шаблонов ролей: **Backend Developer**, **Frontend Developer**, **QA Engineer**, **Code Reviewer**, **DevOps Engineer**, **Architect**, **Business Analyst**. Любой можно скопировать и изменить.
- CRUD, дублирование, включение/отключение, undo, теги, поиск, фильтры (role / scope / status), сортировка по имени.
- Granular tool policy: пресеты (`read-only`, `code-editing`, `full-developer`, `safe-qa`, `research-only`, `custom`) и индивидуальные правила per tool: `allow` / `deny` / `ask` / `inherit`. Denied tools реально удаляются из набора child-агента через штатный `ctx.tools.restrict()` — не только визуально. `ask` исполняется консервативно как `deny` (у child-агента нет собственного confirmation waterfall).
- Глобальные шаблоны (machine-local storage) и project overrides (`.agent-studio/agent-templates.json` в рабочей директории сессии, cwd-sensitive).
- Порядок merge: **builtin → global user → project override → run-time overrides**. Project- и run-слои не могут ослабить запрет нижнего слоя (конфликт фиксируется и показывается).
- Экспорт/импорт переносимой конфигурации с placeholders `${PROJECT_ROOT}` / `${USER_HOME}`, без секретов и абсолютных путей.
- Запуск сабагента: кнопка **Run** в карточке, tool `agent_studio_run_subagent`, действие **Run subagent** в контекстном меню сессии и на выделенном тексте чата, плюс команда `/agent-studio run …` (command palette через `/`).

## Установка

Установка выполняется через Plugin Manager или tool `plugin_manager`:

```
plugin_manager install_bundle target=<абсолютный путь к каталогу agent-studio>
```

Bundle не требует сборки и внешних зависимостей (чистый ESM + встроенный React браузерного загрузчика).

## Структура файлов

```
agent-studio/
├── package.json            # манифест bundle: dsh.bundle.patch + dsh.client
├── cordis.patch.yml        # Loader patch: строка agent-studio
├── index.js                # Host-часть: storage, merge, policy, tool, /agent-studio command
├── lib.js                  # чистая логика: валидация, merge, policy, export/import (unit-тесты)
├── builtin-templates.js    # 7 встроенных ролей
├── client.js               # Client-часть: панель, лаунчер, контекстное меню, selection gesture
├── locale/en.json, ru.json # meta.title / meta.description для Plugin Manager
├── icon.svg                # иконка
├── schema/agent-templates.schema.json  # JSON Schema переносимого формата
├── tests/                  # node:test
└── README.md
```

## Конфигурация и хранение

| Тип | Где живёт | Переносимость |
|---|---|---|
| Built-in шаблоны | внутри bundle | всегда доступны, read-only |
| Global user templates | `$DSH_PROFILE_DIR/agent-studio/templates.json` (machine-local) | через Export/Import |
| Project overrides | `<workspace>/.agent-studio/agent-templates.json` | переносимы (git) |
| Run-time overrides | параметры вызова | — |

Project-файл читается относительно **текущей рабочей директории сессии** (cwd-sensitive модель Harness), поэтому смена working directory автоматически подхватывает конфигурацию этого проекта. В project-файле храните относительные пути; при необходимости используйте placeholders `${PROJECT_ROOT}` и `${USER_HOME}` — они восстанавливаются при чтении.

### Формат переносимого документа

```json
{
  "format": "agent-studio/templates",
  "schemaVersion": 1,
  "metadata": { "plugin": "agent-studio", "pluginVersion": "1.0.0", "createdAt": "…", "count": 2 },
  "templates": [
    {
      "id": "api-migrator",
      "name": "API Migrator",
      "role": "Backend Developer",
      "description": "…",
      "instructions": "…",
      "skills": ["backend-development", "api-design"],
      "toolPolicy": { "preset": "code-editing", "rules": { "web_search": "ask" } },
      "maxDelegationDepth": 2,
      "tags": ["backend"],
      "scope": "global",
      "enabled": true
    }
  ]
}
```

JSON Schema: `schema/agent-templates.schema.json`. При экспорте секреты (поля, похожие на token/secret/apiKey/…) удаляются, абсолютные пути заменяются на `${PROJECT_ROOT}` / `${USER_HOME}`. При импорте: валидация, предпросмотр diff, стратегии `merge` | `overwrite` | `skip-existing` | `create-copy`; перезапись существующих шаблонов требует явного подтверждения; предупреждение о несовместимой schemaVersion.

## Tool

`agent_studio_run_subagent`:

```
{ "template": "builtin-code-reviewer",
  "task": "Review the last commit",
  "context": "optional",
  "run_in_background": true,
  "overrides": { "model": "provider/model", "skills": ["…"], "tools": ["…"],
                 "tool_policy": {"rules": {"bash": "deny"}}, "max_delegation_depth": 2 } }
```

Поведение: только enabled-шаблоны; merge global → project → run; штатный subagent seam (`ctx.subagents.startActivation`, provider `spawn`); возвращает id child-агента; понятные ошибки: template not found, disabled, invalid configuration, tool denied, provider unavailable. Инструменты, запрещённые effective policy, удаляются у child через `ctx.tools.restrict({deny})` на `agent.ctx` в `agent/created`.

## Команда (command palette)

`/agent-studio <op> [json]`:

```
/agent-studio help
/agent-studio list {"query":"review"}
/agent-studio save {"template": {…}}
/agent-studio run {"template":"builtin-architect","task":"…"}
/agent-studio export {"all": true}
/agent-studio import {"document": {…}, "strategy": "merge", "apply": true}
/agent-studio effective {"id":"builtin-devops-engineer"}
/agent-studio project-save {"all": true}
/agent-studio undo
```

## Как добавить новый шаблон / skill / tool

- **Шаблон**: Agent Studio → «Новый шаблон» (или `/agent-studio save`), либо добавьте в project-файл `.agent-studio/agent-templates.json`.
- **Skill**: создайте skill в project/user skill roots штатным механизмом Harness — он появится в разделе «Skills» и будет доступен child-агентам через стандартный `skill` loader. Имя skill можно указать в поле Skills шаблона.
- **Tool**: tools реестра появляются автоматически (категория определяется по имени, неизвестные — `custom`); правило для нового tool добавляется в toolPolicy.rules шаблона.

## Ограничения v1

- `ask` в tool policy исполняется как `deny` (нет per-child confirmation waterfall).
- Панель работает с сессией, открытой в основном окне (конфигурация cwd-sensitive; без открытой сессии операции недоступны).
- Пресет `full-developer` не запрещает ничего, кроме явно указанного в правилах.
- Вызов `/agent-studio …` оставляет command-записи в логе сессии (штатный механизм команд).

## Тесты

```
node --test tests/
```

Покрывают: merge слоёв, tool policy resolution (включая no-loosening), export/import (placeholders, секреты, стратегии), schema-валидацию, конфликтующие шаблоны, разбор project-документа.
