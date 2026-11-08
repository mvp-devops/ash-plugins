# Agent Studio — руководство пользователя

Agent Studio — плагин DeepSeek Harness для создания, настройки и запуска сабагентов
с заданными ролями, инструкциями, skills и гибкой tool policy.

---

## 1. Установка

Установка выполняется один раз, через Plugin Manager в Web UI или через tool:

```
plugin_manager  action=install_bundle  target=<абсолютный путь к каталогу agent-studio>
```

После установки пункт **Agent Studio** появляется в левой навигации. Обновите страницу
Web GUI (F5 / Cmd+R), если пункт не появился сразу. Удаление — `remove_bundle` по имени
бандла `@local/agent-studio`.

Требования: активные штатные плагины Harness — subagents (provider `spawn`), commands,
skills, workspace files. В стандартном Web-профиле они есть.

---

## 2. Первые шаги

1. Откройте **Agent Studio** в левой панели.
2. Откройте любую сессию (вкладка «Сабагенты» работает от рабочей директории текущей
   сессии; без открытой сессии операции недоступны — плагин покажет подсказку).
3. В списке уже видны **7 встроенных шаблонов**: Backend Developer, Frontend Developer,
   QA Engineer, Code Reviewer, DevOps Engineer, Architect, Business Analyst.
4. Нажмите **Run** на карточке — откроется окно запуска (см. раздел 6).

Встроенные шаблоны read-only: их нельзя изменить или удалить, но можно **дублировать**
(⋯ → «Дублировать») и править копию.

---

## 3. Вкладки панели

| Вкладка | Что здесь |
|---|---|
| **Сабагенты** | Список шаблонов: имя, роль, описание, статус enabled/disabled, scope (Global/Project/Built-in), количество skills, пресет tool policy, счётчики разрешено/запрещено, теги, кнопка Run. Поиск, фильтры по роли/scope/статусу. Меню ⋯ на карточке: Run, Редактировать, Дублировать, Включить/Отключить, Effective policy, Сохранить в project, Поделиться (экспорт), Удалить. Кнопка «Отменить» откатывает последнюю мутацию. |
| **Skills** | Каталог skills, доступных текущей сессии (проектные и пользовательские). Здесь можно создавать, редактировать и удалять проектные skills; они сохраняются как `.dsh/skills/<name>/SKILL.md`. |
| **Tools** | Полный реестр model-facing tools с категориями (Filesystem, Shell, Web, Code editing, Custom…). Внизу вкладки — CRUD для project tools Agent Studio: создание, редактирование и удаление; tools регистрируются в штатном `ctx.tools` и участвуют в policy. Мутирование проектных skills/tools использует текущую sandbox policy сессии. |
| **Настройки** | Состояние project-конфигурации: корень проекта, файл `.agent-studio/agent-templates.json`, список шаблонов в нём; кнопка «Сохранить все глобальные шаблоны в project». |
| **Импорт / экспорт** | Экспорт всех шаблонов в JSON (копировать/скачать), импорт с предпросмотром diff и выбором стратегии. |

---

## 4. Шаблон сабагента: поля

| Поле | Назначение |
|---|---|
| **Name** | Отображаемое имя (уникальный id генерируется автоматически). |
| **Role / persona** | Роль, попадает в заголовок промпта child-агента. |
| **Description** | Короткое описание назначения (видно в списке и лаунчере). |
| **System instructions** | Операционные инструкции child-агента. |
| **Skills** | Рекомендованные skills через запятую; child-агенту будет сказано загрузить их через штатный `skill`, когда это уместно. |
| **Tool policy preset** | Пресет поведения (см. раздел 5). |
| **Tool policy rules** | Таблица: tool × статус × примечание. |
| **Model / provider override** | Необязательно, формат `provider/model`. |
| **Max delegation depth** | 1–4; ограничивает собственную рекурсию делегирования child-агента (по умолчанию 2). |
| **Tags** | Теги для поиска. |
| **Enabled** | Выключенный шаблон нельзя запустить (ошибка «template disabled»). |
| **Scope** | Global — глобальный шаблон; Project — после сохранения шаблон копируется в project-файл. |

Все изменения журналируются в памяти: кнопка **«Отменить»** на вкладке «Сабагенты»
откатывает последнюю мутацию (включая импорт и запись в project).

---

## 5. Управление skills и tools

### Project skills

На вкладке **Skills**:

1. Нажмите **Новый skill**.
2. Заполните имя (`a-z`, цифры и дефисы), описание и Markdown-тело инструкций.
3. Сохраните — плагин создаст `<projectRoot>/.dsh/skills/<name>/SKILL.md` с YAML frontmatter `name`/`description`.
4. Для существующего project skill используйте **Редактировать**; **Удалить** удаляет `SKILL.md`.

Путь соответствует штатному `dsh-skill-filesystem` provider Harness. После изменения skill
штатный каталог skills обновится при следующем чтении/наблюдении.

Поддерживаются и flat-файлы `<projectRoot>/.dsh/skills/<name>.md`; при редактировании через
Agent Studio skill сохраняется в каноническом формате bundle (`<name>/SKILL.md`).

### Project tools

На вкладке **Tools**, в секции **Project tools (Agent Studio)**:

1. Нажмите **Новый tool**.
2. Укажите имя (`a-z`, цифры и `_`), описание и содержимое, которое будет возвращено
   вызывающему агенту.
3. После сохранения tool сразу регистрируется в штатном `ctx.tools`; он появляется в
   каталоге tools и может быть указан в `toolPolicy.rules` шаблона.
4. Используйте **Редактировать** или **Удалить**. Удаление снимает live-регистрацию.
5. Нельзя создать tool с именем штатного Harness tool; это предотвращает shadowing.

Project tools — намеренно простые knowledge tools: они не исполняют произвольный код и
возвращают сохранённый текст. Они хранятся machine-local в профиле (`$DSH_PROFILE_DIR/agent-studio/custom-tools.json`)
и переносятся через общий Export/Import вместе с шаблонами. Секретоподобные поля удаляются
при экспорте.

Оба CRUD-потока используют sandbox policy текущей сессии. В read-only режиме запись или
удаление будет отклонено понятной ошибкой — переключите сессию в workspace-write.

---

## 6. Tool policy

### Пресеты

| Пресет | Поведение |
|---|---|
| `read-only` | Чтение, поиск, web, документация; запись, shell и делегирование запрещены. |
| `code-editing` | Файлы + shell + редактирование + тесты + web. |
| `full-developer` | Разрешено всё, кроме явно запрещённого правилами. |
| `safe-qa` | Тестирование, браузер, чтение, shell; запись кода запрещена. |
| `research-only` | Web + чтение; запись и shell запрещены. |
| `custom` | Ничего не навязывает — действуют только явные правила. |

### Статусы правил per tool

- **allow** — разрешён;
- **deny** — запрещён;
- **ask** — в UI виден как «Спросить», но исполняется консервативно как **deny**
  (у child-агента нет собственного confirmation waterfall);
- **inherit** — использовать дефолт пресета.

### Как это исполняется

Запрещённые tools реально недоступны child-агенту, а не просто скрыты:

1. **Guard на исполнение** — вызов запрещённого tool отклоняется с понятной ошибкой
   («tool "bash" is denied by the Agent Studio tool policy of template "…"»), работает
   для всех tools, включая те, что Harness регистрирует per-agent.
2. **Restrict на представление** — глобально зарегистрированные tools дополнительно
   убираются из набора child-агента через штатный `ctx.tools.restrict()`.

### Порядок слоёв и запрет ослабления

```
built-in → global user → project override → run-time overrides
```

Каждый следующий слой может только **ужесточить** политику. Попытка project- или
run-слоя разрешить то, что запретил глобальный слой, игнорируется и фиксируется как
конфликт — конфликты видны в диалоге «Effective policy» и в результате запуска.
Диалог «Effective policy» показывает итоговый статус каждого tool и источник решения
(preset / rule / слой).

---

## 7. Запуск сабагента — три пути

### Из карточки (или контекстного меню сессии / выделенного текста)

Кнопка **Run** (или ⋯ → Run, или правый клик по сессии в сайдбаре → «Run subagent»,
или кнопка на выделенном в чате тексте) открывает лаунчер:

1. **Выбор шаблона**: поиск по имени/роли/тегам, роль, описание, пресет политики,
   метка «Project override», если проектная версия существует.
2. **Компактная форма**: Task (обязательно), Context (необязательно), необязательные
   overrides — модель `provider/model` и max delegation depth, галочка «Run in
   background» (совместимость: запуск всегда асинхронный).
3. После запуска показывается id child-агента; завершение придёт уведомлением в
   родительскую сессию.

### Фон и системная тема

Панель Agent Studio наследует фон, цвета и primary-кнопки текущей темы Harness.
Плагин не задаёт фиксированный серый фон: фон панели прозрачен, а цвета кнопок берутся
из системных токенов `--dsw-alias-button-primary-fill` и
`--dsw-alias-label-primary-foreground`. При переключении светлой/тёмной темы страница
обновляется автоматически.

### Через tool (для агента)

```
agent_studio_run_subagent {
  "template": "builtin-code-reviewer",
  "task": "Review the last commit",
  "context": "optional extra context",
  "run_in_background": true,
  "overrides": {
    "model": "provider/model",
    "skills": ["code-review"],
    "tools": ["read", "grep"],
    "tool_policy": { "rules": { "bash": "deny" } },
    "max_delegation_depth": 2
  }
}
```

Ошибки понятны и локализуемы: `template not found`, `template disabled`,
`invalid configuration: …`, `tool denied: …`, `provider unavailable: …`.

### CRUD-команды skills и tools

Панель использует те же операции через command palette:

```text
/agent-studio skill-list
/agent-studio skill-get {"name":"api-review"}
/agent-studio skill-save {"name":"api-review","description":"Review API changes","body":"## Steps\n1. Read the API docs."}
/agent-studio skill-delete {"name":"api-review"}

/agent-studio tool-list
/agent-studio tool-save {"name":"team_norms","description":"Team conventions","content":"Run lint before commit."}
/agent-studio tool-delete {"id":"ct-…"}
```

`skill-save` создаёт проектный `SKILL.md`; `tool-save` регистрирует live tool в текущем
Host-контексте. Операции записи требуют разрешённого sandbox-режима.

### Через command palette

Наберите `/agent-studio` в композере сессии:

```
/agent-studio help
/agent-studio list {"query":"review"}
/agent-studio get {"id":"builtin-architect"}
/agent-studio save {"template": {"id":"my-agent","name":"My Agent","role":"Dev","instructions":"…"}}
/agent-studio duplicate {"id":"builtin-architect","name":"Архитектор v2"}
/agent-studio toggle {"id":"my-agent"}
/agent-studio delete {"id":"my-agent"}
/agent-studio run {"template":"builtin-architect","task":"…","overrides":{"max_delegation_depth":1}}
/agent-studio effective {"id":"builtin-devops-engineer"}
/agent-studio skills
/agent-studio tools
/agent-studio export {"all":true}
/agent-studio import {"document":{…},"strategy":"merge"}            # предпросмотр
/agent-studio import {"document":{…},"strategy":"merge","apply":true}
/agent-studio project-save {"all":true}
/agent-studio project-status
/agent-studio undo
```

Ответ каждого вызова — JSON (kind success/error + данные).

---

## 8. Глобальные и project-конфигурации

| Уровень | Где хранится | Переносимость |
|---|---|---|
| Built-in | внутри плагина | всегда, read-only |
| Global user | `$DSH_PROFILE_DIR/agent-studio/templates.json` (локально для машины/профиля) | через Export/Import |
| Project override | `<корень проекта>/.agent-studio/agent-templates.json` | переносим (коммитится в репозиторий) |

- Project-конфигурация читается относительно **текущей рабочей директории сессии**:
  сменили `working directory` — подхватились шаблоны этого проекта.
- «Сохранить в project» на карточке или «project-save» в команде копирует шаблон
  (включая built-in) в project-файл; у копии scope=`project`.
- Project-файл храните **без машинных путей**; при необходимости используйте
  placeholders `${PROJECT_ROOT}` и `${USER_HOME}` — они восстанавливаются при чтении.
- Раздел «Настройки» показывает корень, файл и список шаблонов project-конфигурации.

Пример project-файла:

```json
{
  "format": "agent-studio/templates",
  "schemaVersion": 1,
  "metadata": { "updatedAt": "2026-11-08T12:00:00.000Z", "count": 1 },
  "templates": [
    {
      "id": "api-migrator",
      "name": "API Migrator",
      "role": "Backend Developer",
      "description": "Миграции API по гайдам репозитория",
      "instructions": "Следуй docs/api-guidelines.md. Минимальные диффы.",
      "skills": ["api-design", "database"],
      "toolPolicy": { "preset": "code-editing", "rules": { "web_search": "ask" } },
      "maxDelegationDepth": 2,
      "tags": ["backend"],
      "scope": "project",
      "enabled": true
    }
  ]
}
```

JSON Schema: `schema/agent-templates.schema.json` в каталоге плагина.

---

## 9. Импорт / экспорт (перенос между машинами)

**Экспорт** (вкладка «Импорт / экспорт» или ⋯ → «Поделиться»):
- JSON с `format: "agent-studio/templates"`, `schemaVersion`, metadata
  (pluginVersion, createdAt, count);
- секреты (поля, похожие на token/secret/apiKey/password/credential) удаляются;
- абсолютные пути заменяются на `${PROJECT_ROOT}` / `${USER_HOME}`;
- экспортировать можно все шаблоны или выбранные (включая built-in — удобно как основу).
- custom tools входят в тот же документ в массиве `customTools`; при импорте они проходят валидацию, preview/diff и live-регистрацию.

**Импорт**:
1. Вставьте JSON → «Предпросмотр импорта»: diff по каждому шаблону
   (create / update / same) и предупреждения (например, о более новой schemaVersion).
2. Выберите стратегию:
   - `merge` — объединить поля поверх существующих;
   - `overwrite` — заменить целиком (требует галочки подтверждения);
   - `skip-existing` — не трогать существующие;
   - `create-copy` — импортировать под новым id `…-imported`.
3. «Применить импорт». Перезапись существующих шаблонов без явной галочки запрещена.
4. Откат — кнопка «Отменить».

---

## 10. Типовые сценарии

**Сделать свою версию ревьюера под репозиторий**
⋯ на «Code Reviewer» → «Дублировать» → правьте инструкции и правила (например,
`web_fetch: allow`) → «Сохранить в project», чтобы команда получила шаблон через git.

**Ограничить QA-агента**
Пресет `safe-qa` уже запрещает запись кода. Добавьте правило `bash: ask` (будет deny) —
и агент сможет только читать и запускать тесты.

**Безопасный опенсорс-шаблон**
Создайте шаблон, экспортируйте его (кнопка «Поделиться») и приложите JSON к репозиторию;
пользователи импортируют его без риска получить ваши пути или секреты.

**Много репозиториев — разные политики**
В каждом репозитории свой `.agent-studio/agent-templates.json`; переключение
`working directory` переключает набор переопределений.

---

## 11. Устранение неполадок

| Симптом | Причина / решение |
|---|---|
| «Откройте сессию…» в панели | Конфигурация зависит от рабочей директории сессии — откройте сессию. |
| «provider unavailable: subagent provider "spawn"…» | Не активен in-process spawn-провайдер сабагентов; проверьте профиль. |
| «tool denied: …» при запуске | Override или шаблон требует tool, запрещённый effective policy. Посмотрите «Effective policy». |
| «invalid configuration: …» | Шаблон не прошёл валидацию — в сообщении перечислены поля. |
| «template disabled» | Включите шаблон (⋯ → Включить). |
| «existing project configuration requires confirmation» | Project-файл уже есть; передайте `confirm: true` (UI делает это сам). |
| Ошибка записи в project | Режим песочницы сессии read-only — переключите режим или подтвердите запись. |
| `/agent-studio: unknown op` | Опечатка в операции; `/agent-studio help` покажет список. |
| Панель не отвечает / ошибка в консоли | Обновите страницу GUI; если не помогло — `plugin_manager set_plugin` выключить/включить `agent-studio`. |

---

## 12. Ограничения текущей версии

- `ask` исполняется как `deny` (нет per-child confirmation waterfall).
- Панель привязана к сессии, открытой в основном окне.
- Пресет `full-developer` ничего не запрещает по умолчанию.
- Guard действует на прямых children (внуки ограничены max delegation depth).
- Вызовы `/agent-studio` оставляют command-записи в логе сессии (штатный механизм).
- Model-override из шаблона не проверяется политикой subagent-model-selection —
  для строго контролируемых маршрутов используйте штатный `subagent` tool.
