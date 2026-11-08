/**
 * Agent-инструменты плагина doc-templates-panel.
 *
 * Все инструменты читают/пишут локальные данные шаблонов и не обращаются
 * к сети. Мутирующие операции (create/update/delete/import/save_document)
 * проходят штатный конвейер разрешений DSH: политика доступа к инструментам
 * и песочница файловой службы запрашивают подтверждение пользователя,
 * если это предписано текущим preset'ом разрешений.
 *
 * Каждый инструмент объявляет output { schema, render }, как требует
 * реестр инструментов DSH: schema описывает результат, render отдаёт
 * краткое текстовое представление для модели и UI.
 *
 * @param {any} ctx контекст cordis
 * @param {{ dispatch: (args: any, agent: any, signal?: AbortSignal) => Promise<any>, saveDocument: (agent: any, args: any) => Promise<any> }} api
 */

/** Единая обёртка output для инструментов, возвращающих объект-результат. */
function output(schema, render) {
  return { schema, render };
}

const OBJECT_SCHEMA = { type: 'object', additionalProperties: true };

/**
 * @param {any} ctx
 * @param {{ dispatch: any, saveDocument: any }} api
 */
export function registerDocTemplateTools(ctx, api) {
  const { dispatch, saveDocument } = api;

  const run = (args, exec, op) => dispatch({ ...args, op }, exec?.agent, exec?.signal);

  ctx.tools.register({
    name: 'doc_templates_list',
    description: 'Список шаблонов проектной документации с фильтрами: поиск по названию/описанию/тегам/содержимому, тип, область действия (глобальные/проектные), тег, сортировка.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковая строка по названию, описанию, тегам и содержимому.' },
        type: { type: 'string', description: 'Фильтр по типу: requirements | technical_specification | diagram | technical_design | test_case | test_protocol | custom.' },
        scope: { type: 'string', description: 'Фильтр по области: global | project.' },
        tag: { type: 'string', description: 'Фильтр по одному тегу.' },
        sort: { type: 'string', description: 'Сортировка: name | updatedAt (по умолчанию name).' },
        direction: { type: 'string', description: 'Направление сортировки: asc | desc.' },
        allProjects: { type: 'boolean', description: 'Показать проектные шаблоны всех проектов, а не только текущего.' },
      },
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (_args, value) => [{
      type: 'text',
      text: `Найдено шаблонов: ${value?.rows?.length ?? 0}${value?.total != null ? ` (всего в хранилище: ${value.total})` : ''}`,
    }]),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return run(args, exec, 'list');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_get',
    description: 'Получить один шаблон документации по id: метаданные, содержимое и описание переменных.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Идентификатор шаблона.' } },
      required: ['id'],
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (args, value) => [{
      type: 'text',
      text: value?.ok ? `Шаблон «${value.template?.name}» (${value.template?.typeLabel ?? value.template?.type}, ${value.builtin ? 'встроенный' : 'пользовательский'}, ${value.template?.contentLength ?? '?'} симв.)` : `Шаблон ${args.id} не найден`,
    }]),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return run(args, exec, 'get');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_create',
    description: 'Создать пользовательский шаблон документации. Мутирующая операция — требует подтверждения согласно политике разрешений.',
    parameters: {
      type: 'object',
      properties: {
        template: {
          type: 'object',
          description: 'Шаблон: name, type, scope, content, description, format, variables, tags, version, author. id генерируется, если не задан.',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string' },
            scope: { type: 'string' },
            projectId: { type: 'string' },
            description: { type: 'string' },
            format: { type: 'string' },
            content: { type: 'string' },
            variables: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, required: { type: 'boolean' }, defaultValue: { type: 'string' }, helpText: { type: 'string' } } } },
            tags: { type: 'array', items: { type: 'string' } },
            version: { type: 'string' },
            author: { type: 'string' },
          },
          required: ['name', 'type', 'scope', 'content'],
        },
      },
      required: ['template'],
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (_args, value) => [{
      type: 'text',
      text: value?.ok ? `Создан шаблон «${value.template?.name}» (${value.template?.id})` : `Создание не выполнено: ${value?.error ?? 'неизвестная ошибка'}`,
    }]),
    async execute(args, exec) {
      return run(args, exec, 'create');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_update',
    description: 'Обновить метаданные или содержимое пользовательского шаблона. Встроенные шаблоны доступны только для чтения. Мутирующая операция.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Идентификатор шаблона.' },
        patch: { type: 'object', description: 'Изменяемые поля: name, description, type, scope, content, variables, tags, version, author.' },
      },
      required: ['id', 'patch'],
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (args, value) => [{
      type: 'text',
      text: value?.ok ? `Обновлён шаблон ${args.id} (версия ${value.template?.version ?? '?'})` : `Обновление не выполнено: ${value?.error ?? 'неизвестная ошибка'}`,
    }]),
    async execute(args, exec) {
      return run(args, exec, 'update');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_delete',
    description: 'Удалить пользовательский шаблон документации. Встроенные шаблоны удалить нельзя. Мутирующая операция.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Идентификатор шаблона.' } },
      required: ['id'],
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (_args, value) => [{
      type: 'text',
      text: value?.ok ? `Удалён шаблон «${value.deleted?.name}» (${value.deleted?.id})` : `Удаление не выполнено: ${value?.error ?? 'неизвестная ошибка'}`,
    }]),
    async execute(args, exec) {
      return run(args, exec, 'delete');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_generate',
    description: 'Сгенерировать готовый Markdown-документ из шаблона, подставив значения переменных в плейсхолдеры {{placeholder}}. Файлы на диске не изменяет.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Идентификатор шаблона.' },
        values: { type: 'object', description: 'Значения переменных: { "ключ": "значение" }. Пустые необязательные переменные остаются плейсхолдерами.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (_args, value) => [{
      type: 'text',
      text: value?.ok ? `Документ сгенерирован (${value.document?.length ?? 0} симв.), имя файла: ${value.fileName}` : `Генерация не выполнена: ${value?.error ?? 'неизвестная ошибка'}`,
    }]),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return run(args, exec, 'generate');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_save_document',
    description: 'Сохранить сгенерированный Markdown-документ в <workspace>/docs/ (каталог создаётся автоматически). Имя файла: «<Название>_<ГГГГ-ММ-ДД>.md», при конфликте добавляется суффикс _2, _3… С dryRun=true возвращает предлагаемый путь без записи. Мутирующая операция.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Идентификатор шаблона (если документа ещё нет).' },
        values: { type: 'object', description: 'Значения переменных шаблона.' },
        document: { type: 'string', description: 'Готовый текст документа — можно сохранить без шаблона.' },
        fileName: { type: 'string', description: 'Имя файла вручную; иначе генерируется из названия шаблона и даты.' },
        dryRun: { type: 'boolean', description: 'true — только показать итоговое имя и относительный путь, не записывая файл.' },
      },
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (args, value) => [{
      type: 'text',
      text: value?.ok
        ? (value.dryRun
          ? `Предлагаемый путь: ${value.relativePath} (dryRun, файл не записан)`
          : `Документ сохранён: ${value.relativePath} (${value.bytes ?? 0} байт)`)
        : `Сохранение не выполнено: ${value?.error ?? 'неизвестная ошибка'}`,
    }]),
    async execute(args, exec) {
      return saveDocument(exec?.agent, args);
    },
  });

  ctx.tools.register({
    name: 'doc_templates_export',
    description: 'Экспортировать шаблоны в переносимый JSON (формат doc-templates-panel/templates): выбранные по ids или весь набор. Без секретов и абсолютных путей.',
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Список id шаблонов; без ids и all экспортируются доступные шаблоны текущего проекта.' },
        all: { type: 'boolean', description: 'Экспортировать весь набор, включая проектные шаблоны других проектов.' },
      },
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (_args, value) => [{
      type: 'text',
      text: `Экспортировано шаблонов: ${value?.document?.templates?.length ?? 0}`,
    }]),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return run(args, exec, 'export');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_import',
    description: 'Импортировать шаблоны из JSON экспорта. Без apply=true возвращает предпросмотр (diff). Перезапись существующих шаблонов требует confirmOverwrite=true. Мутирующая операция.',
    parameters: {
      type: 'object',
      properties: {
        document: { type: ['object', 'string'], description: 'Документ экспорта: JSON-объект или JSON-строка.' },
        strategy: { type: 'string', description: 'merge | overwrite | skip-existing | create-copy (по умолчанию merge).' },
        apply: { type: 'boolean', description: 'true — применить импорт; false/undefined — только предпросмотр.' },
        confirmOverwrite: { type: 'boolean', description: 'Явное подтверждение перезаписи существующих шаблонов.' },
      },
      required: ['document'],
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (_args, value) => [{
      type: 'text',
      text: value?.applied
        ? `Импорт применён: ${value.outcomes?.length ?? 0} операций`
        : value?.preview
          ? `Предпросмотр импорта: ${value.diff?.length ?? 0} шаблонов`
          : `Импорт не выполнен: ${value?.error ?? 'неизвестная ошибка'}`,
    }]),
    async execute(args, exec) {
      return run(args, exec, 'import');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_type_list',
    description: 'Список типов документации: встроенные (неизменяемые) и пользовательские типы, добавленные в панели или через инструменты.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: output(OBJECT_SCHEMA, (_args, value) => [{
      type: 'text',
      text: `Типов: ${value?.builtin?.length ?? 0} встроенных, ${value?.custom?.length ?? 0} пользовательских`,
    }]),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return run(args, exec, 'type-list');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_type_add',
    description: 'Добавить пользовательский тип документации (например «Пользовательская история»). Мутирующая операция.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Человекочитаемое название типа, например «Пользовательская история».' },
        id: { type: 'string', description: 'Необязательный id вида ctype:<id>; генерируется из названия, если не задан.' },
      },
      required: ['label'],
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (_args, value) => [{
      type: 'text',
      text: value?.ok ? `Добавлен тип «${value.type?.label}» (${value.type?.id})` : `Тип не добавлен: ${value?.error ?? 'неизвестная ошибка'}`,
    }]),
    async execute(args, exec) {
      return run(args, exec, 'type-add');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_type_update',
    description: 'Переименовать пользовательский тип документации. Встроенные типы переименовать нельзя. Мутирующая операция.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Идентификатор типа (ctype:…).' },
        label: { type: 'string', description: 'Новое название типа.' },
      },
      required: ['id', 'label'],
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (args, value) => [{
      type: 'text',
      text: value?.ok ? `Тип ${args.id} переименован в «${value.type?.label}»` : `Переименование не выполнено: ${value?.error ?? 'неизвестная ошибка'}`,
    }]),
    async execute(args, exec) {
      return run(args, exec, 'type-update');
    },
  });

  ctx.tools.register({
    name: 'doc_templates_type_delete',
    description: 'Удалить пользовательский тип документации, если он не используется шаблонами. Встроенные типы удалить нельзя. Мутирующая операция.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Идентификатор типа (ctype:…).' } },
      required: ['id'],
      additionalProperties: false,
    },
    output: output(OBJECT_SCHEMA, (_args, value) => [{
      type: 'text',
      text: value?.ok ? `Тип ${value.deleted} удалён` : `Удаление не выполнено: ${value?.error ?? 'неизвестная ошибка'}`,
    }]),
    async execute(args, exec) {
      return run(args, exec, 'type-delete');
    },
  });
}
