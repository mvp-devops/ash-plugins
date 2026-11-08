/**
 * doc-templates-panel — Client-половина (Web UI).
 *
 * Регистрирует:
 *  - элемент «Шаблоны документации» в левой навигации (`sidebar.panellist`, id "doc-templates");
 *  - основную панель в слоте `main` (key "doc-templates").
 *
 * Все данные проходят через сессионную команду `/doc-templates` на Host.
 * Содержимое шаблонов рендерится безопасным минимальным Markdown-рендером:
 * пользовательский ввод экранируется, произвольный HTML/JS не исполняется,
 * сетевые запросы не выполняются.
 */

window.__ModuleLoader__.load({
  id: '@local/doc-templates-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } = React;

    const NS = 'docTemplates';
    const PANEL_ID = 'doc-templates';
    const TYPE_LABELS = {
      requirements: 'Требования',
      technical_specification: 'Техническая спецификация',
      diagram: 'Схема / диаграмма',
      technical_design: 'Технический проект',
      test_case: 'Тест-кейс',
      test_protocol: 'Протокол тестирования',
      custom: 'Произвольный',
    };
    const TYPES = Object.keys(TYPE_LABELS);
    const BASE_TYPES = TYPES;

    // -- словарь (интерфейс — русский, en — запасной) --------------------------

    const ru = {
      panel: 'Шаблоны документации',
      title: 'Шаблоны документации',
      noSession: 'Откройте сессию с рабочей директорией: панель работает с шаблонами через текущую сессию (проектные шаблоны привязаны к её рабочему пространству).',
      loading: 'Загрузка…',
      error: 'Ошибка',
      search: 'Поиск по названию, описанию, тегам и содержимому',
      filterType: 'Все типы',
      filterScope: 'Все области',
      filterTag: 'Все теги',
      sort: 'Сортировка',
      sortName: 'По названию',
      sortUpdated: 'По дате изменения',
      scopeGlobal: 'Глобальный',
      scopeProject: 'Проектный',
      scopeBuiltin: 'Встроенный',
      newTemplate: 'Новый шаблон',
      importExport: 'Импорт / экспорт',
      empty: 'Шаблоны не найдены. Измените фильтры или создайте новый шаблон.',
      count: 'Шаблонов: {count}',
      groupOf: '{label} — {count}',
      view: 'Просмотр',
      generate: 'Сгенерировать',
      edit: 'Редактировать',
      duplicate: 'Дублировать',
      remove: 'Удалить',
      exportOne: 'Экспортировать',
      rowActions: 'Действия с шаблоном {name}',
      readonlyNote: 'Встроенный шаблон доступен только для чтения: создайте копию, чтобы редактировать.',
      copied: 'Скопировано в буфер обмена',
      copyFailed: 'Не удалось скопировать: {error}',
      // preview
      previewTitle: 'Просмотр шаблона',
      previewCopy: 'Копировать содержимое',
      placeholders: 'Плейсхолдеры',
      variablesLabel: 'Переменные',
      // editor
      editorNew: 'Новый шаблон',
      editorEdit: 'Редактирование шаблона',
      fieldName: 'Название',
      fieldType: 'Тип',
      fieldScope: 'Область действия',
      fieldProject: 'Проект (текущее рабочее пространство)',
      fieldFormat: 'Формат',
      fieldDescription: 'Описание',
      fieldTags: 'Теги (через запятую)',
      fieldVersion: 'Версия',
      fieldAuthor: 'Автор',
      fieldContent: 'Содержимое (Markdown с плейсхолдерами {{…}})',
      variablesEditor: 'Переменные',
      varKey: 'Ключ',
      varLabel: 'Подпись',
      varRequired: 'Обязательна',
      varDefault: 'По умолчанию',
      varHelp: 'Подсказка',
      varAdd: 'Добавить переменную',
      varRemove: 'Удалить переменную {key}',
      save: 'Сохранить',
      cancel: 'Отмена',
      deleteConfirmTitle: 'Удалить шаблон',
      deleteConfirmBody: 'Удалить шаблон «{name}»? Действие нельзя отменить средствами панели; при необходимости заранее сделайте экспорт.',
      deleteConfirmYes: 'Удалить',
      close: 'Закрыть',
      saved: 'Шаблон сохранён',
      created: 'Шаблон создан',
      deleted: 'Шаблон удалён',
      duplicated: 'Создана копия шаблона',
      // generate
      generateTitle: 'Генерация документа',
      generateFill: 'Заполните переменные шаблона',
      generatePreview: 'Показать документ',
      generateRequired: 'Не заполнены обязательные поля: {missing}',
      generateSaveDocs: 'Сохранить в docs/…',
      generateSaveConfirm: 'Сохранить документ',
      generatePath: 'Итоговый файл: {path} (относительно рабочего пространства).',
      generatePathConfirm: 'Записать файл по этому пути?',
      generateSaved: 'Документ сохранён: {path}',
      generateCopy: 'Копировать документ',
      generateBack: 'К переменным',
      generateUnfilled: 'Незаполненные необязательные переменные остались плейсхолдерами: {list}',
      regenerate: 'Сгенерировать заново',
      // import/export
      transferTitle: 'Импорт / экспорт шаблонов',
      exportAll: 'Экспортировать все шаблоны',
      exportSelected: 'Экспортировать выбранные',
      download: 'Скачать JSON',
      copy: 'Копировать',
      importJson: 'Импорт JSON',
      importMd: 'Импорт .md / .txt',
      importPlaceholder: 'Вставьте JSON экспорта или выберите файл',
      chooseFile: 'Выбрать файл…',
      importStrategy: 'Стратегия',
      strategyMerge: 'Обновлять существующие (merge)',
      strategyOverwrite: 'Перезаписывать (overwrite)',
      strategySkip: 'Пропускать существующие (skip-existing)',
      strategyCopy: 'Создавать копии (create-copy)',
      importPreview: 'Предпросмотр импорта',
      importApply: 'Применить импорт',
      importConfirmOverwrite: 'Разрешить перезапись существующих шаблонов',
      importOverwriteWarning: 'Импорт затрагивает существующие шаблоны — подтвердите перезапись.',
      importMdTitle: 'Импорт шаблона из Markdown',
      importMdName: 'Название шаблона',
      importMdType: 'Тип шаблона',
      importMdScope: 'Область',
      importMdCreate: 'Создать шаблон из файла',
      importMdHint: 'Файл .md/.txt станет содержимым нового шаблона; название возьмётся из имени файла.',
      actionCreate: 'создание',
      actionUpdate: 'обновление',
      actionUnchanged: 'без изменений',
      actionSkip: 'пропуск',
      actionCopy: 'копия',
      actionTypeCreate: 'новый тип',
      // storage
      storageTitle: 'Хранилище',
      storageSchema: 'Версия схемы',
      storageTemplates: 'Пользовательских шаблонов',
      storageDir: 'Каталог (в профиле DSH)',
      storageBackups: 'Резервные копии',
      restore: 'Восстановить из копии',
      restored: 'Хранилище восстановлено из резервной копии',
      noBackups: 'Резервных копий нет',
      status: 'Обновить статус',
      // типы документации
      typesButton: 'Типы…',
      typesTitle: 'Типы документации',
      typesNote: 'Встроенные типы неизменяемы. Пользовательские типы можно добавлять, переименовывать и удалять (пока их не используют шаблоны). Они входят в экспорт/импорт.',
      typesBuiltin: 'Встроенные',
      typesCustom: 'Пользовательские',
      typeAddLabel: 'Название нового типа',
      typeAdd: 'Добавить тип',
      typeRename: 'Переименовать',
      typeSaveRename: 'Сохранить',
      typeDelete: 'Удалить',
      typeBuiltinTag: 'встроенный',
      // панель форматирования
      editorToolbar: 'Панель форматирования',
      tbBold: 'Полужирный (**…**)',
      tbItalic: 'Курсив (*…*)',
      tbCode: 'Код (`…`)',
      tbH2: 'Заголовок H2',
      tbH3: 'Заголовок H3',
      tbUl: 'Маркированный список',
      tbOl: 'Нумерованный список',
      tbCheck: 'Чек-лист',
      tbQuote: 'Цитата',
      tbTable: 'Таблица',
      tbFence: 'Блок кода',
      tbVar: 'Плейсхолдер {{…}}',
      tbLink: 'Ссылка',
      tbHr: 'Разделитель',
      // общие
      refresh: 'Обновить',
      yes: 'Да',
      no: 'Нет',
      optional: 'необязательно',
    };

    const en = {
      panel: 'Documentation templates',
      title: 'Documentation templates',
      noSession: 'Open a session with a working directory: the panel reads templates through the current session (project templates bind to its workspace).',
      loading: 'Loading…',
      error: 'Error',
      search: 'Search by name, description, tags and content',
      filterType: 'All types',
      filterScope: 'All scopes',
      filterTag: 'All tags',
      sort: 'Sort',
      sortName: 'By name',
      sortUpdated: 'By updated date',
      scopeGlobal: 'Global',
      scopeProject: 'Project',
      scopeBuiltin: 'Built-in',
      newTemplate: 'New template',
      importExport: 'Import / export',
      empty: 'No templates found. Change the filters or create a new template.',
      count: 'Templates: {count}',
      groupOf: '{label} — {count}',
      view: 'View',
      generate: 'Generate',
      edit: 'Edit',
      duplicate: 'Duplicate',
      remove: 'Delete',
      exportOne: 'Export',
      rowActions: 'Actions for template {name}',
      readonlyNote: 'Built-in templates are read-only: duplicate one to customize it.',
      previewTitle: 'Template preview',
      previewCopy: 'Copy content',
      placeholders: 'Placeholders',
      variablesLabel: 'Variables',
      editorNew: 'New template',
      editorEdit: 'Edit template',
      fieldName: 'Name',
      fieldType: 'Type',
      fieldScope: 'Scope',
      fieldProject: 'Project (current workspace)',
      fieldFormat: 'Format',
      fieldDescription: 'Description',
      fieldTags: 'Tags (comma-separated)',
      fieldVersion: 'Version',
      fieldAuthor: 'Author',
      fieldContent: 'Content (Markdown with {{…}} placeholders)',
      variablesEditor: 'Variables',
      varKey: 'Key',
      varLabel: 'Label',
      varRequired: 'Required',
      varDefault: 'Default',
      varHelp: 'Hint',
      varAdd: 'Add variable',
      varRemove: 'Remove variable {key}',
      save: 'Save',
      cancel: 'Cancel',
      deleteConfirmTitle: 'Delete template',
      deleteConfirmBody: 'Delete template “{name}”? This cannot be undone from the panel; export first if needed.',
      deleteConfirmYes: 'Delete',
      close: 'Close',
      saved: 'Template saved',
      created: 'Template created',
      deleted: 'Template deleted',
      duplicated: 'Template duplicated',
      generateTitle: 'Generate document',
      generateFill: 'Fill in the template variables',
      generatePreview: 'Show document',
      generateRequired: 'Missing required fields: {missing}',
      generateSaveDocs: 'Save to docs/…',
      generateSaveConfirm: 'Save document',
      generatePath: 'Final file: {path} (relative to the workspace).',
      generatePathConfirm: 'Write the file to this path?',
      generateSaved: 'Document saved: {path}',
      generateCopy: 'Copy document',
      generateBack: 'Back to variables',
      generateUnfilled: 'Unfilled optional variables remain placeholders: {list}',
      regenerate: 'Regenerate',
      transferTitle: 'Import / export templates',
      exportAll: 'Export all templates',
      exportSelected: 'Export selected',
      download: 'Download JSON',
      copy: 'Copy',
      importJson: 'Import JSON',
      importMd: 'Import .md / .txt',
      importPlaceholder: 'Paste exported JSON or choose a file',
      chooseFile: 'Choose file…',
      importStrategy: 'Strategy',
      strategyMerge: 'Update existing (merge)',
      strategyOverwrite: 'Overwrite (overwrite)',
      strategySkip: 'Skip existing (skip-existing)',
      strategyCopy: 'Create copies (create-copy)',
      importPreview: 'Import preview',
      importApply: 'Apply import',
      importConfirmOverwrite: 'Allow overwriting existing templates',
      importOverwriteWarning: 'The import touches existing templates — confirm the overwrite.',
      importMdTitle: 'Import template from Markdown',
      importMdName: 'Template name',
      importMdType: 'Template type',
      importMdScope: 'Scope',
      importMdCreate: 'Create template from file',
      importMdHint: 'A .md/.txt file becomes the content of a new template; the name is taken from the file name.',
      actionCreate: 'create',
      actionUpdate: 'update',
      actionUnchanged: 'unchanged',
      actionSkip: 'skip',
      actionCopy: 'copy',
      actionTypeCreate: 'new type',
      storageTitle: 'Storage',
      storageSchema: 'Schema version',
      storageTemplates: 'User templates',
      storageDir: 'Directory (inside the DSH profile)',
      storageBackups: 'Backups',
      restore: 'Restore from backup',
      restored: 'Storage restored from backup',
      noBackups: 'No backups',
      status: 'Refresh status',
      typesButton: 'Types…',
      typesTitle: 'Documentation types',
      typesNote: 'Built-in types are immutable. Custom types can be added, renamed and deleted (while unused by templates) and are included in export/import.',
      typesBuiltin: 'Built-in',
      typesCustom: 'Custom',
      typeAddLabel: 'New type name',
      typeAdd: 'Add type',
      typeRename: 'Rename',
      typeSaveRename: 'Save',
      typeDelete: 'Delete',
      typeBuiltinTag: 'built-in',
      editorToolbar: 'Formatting toolbar',
      tbBold: 'Bold (**…**)',
      tbItalic: 'Italic (*…*)',
      tbCode: 'Code (`…`)',
      tbH2: 'Heading H2',
      tbH3: 'Heading H3',
      tbUl: 'Bullet list',
      tbOl: 'Numbered list',
      tbCheck: 'Checklist',
      tbQuote: 'Quote',
      tbTable: 'Table',
      tbFence: 'Code block',
      tbVar: 'Placeholder {{…}}',
      tbLink: 'Link',
      tbHr: 'Divider',
      refresh: 'Refresh',
      yes: 'Yes',
      no: 'No',
      optional: 'optional',
    };

    // -- API-мост: сессионная команда на Host ----------------------------------

    async function api(ctx, sessionId, args) {
      const line = `/doc-templates ${JSON.stringify(args)}`;
      const outcome = await ctx.remote.commands.execute(sessionId, line, []);
      if (!outcome.ok) throw new Error(outcome.error?.message ?? 'Команда /doc-templates не выполнена');
      const result = outcome.value?.result;
      if (!result) throw new Error('Команда /doc-templates не вернула результат');
      if (result.kind === 'error') {
        let payload = null;
        try { payload = JSON.parse(result.text); } catch { /* простой текст ошибки */ }
        throw new Error(payload?.error ?? result.text);
      }
      return JSON.parse(result.text);
    }

    // -- вспомогательные компоненты ---------------------------------------------

    function useAsync(fn, deps) {
      const [state, setState] = useState({ busy: true, data: null, error: null });
      const run = useCallback((...args) => {
        setState((prev) => ({ ...prev, busy: true, error: null }));
        return Promise.resolve()
          .then(() => fn(...args))
          .then((data) => setState({ busy: false, data, error: null }))
          .catch((error) => setState({ busy: false, data: null, error: error?.message ?? String(error) }));
      }, deps); // eslint-disable-line react-hooks/exhaustive-deps
      useEffect(() => { run(); }, [run]);
      return [state, run, setState];
    }

    function Notice({ kind, children, onClose }) {
      if (!children) return null;
      return h('div', { className: `dtp-notice dtp-notice-${kind ?? 'info'}`, role: kind === 'error' ? 'alert' : 'status' },
        h('span', { className: 'dtp-notice-text' }, children),
        onClose ? h('button', { type: 'button', className: 'dtp-btn dtp-btn-ghost dtp-notice-close', 'aria-label': 'Закрыть', onClick: onClose }, '×') : null,
      );
    }
    function Modal({ title, onClose, children, wide, labelId }) {
      const ref = useRef(null);
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
        document.addEventListener('keydown', onKey);
        const node = ref.current;
        const first = node?.querySelector('input, textarea, select, button');
        first?.focus();
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);
      return h('div', { className: 'dtp-modal-backdrop', onPointerDown: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h('div', { className: `dtp-modal${wide ? ' dtp-modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, ref },
          h('div', { className: 'dtp-modal-head' },
            h('div', { className: 'dtp-modal-title' }, title),
            h('button', { type: 'button', className: 'dtp-btn dtp-btn-ghost', onClick: onClose, 'aria-label': 'Закрыть' }, '×'),
          ),
          h('div', { className: 'dtp-modal-body' }, children),
        ),
      );
    }

    function Confirm({ title, body, actionLabel, onConfirm, onClose, danger = true }) {
      return h(Modal, { title, onClose },
        h('div', { className: 'dtp-confirm-body' }, body),
        h('div', { className: 'dtp-actions' },
          h('button', { type: 'button', className: `dtp-btn${danger ? ' dtp-btn-danger' : ' dtp-btn-primary'}`, onClick: () => { onClose(); onConfirm(); } }, actionLabel),
          h('button', { type: 'button', className: 'dtp-btn', onClick: onClose }, t_or('cancel')),
        ),
      );
    }

    function Field({ label, children, hint }) {
      return h('label', { className: 'dtp-field' },
        h('span', { className: 'dtp-field-label' }, label),
        children,
        hint ? h('span', { className: 'dtp-field-hint' }, hint) : null,
      );
    }

    function selectControl(label, value, options, onChange, render) {
      return h('select', { className: 'dtp-input dtp-select', value, onChange: (e) => onChange(e.target.value), 'aria-label': label },
        options.map((option) => h('option', { key: option.value ?? option, value: option.value ?? option }, render ? render(option) : (option.label ?? option))),
      );
    }

    function downloadText(text, name, mime = 'application/json') {
      const blob = new Blob([text], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }

    async function copyText(text, notify, t) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const area = document.createElement('textarea');
          area.value = text;
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          area.remove();
        }
        notify({ kind: 'success', text: t('copied') });
      } catch (error) {
        notify({ kind: 'error', text: t('copyFailed').replace('{error}', error?.message ?? String(error)) });
      }
    }

    // -- безопасный минимальный Markdown-рендер ---------------------------------
    // Пользовательский ввод экранируется до любой разметки; произвольный HTML
    // и JS не исполняются; ссылки ограничены http/https/mailto.

    function escapeHtml(text) {
      return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function inlineFormat(escaped) {
      let out = escaped;
      out = out.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.-]{0,63})\s*\}\}/g, (_m, key) => `<mark class="dtp-ph">{{${key}}}</mark>`);
      out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
      out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
      return out;
    }

    function renderMarkdown(source) {
      const escaped = escapeHtml(source ?? '');
      const blocks = escaped.split(/```([A-Za-z0-9_-]*)\n([\s\S]*?)(?:```|$)/);
      /** @type {string[]} */
      const html = [];
      for (let i = 0; i < blocks.length; i += 3) {
        html.push(renderMarkdownBlock(blocks[i]));
        if (blocks[i + 1] !== undefined) {
          const language = blocks[i + 1];
          const code = blocks[i + 2].replace(/\n$/, '');
          html.push(`<pre data-lang="${language}" class="dtp-code${language ? ` dtp-code-${language}` : ''}"><code>${code}</code></pre>`);
        }
      }
      return html.join('');
    }

    function renderMarkdownBlock(chunk) {
      if (!chunk) return '';
      const lines = chunk.split('\n');
      /** @type {string[]} */
      const out = [];
      let list = null; // 'ul' | 'ol' | null
      let table = null;
      const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
      const closeTable = () => { if (table) { out.push('</tbody></table>'); table = null; } };
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        if (/^\|.*\|$/.test(trimmed)) {
          const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
          const isSeparator = cells.every((cell) => /^:?-{2,}:?$/.test(cell));
          if (isSeparator) continue;
          if (!table) {
            closeList();
            table = true;
            out.push('<table class="dtp-table"><thead><tr>' + cells.map((cell) => `<th>${inlineFormat(cell)}</th>`).join('') + '</tr></thead><tbody>');
          } else {
            out.push('<tr>' + cells.map((cell) => `<td>${inlineFormat(cell)}</td>`).join('') + '</tr>');
          }
          continue;
        }
        closeTable();
        if (/^#{1,6}\s/.test(trimmed)) {
          closeList();
          const level = trimmed.match(/^#+/)[0].length;
          out.push(`<h${level} class="dtp-h${level}">${inlineFormat(trimmed.replace(/^#+\s*/, ''))}</h${level}>`);
          continue;
        }
        if (/^(---|\*\*\*|___)$/.test(trimmed)) { closeList(); out.push('<hr class="dtp-hr"/>'); continue; }
        if (/^&gt;\s?/.test(trimmed)) {
          closeList();
          out.push(`<blockquote class="dtp-quote">${inlineFormat(trimmed.replace(/^&gt;\s?/, ''))}</blockquote>`);
          continue;
        }
        const checkbox = trimmed.match(/^- \[( |x|X)\]\s(.*)$/);
        if (checkbox) {
          if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul class="dtp-list">'); }
          const checked = checkbox[1].toLowerCase() === 'x';
          out.push(`<li class="dtp-check${checked ? ' dtp-check-on' : ''}"><span class="dtp-check-box" aria-hidden="true">${checked ? '✓' : ''}</span><span>${inlineFormat(checkbox[2])}</span></li>`);
          continue;
        }
        const bullet = trimmed.match(/^[-*]\s+(.*)$/);
        if (bullet) {
          if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul class="dtp-list">'); }
          out.push(`<li>${inlineFormat(bullet[1])}</li>`);
          continue;
        }
        const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
        if (ordered) {
          if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol class="dtp-list">'); }
          out.push(`<li>${inlineFormat(ordered[1])}</li>`);
          continue;
        }
        closeList();
        if (trimmed) out.push(`<p class="dtp-p">${inlineFormat(trimmed)}</p>`);
      }
      closeList();
      closeTable();
      return out.join('');
    }

    // -- список шаблонов ----------------------------------------------------------

    function scopeBadge(row, t) {
      if (row.builtin) return h('span', { className: 'dtp-badge dtp-badge-dim' }, t('scopeBuiltin'));
      return h('span', { className: `dtp-badge ${row.scope === 'project' ? 'dtp-badge-info' : 'dtp-badge-dim'}` },
        row.scope === 'project' ? t('scopeProject') : t('scopeGlobal'));
    }

    function TemplateList({ t, rows, tags, types, filters, setFilters, sort, setSort, onActions, actions, onRowActivate, busy, error, reload }) {
      const listRef = useRef(null);
      const grouped = useMemo(() => {
        /** @type {Map<string, { label: string, rows: any[] }>} */
        const map = new Map();
        for (const row of rows) {
          const label = row.typeLabel ?? TYPE_LABELS[row.type] ?? row.type;
          if (!map.has(row.type)) map.set(row.type, { label, rows: [] });
          map.get(row.type).rows.push(row);
        }
        return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
      }, [rows]);

      const onKeyDown = (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = listRef.current?.querySelectorAll('.dtp-row-main');
        if (!items || items.length === 0) return;
        const current = document.activeElement;
        let index = Array.prototype.indexOf.call(items, current);
        if (event.key === 'ArrowDown') index = Math.min(items.length - 1, index + 1);
        else if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
        else if (event.key === 'Home') index = 0;
        else index = items.length - 1;
        items[index]?.focus();
        event.preventDefault();
      };

      return h('div', { className: 'dtp-listwrap' },
        h('div', { className: 'dtp-toolbar', role: 'search' },
          h('input', {
            type: 'search', className: 'dtp-input dtp-search', placeholder: t('search'),
            value: filters.query, 'aria-label': t('search'),
            onChange: (e) => setFilters((f) => ({ ...f, query: e.target.value })),
          }),
          selectControl(t('filterType'), filters.type, [{ value: '', label: t('filterType') }, ...types.map((type) => ({ value: type.id, label: type.label }))], (v) => setFilters((f) => ({ ...f, type: v }))),
          selectControl(t('filterScope'), filters.scope, [
            { value: '', label: t('filterScope') },
            { value: 'global', label: t('scopeGlobal') },
            { value: 'project', label: t('scopeProject') },
          ], (v) => setFilters((f) => ({ ...f, scope: v }))),
          selectControl(t('filterTag'), filters.tag, [{ value: '', label: t('filterTag') }, ...tags.map((tag) => ({ value: tag, label: tag }))], (v) => setFilters((f) => ({ ...f, tag: v }))),
          selectControl(t('sort'), `${sort.by}:${sort.direction}`, [
            { value: 'name:asc', label: t('sortName') },
            { value: 'updatedAt:desc', label: t('sortUpdated') },
          ], (v) => { const [by, direction] = v.split(':'); setSort({ by, direction }); }),
          h('button', { type: 'button', className: 'dtp-btn', onClick: reload }, t('refresh')),
        ),
        busy && rows.length === 0 ? h('div', { className: 'dtp-loading' }, t('loading')) : null,
        error ? h(Notice, { kind: 'error' }, `${t('error')}: ${error}`) : null,
        h('div', { className: 'dtp-list', role: 'list', ref: listRef, onKeyDown, 'aria-label': t('title') },
          rows.length === 0 && !busy ? h('div', { className: 'dtp-empty' }, t('empty')) : null,
          grouped.map((group) => h('div', { key: group.label, className: 'dtp-group' },
            h('div', { className: 'dtp-group-title' }, t('groupOf').replace('{label}', group.label).replace('{count}', String(group.rows.length))),
            group.rows.map((row) => h('div', { key: row.id, className: 'dtp-row', role: 'listitem' },
              h('button', {
                type: 'button', className: 'dtp-row-main',
                onDoubleClick: () => onRowActivate(row, 'view'),
                onClick: (e) => { if (e.detail === 0) onRowActivate(row, 'view'); },
                onKeyDown: (e) => { if (e.key === 'Enter') onRowActivate(row, 'view'); },
                'aria-label': `${row.name} — ${row.typeLabel}`,
              },
                h('span', { className: 'dtp-row-name' }, row.name),
                h('span', { className: 'dtp-badge dtp-badge-type' }, row.typeLabel),
                scopeBadge(row, t),
                row.description ? h('span', { className: 'dtp-row-desc' }, row.description) : null,
                row.tags?.length ? h('span', { className: 'dtp-row-tags' }, row.tags.map((tag) => h('span', { key: tag, className: 'dtp-tag' }, tag))) : null,
                h('span', { className: 'dtp-row-meta' },
                  h('span', { className: 'dtp-dim' }, `v${row.version}`),
                  row.updatedAt ? h('span', { className: 'dtp-dim' }, new Date(row.updatedAt).toLocaleDateString('ru-RU')) : null,
                ),
              ),
              h('div', { className: 'dtp-row-actions' },
                h('button', { type: 'button', className: 'dtp-btn dtp-btn-primary', onClick: () => onRowActivate(row, 'generate') }, t('generate')),
                h('div', { className: 'dtp-menu-wrap' },
                  h('button', {
                    type: 'button', className: 'dtp-btn dtp-btn-ghost', 'aria-haspopup': 'menu', 'aria-expanded': actions?.id === row.id,
                    'aria-label': t('rowActions').replace('{name}', row.name),
                    onClick: () => onActions(actions?.id === row.id ? null : row),
                  }, '⋯'),
                  actions?.id === row.id ? h('div', { className: 'dtp-menu', role: 'menu' },
                    [
                      { label: t('view'), run: () => onRowActivate(row, 'view') },
                      { label: t('generate'), run: () => onRowActivate(row, 'generate') },
                      row.readonly ? null : { label: t('edit'), run: () => onRowActivate(row, 'edit') },
                      { label: t('duplicate'), run: () => onRowActivate(row, 'duplicate') },
                      { label: t('exportOne'), run: () => onRowActivate(row, 'export') },
                      row.readonly ? null : { label: t('remove'), danger: true, run: () => onRowActivate(row, 'delete') },
                    ].filter(Boolean).map((item, index) => h('button', {
                      key: index, type: 'button', role: 'menuitem',
                      className: `dtp-menu-item${item.danger ? ' dtp-menu-danger' : ''}`,
                      onClick: () => { onActions(null); item.run(); },
                    }, item.label)),
                  ) : null,
                ),
              ),
            )),
          )),
        ),
      );
    }

    // -- просмотр шаблона (безопасный Markdown) ----------------------------------

    function TemplatePreview({ ctx, sessionId, t, notify, template, onClose }) {
      return h(Modal, { title: `${t('previewTitle')} — ${template.name}`, onClose, wide: true },
        h('div', { className: 'dtp-preview-meta' },
          h('span', { className: 'dtp-badge dtp-badge-type' }, template.typeLabel ?? TYPE_LABELS[template.type]),
          scopeBadge(template, t),
          template.description ? h('span', { className: 'dtp-dim' }, template.description) : null,
        ),
        template.placeholders?.length ? h('div', { className: 'dtp-ph-row' },
          h('span', { className: 'dtp-dim' }, t('placeholders') + ':'),
          template.placeholders.map((key) => h('code', { key, className: 'dtp-ph-code' }, `{{${key}}}`)),
        ) : null,
        h('div', { className: 'dtp-md dtp-md-preview', role: 'document' },
          h('div', { dangerouslySetInnerHTML: { __html: renderMarkdown(template.content) } }),
        ),
        h('div', { className: 'dtp-actions' },
          h('button', { type: 'button', className: 'dtp-btn', onClick: () => copyText(template.content, notify, t) }, t('previewCopy')),
        ),
      );
    }

    // -- форма генерации документа --------------------------------------------------

    function GenerateDocumentForm({ ctx, sessionId, t, notify, template, onClose }) {
      const [values, setValues] = useState(() => {
        /** @type {Record<string, string>} */
        const initial = {};
        for (const variable of template.variables ?? []) {
          if (variable.defaultValue) initial[variable.key] = variable.defaultValue;
        }
        return initial;
      });
      const [result, setResult] = useState(null); // { document, fileName, unfilled }
      const [pendingPath, setPendingPath] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      const generate = async () => {
        setBusy(true); setError(null); setPendingPath(null);
        try {
          const response = await api(ctx, sessionId, { op: 'generate', id: template.id, values });
          setResult(response);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      };

      const proposePath = async () => {
        setBusy(true); setError(null);
        try {
          const response = await api(ctx, sessionId, { op: 'save-document', id: template.id, values, dryRun: true });
          setPendingPath(response);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      };

      const save = async () => {
        setBusy(true); setError(null);
        try {
          const response = await api(ctx, sessionId, { op: 'save-document', id: template.id, values });
          notify({ kind: 'success', text: t('generateSaved').replace('{path}', response.relativePath) });
          onClose();
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      };

      const variables = template.variables ?? [];
      return h(Modal, { title: `${t('generateTitle')} — ${template.name}`, onClose, wide: true },
        h('div', { className: 'dtp-gen' },
          h('div', { className: 'dtp-section-title' }, t('generateFill')),
          variables.length === 0 ? h('div', { className: 'dtp-dim' }, t('variablesLabel') + ': —') : null,
          variables.map((variable) => h(Field, {
            key: variable.key,
            label: `${variable.label ?? variable.key}${variable.required ? ' *' : ` (${t('optional')})`}`,
            hint: variable.helpText,
          }, h('textarea', {
            className: 'dtp-input dtp-textarea dtp-gen-input', rows: variable.helpText ? 2 : 1,
            value: values[variable.key] ?? '', 'aria-label': variable.label ?? variable.key,
            onChange: (e) => setValues((prev) => ({ ...prev, [variable.key]: e.target.value })),
          }))),
          h('div', { className: 'dtp-actions' },
            h('button', { type: 'button', className: 'dtp-btn dtp-btn-primary', disabled: busy, onClick: generate }, t('generatePreview')),
          ),
          error ? h(Notice, { kind: 'error' }, error) : null,
          result ? h('div', { className: 'dtp-gen-result' },
            result.unfilled?.length ? h(Notice, { kind: 'info' }, t('generateUnfilled').replace('{list}', result.unfilled.map((key) => `{{${key}}}`).join(', '))) : null,
            h('div', { className: 'dtp-md dtp-md-preview' }, h('div', { dangerouslySetInnerHTML: { __html: renderMarkdown(result.document) } })),
            h('div', { className: 'dtp-actions' },
              h('button', { type: 'button', className: 'dtp-btn', onClick: () => copyText(result.document, notify, t) }, t('generateCopy')),
              h('button', { type: 'button', className: 'dtp-btn dtp-btn-primary', disabled: busy, onClick: proposePath }, t('generateSaveDocs')),
            ),
            pendingPath ? h('div', { className: 'dtp-save-confirm' },
              h('div', { className: 'dtp-save-path' }, t('generatePath').replace('{path}', pendingPath.relativePath)),
              h('div', { className: 'dtp-actions' },
                h('button', { type: 'button', className: 'dtp-btn dtp-btn-primary', disabled: busy, onClick: save }, t('generatePathConfirm')),
                h('button', { type: 'button', className: 'dtp-btn', disabled: busy, onClick: () => setPendingPath(null) }, t('cancel')),
              ),
            ) : null,
          ) : null,
        ),
      );
    }

    // -- редактор шаблона ------------------------------------------------------------

    function blankTemplate() {
      return {
        id: null,
        name: '',
        type: 'custom',
        scope: 'global',
        description: '',
        format: 'markdown',
        content: `# <Заголовок документа>\n\n<Содержимое с плейсхолдерами {{project_name}} и {{date}}.>\n`,
        variables: [],
        tags: [],
        version: '1.0.0',
        author: '',
      };
    }

    function TemplateEditor({ ctx, sessionId, t, notify, target, onClose, onSaved, types }) {
      const isNew = target.mode === 'new';
      const [state, setState] = useState({ busy: true, template: null, error: null });
      useEffect(() => {
        let live = true;
        const load = isNew ? Promise.resolve(blankTemplate()) : api(ctx, sessionId, { op: 'get', id: target.id }).then((data) => data.template);
        load.then((template) => {
          if (!live) return;
          setState({ busy: false, template: { ...template, variables: (template.variables ?? []).map((v) => ({ ...v })) }, error: null });
        }).catch((error) => live && setState({ busy: false, template: null, error: error.message }));
        return () => { live = false; };
      }, [ctx, sessionId, target]);

      // Хуки должны вызываться до любых условных return (иначе React error #310).
      const contentRef = useRef(null);
      const setField = (field, value) => setState((prev) => ({ ...prev, template: { ...prev.template, [field]: value } }));
      // Панель форматирования: обёртка выделения и префиксы строк, как в Markdown-редакторах.
      const applyFormat = useCallback((kind) => {
        const el = contentRef.current;
        if (!el) return;
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const value = el.value;
        const selected = value.slice(start, end);
        const lines = (selected || '').split('\n');
        const wrap = (mark, placeholder) => `${mark}${selected || placeholder}${mark}`;
        let insertion;
        switch (kind) {
          case 'bold': insertion = wrap('**', 'текст'); break;
          case 'italic': insertion = wrap('*', 'текст'); break;
          case 'code': insertion = wrap('`', 'код'); break;
          case 'h2': insertion = lines.map((line) => `## ${line || 'Раздел'}`).join('\n'); break;
          case 'h3': insertion = lines.map((line) => `### ${line || 'Подраздел'}`).join('\n'); break;
          case 'ul': insertion = lines.map((line) => `- ${line || 'пункт'}`).join('\n'); break;
          case 'ol': insertion = lines.map((line, i) => `${i + 1}. ${line || 'пункт'}`).join('\n'); break;
          case 'check': insertion = lines.map((line) => `- [ ] ${line || 'пункт проверки'}`).join('\n'); break;
          case 'quote': insertion = lines.map((line) => `> ${line || 'цитата'}`).join('\n'); break;
          case 'table': insertion = '| Колонка 1 | Колонка 2 |\n|---|---|\n| значение | значение |'; break;
          case 'fence': insertion = '```\n' + (selected || 'код') + '\n```'; break;
          case 'var': insertion = `{{${selected || 'имя_переменной'}}}`; break;
          case 'link': insertion = `[${selected || 'текст'}](https://)`; break;
          case 'hr': insertion = `${selected}\n---`; break;
          default: return;
        }
        const next = value.slice(0, start) + insertion + value.slice(end);
        setField('content', next);
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + insertion.length;
          el.setSelectionRange(pos, pos);
        });
      }, []);

      if (state.busy) return h(Modal, { title: t('editorNew'), onClose }, h('div', { className: 'dtp-loading' }, t('loading')));
      if (state.error) return h(Modal, { title: t('error'), onClose }, h(Notice, { kind: 'error' }, state.error));
      const template = state.template;
      const setVariable = (index, patch) => setState((prev) => ({
        ...prev,
        template: { ...prev.template, variables: prev.template.variables.map((v, i) => (i === index ? { ...v, ...patch } : v)) },
      }));
      const addVariable = () => setField('variables', [...template.variables, { key: '', label: '', required: false, defaultValue: '', helpText: '' }]);
      const removeVariable = (index) => setField('variables', template.variables.filter((_, i) => i !== index));

      const save = async () => {
        const payload = {
          ...(isNew ? {} : { id: template.id }),
          name: template.name,
          type: template.type,
          scope: template.scope,
          description: template.description,
          format: template.format,
          content: template.content,
          version: template.version || '1.0.0',
          author: template.author || undefined,
          tags: template.tags,
          variables: template.variables.filter((v) => v.key && v.key.trim()).map((v) => ({
            key: v.key.trim(),
            ...(v.label ? { label: v.label } : {}),
            ...(v.required ? { required: true } : {}),
            ...(v.defaultValue ? { defaultValue: v.defaultValue } : {}),
            ...(v.helpText ? { helpText: v.helpText } : {}),
          })),
        };
        try {
          const response = isNew
            ? await api(ctx, sessionId, { op: 'create', template: payload })
            : await api(ctx, sessionId, { op: 'update', id: target.id, patch: payload });
          notify({ kind: 'success', text: isNew ? t('created') : t('saved') });
          onSaved(response);
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };

      return h(Modal, { title: isNew ? t('editorNew') : t('editorEdit'), onClose, wide: true },
        h('div', { className: 'dtp-form' },
          h('div', { className: 'dtp-form-grid' },
            h(Field, { label: t('fieldName') }, h('input', { className: 'dtp-input', value: template.name, onChange: (e) => setField('name', e.target.value) })),
            h(Field, { label: t('fieldType') }, selectControl(t('fieldType'), template.type, types.map((type) => ({ value: type.id, label: type.label })), (v) => setField('type', v))),
          ),
          h('div', { className: 'dtp-form-grid dtp-form-grid-3' },
            h(Field, { label: t('fieldScope'), hint: template.scope === 'project' ? t('fieldProject') : undefined },
              selectControl(t('fieldScope'), template.scope, [
                { value: 'global', label: t('scopeGlobal') },
                { value: 'project', label: t('scopeProject') },
              ], (v) => setField('scope', v))),
            h(Field, { label: t('fieldFormat') }, selectControl(t('fieldFormat'), template.format, ['markdown', 'plaintext'], (v) => setField('format', v))),
            h(Field, { label: t('fieldVersion') }, h('input', { className: 'dtp-input', value: template.version ?? '', onChange: (e) => setField('version', e.target.value) })),
          ),
          h(Field, { label: t('fieldDescription') }, h('textarea', { className: 'dtp-textarea', rows: 2, value: template.description ?? '', onChange: (e) => setField('description', e.target.value) })),
          h('div', { className: 'dtp-form-grid' },
            h(Field, { label: t('fieldTags') }, h('input', { className: 'dtp-input', value: (template.tags ?? []).join(', '), onChange: (e) => setField('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) })),
            h(Field, { label: t('fieldAuthor') }, h('input', { className: 'dtp-input', value: template.author ?? '', onChange: (e) => setField('author', e.target.value) })),
          ),
          h('div', { className: 'dtp-field' },
            h('span', { className: 'dtp-field-label' }, t('fieldContent')),
            h('div', { className: 'dtp-editor-toolbar', role: 'toolbar', 'aria-label': t('editorToolbar') },
              [
                ['bold', t('tbBold'), 'B'], ['italic', t('tbItalic'), 'I'], ['code', t('tbCode'), '‹›'],
                null,
                ['h2', t('tbH2'), 'H2'], ['h3', t('tbH3'), 'H3'],
                null,
                ['ul', t('tbUl'), '• —'], ['ol', t('tbOl'), '1. —'], ['check', t('tbCheck'), '☑'],
                null,
                ['quote', t('tbQuote'), '❝'], ['table', t('tbTable'), '▦'], ['fence', t('tbFence'), '{ }'],
                null,
                ['var', t('tbVar'), '{{ }}'], ['link', t('tbLink'), '🔗'], ['hr', t('tbHr'), '—'],
              ].map((item, index) => item === null
                ? h('span', { key: `sep${index}`, className: 'dtp-tb-sep', 'aria-hidden': true })
                : h('button', {
                    key: item[0], type: 'button', className: 'dtp-tb-btn',
                    title: item[1], 'aria-label': item[1],
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => applyFormat(item[0]),
                  }, item[2])),
            ),
            h('textarea', { className: 'dtp-textarea dtp-mono', rows: 14, value: template.content, onChange: (e) => setField('content', e.target.value), spellCheck: false, ref: contentRef }),
          ),
          h('div', { className: 'dtp-section-title' }, t('variablesEditor')),
          template.variables.map((variable, index) => h('div', { key: index, className: 'dtp-var-row' },
            h('input', { className: 'dtp-input', placeholder: t('varKey'), value: variable.key ?? '', 'aria-label': t('varKey'), onChange: (e) => setVariable(index, { key: e.target.value }) }),
            h('input', { className: 'dtp-input', placeholder: t('varLabel'), value: variable.label ?? '', 'aria-label': t('varLabel'), onChange: (e) => setVariable(index, { label: e.target.value }) }),
            h('label', { className: 'dtp-check' },
              h('input', { type: 'checkbox', checked: Boolean(variable.required), 'aria-label': t('varRequired'), onChange: (e) => setVariable(index, { required: e.target.checked }) }),
              t('varRequired'),
            ),
            h('input', { className: 'dtp-input', placeholder: t('varDefault'), value: variable.defaultValue ?? '', 'aria-label': t('varDefault'), onChange: (e) => setVariable(index, { defaultValue: e.target.value }) }),
            h('input', { className: 'dtp-input', placeholder: t('varHelp'), value: variable.helpText ?? '', 'aria-label': t('varHelp'), onChange: (e) => setVariable(index, { helpText: e.target.value }) }),
            h('button', { type: 'button', className: 'dtp-btn dtp-btn-ghost', onClick: () => removeVariable(index), 'aria-label': t('varRemove').replace('{key}', variable.key ?? String(index + 1)) }, '×'),
          )),
          h('div', { className: 'dtp-actions' },
            h('button', { type: 'button', className: 'dtp-btn', onClick: addVariable }, t('varAdd')),
          ),
          h('div', { className: 'dtp-actions' },
            h('button', { type: 'button', className: 'dtp-btn dtp-btn-primary', onClick: save }, t('save')),
            h('button', { type: 'button', className: 'dtp-btn', onClick: onClose }, t('cancel')),
          ),
        ),
      );
    }

    // -- импорт / экспорт ------------------------------------------------------------

    function ImportExportDialog({ ctx, sessionId, t, notify, selectedIds, onClose, onDone }) {
      const [tab, setTab] = useState('json');
      const [exported, setExported] = useState('');
      const [importText, setImportText] = useState('');
      const [importFile, setImportFile] = useState(null); // { name, content }
      const [strategy, setStrategy] = useState('merge');
      const [confirmOverwrite, setConfirmOverwrite] = useState(false);
      const [preview, setPreview] = useState(null);
      const [mdMeta, setMdMeta] = useState({ name: '', type: 'custom', scope: 'global' });
      const [storeStatus, setStoreStatus] = useState(null);
      const fileRef = useRef(null);
      const mdRef = useRef(null);

      const exportAll = async () => {
        try {
          const response = await api(ctx, sessionId, { op: 'export', all: true });
          setExported(JSON.stringify(response.document, null, 2));
          downloadText(JSON.stringify(response.document, null, 2), 'doc-templates-export.json');
        } catch (error) { notify({ kind: 'error', text: error.message }); }
      };
      const exportSelected = async () => {
        if (!selectedIds?.length) return;
        try {
          const response = await api(ctx, sessionId, { op: 'export', ids: selectedIds });
          setExported(JSON.stringify(response.document, null, 2));
          downloadText(JSON.stringify(response.document, null, 2), 'doc-templates-export-selected.json');
        } catch (error) { notify({ kind: 'error', text: error.message }); }
      };
      const loadStatus = useCallback(() => {
        api(ctx, sessionId, { op: 'status' }).then(setStoreStatus).catch(() => setStoreStatus(null));
      }, [ctx, sessionId]);
      useEffect(() => { loadStatus(); }, [loadStatus]);

      const doPreview = async () => {
        setPreview(null);
        try {
          const response = await api(ctx, sessionId, { op: 'import', document: importText, strategy });
          setPreview(response);
        } catch (error) { notify({ kind: 'error', text: error.message }); }
      };
      const doApply = async () => {
        try {
          const response = await api(ctx, sessionId, { op: 'import', document: importText, strategy, apply: true, confirmOverwrite });
          setPreview(null);
          setImportText('');
          notify({ kind: 'success', text: `${t('importApply')}: ${response.outcomes?.length ?? 0}` });
          onDone?.();
        } catch (error) { notify({ kind: 'error', text: error.message }); }
      };

      const readMdFile = (file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const content = String(reader.result ?? '');
          setImportFile({ name: file.name, content });
          setMdMeta((prev) => ({ ...prev, name: prev.name || file.name.replace(/\.(md|markdown|txt)$/i, '') }));
        };
        reader.readAsText(file);
      };
      const createFromMd = async () => {
        try {
          await api(ctx, sessionId, {
            op: 'create',
            template: {
              name: mdMeta.name || importFile.name.replace(/\.(md|markdown|txt)$/i, ''),
              type: mdMeta.type,
              scope: mdMeta.scope,
              content: importFile.content,
              description: `Импортировано из файла ${importFile.name}`,
              format: 'markdown',
            },
          });
          notify({ kind: 'success', text: t('created') });
          setImportFile(null);
          onDone?.();
        } catch (error) { notify({ kind: 'error', text: error.message }); }
      };

      const restore = async (file) => {
        try {
          const response = await api(ctx, sessionId, { op: 'restore-backup', ...(file ? { backup: file } : {}) });
          if (response.ok) {
            notify({ kind: 'success', text: t('restored') });
            loadStatus();
            onDone?.();
          } else notify({ kind: 'error', text: response.error });
        } catch (error) { notify({ kind: 'error', text: error.message }); }
      };

      const actions = preview?.diff ?? [];
      const needsConfirmation = actions.some((entry) => entry.action === 'update');

      return h(Modal, { title: t('transferTitle'), onClose, wide: true },
        h('div', { className: 'dtp-tabs', role: 'tablist', 'aria-label': t('transferTitle') },
          ['json', 'md'].map((key) => h('button', {
            key, type: 'button', role: 'tab', 'aria-selected': tab === key,
            className: `dtp-tab${tab === key ? ' dtp-tab-active' : ''}`,
            onClick: () => setTab(key),
          }, key === 'json' ? t('importJson') : t('importMd'))),
        ),
        tab === 'json' ? h('div', { className: 'dtp-transfer' },
          h('div', { className: 'dtp-section-title' }, t('transferTitle') + ' — экспорт'),
          h('div', { className: 'dtp-actions' },
            h('button', { type: 'button', className: 'dtp-btn', onClick: exportAll }, t('exportAll')),
            h('button', { type: 'button', className: 'dtp-btn', disabled: !selectedIds?.length, onClick: exportSelected }, t('exportSelected')),
          ),
          exported ? h('textarea', { className: 'dtp-textarea dtp-mono', rows: 6, readOnly: true, value: exported, onFocus: (e) => e.target.select(), 'aria-label': t('exportAll') }) : null,
          h('div', { className: 'dtp-section-title' }, t('importJson')),
          h('div', { className: 'dtp-actions' },
            h('button', { type: 'button', className: 'dtp-btn', onClick: () => fileRef.current?.click() }, t('chooseFile')),
            h('input', { ref: fileRef, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: (e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setImportText(String(reader.result ?? '')); reader.readAsText(file); } }),
            selectControl(t('importStrategy'), strategy, [
              { value: 'merge', label: t('strategyMerge') },
              { value: 'overwrite', label: t('strategyOverwrite') },
              { value: 'skip-existing', label: t('strategySkip') },
              { value: 'create-copy', label: t('strategyCopy') },
            ], setStrategy),
          ),
          h('textarea', { className: 'dtp-textarea dtp-mono', rows: 8, placeholder: t('importPlaceholder'), value: importText, onChange: (e) => setImportText(e.target.value) }),
          h('label', { className: 'dtp-check' },
            h('input', { type: 'checkbox', checked: confirmOverwrite, onChange: (e) => setConfirmOverwrite(e.target.checked) }),
            t('importConfirmOverwrite'),
          ),
          h('div', { className: 'dtp-actions' },
            h('button', { type: 'button', className: 'dtp-btn', disabled: !importText.trim(), onClick: doPreview }, t('importPreview')),
            h('button', { type: 'button', className: 'dtp-btn dtp-btn-primary', disabled: !importText.trim(), onClick: doApply }, t('importApply')),
          ),
          needsConfirmation && !confirmOverwrite ? h(Notice, { kind: 'error' }, t('importOverwriteWarning')) : null,
          actions.length ? h('div', { className: 'dtp-list' }, actions.map((entry) => h('div', { key: entry.id, className: 'dtp-row' },
            h('div', { className: 'dtp-row-main' },
              h('div', { className: 'dtp-row-title' },
                h('span', { className: 'dtp-mono' }, entry.id),
                h('span', { className: `dtp-badge ${entry.action === 'create' || entry.action === 'type-create' ? 'dtp-badge-ok' : entry.action === 'update' ? 'dtp-badge-warn' : 'dtp-badge-dim'}` },
                  entry.action === 'type-create' ? t('actionTypeCreate') : t(`action${entry.action.charAt(0).toUpperCase()}${entry.action.slice(1)}`)),
                h('span', { className: 'dtp-dim' }, entry.name),
              ),
              entry.changes?.length ? h('div', { className: 'dtp-row-desc' }, entry.changes.join(', ')) : null,
            ),
          ))) : null,
          h('div', { className: 'dtp-section-title' }, t('storageTitle')),
          storeStatus ? h('div', { className: 'dtp-kv' },
            h('div', null, h('span', { className: 'dtp-kv-key' }, t('storageDir')), h('span', { className: 'dtp-mono' }, `${storeStatus.store?.directoryEnv ?? ''}/${storeStatus.store?.fileName ?? 'templates.json'}`)),
            h('div', null, h('span', { className: 'dtp-kv-key' }, t('storageSchema')), h('span', null, String(storeStatus.store?.schemaVersion ?? '?'))),
            h('div', null, h('span', { className: 'dtp-kv-key' }, t('storageTemplates')), h('span', null, String(storeStatus.store?.document?.templates ?? 0))),
            h('div', null, h('span', { className: 'dtp-kv-key' }, t('storageBackups')),
              (storeStatus.backups ?? []).length
                ? h('span', { className: 'dtp-mono' }, storeStatus.backups.join(', '))
                : h('span', { className: 'dtp-dim' }, t('noBackups'))),
            (storeStatus.backups ?? []).length ? h('div', { className: 'dtp-actions' },
              h('button', { type: 'button', className: 'dtp-btn', onClick: () => restore(storeStatus.backups[0]) }, t('restore')),
            ) : null,
          ) : h('div', { className: 'dtp-actions' }, h('button', { type: 'button', className: 'dtp-btn', onClick: loadStatus }, t('status'))),
        ) : h('div', { className: 'dtp-transfer' },
          h('div', { className: 'dtp-section-title' }, t('importMdTitle')),
          h('div', { className: 'dtp-dim' }, t('importMdHint')),
          h('div', { className: 'dtp-actions' },
            h('button', { type: 'button', className: 'dtp-btn', onClick: () => mdRef.current?.click() }, t('chooseFile')),
            h('input', { ref: mdRef, type: 'file', accept: '.md,.markdown,.txt,text/plain', style: { display: 'none' }, onChange: (e) => { const file = e.target.files?.[0]; if (file) readMdFile(file); } }),
          ),
          importFile ? h('div', { className: 'dtp-form' },
            h('div', { className: 'dtp-form-grid dtp-form-grid-3' },
              h(Field, { label: t('importMdName') }, h('input', { className: 'dtp-input', value: mdMeta.name, onChange: (e) => setMdMeta((prev) => ({ ...prev, name: e.target.value })) })),
              h(Field, { label: t('importMdType') }, selectControl(t('importMdType'), mdMeta.type, TYPES.map((type) => ({ value: type, label: TYPE_LABELS[type] })), (v) => setMdMeta((prev) => ({ ...prev, type: v })))),
              h(Field, { label: t('importMdScope') }, selectControl(t('importMdScope'), mdMeta.scope, [
                { value: 'global', label: t('scopeGlobal') },
                { value: 'project', label: t('scopeProject') },
              ], (v) => setMdMeta((prev) => ({ ...prev, scope: v })))),
            ),
            h('div', { className: 'dtp-md dtp-md-preview dtp-md-compact' }, h('div', { dangerouslySetInnerHTML: { __html: renderMarkdown(importFile.content.slice(0, 4000)) } })),
            h('div', { className: 'dtp-actions' },
              h('button', { type: 'button', className: 'dtp-btn dtp-btn-primary', onClick: createFromMd }, t('importMdCreate')),
            ),
          ) : null,
        ),
      );
    }

    // -- управление типами документации ---------------------------------------------------

    function TypesDialog({ ctx, sessionId, t, notify, types, onClose, onChanged }) {
      const [label, setLabel] = useState('');
      const [renaming, setRenaming] = useState(null); // { id, label }
      const [confirmDelete, setConfirmDelete] = useState(null);
      const builtin = types.filter((type) => type.builtin);
      const custom = types.filter((type) => !type.builtin);

      const run = async (args, message) => {
        try {
          const response = await api(ctx, sessionId, args);
          if (response.ok) {
            notify({ kind: 'success', text: message });
            setRenaming(null);
            onChanged?.();
          } else {
            notify({ kind: 'error', text: response.error });
          }
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };

      return h('div', null,
        h('div', { className: 'dtp-dim' }, t('typesNote')),
        h('div', { className: 'dtp-section-title' }, t('typesBuiltin')),
        builtin.map((type) => h('div', { key: type.id, className: 'dtp-types-row' },
          h('span', { className: 'dtp-badge dtp-badge-type' }, type.label),
          h('span', { className: 'dtp-mono dtp-dim' }, type.id),
          h('span', { className: 'dtp-dim' }, t('typeBuiltinTag')),
        )),
        h('div', { className: 'dtp-section-title' }, t('typesCustom')),
        custom.length === 0 ? h('div', { className: 'dtp-dim' }, t('empty')) : null,
        custom.map((type) => h('div', { key: type.id, className: 'dtp-types-row' },
          renaming?.id === type.id ? h('input', {
            className: 'dtp-input', value: renaming.label, 'aria-label': t('typeRename'),
            onChange: (e) => setRenaming({ id: type.id, label: e.target.value }),
            onKeyDown: (e) => { if (e.key === 'Enter') run({ op: 'type-update', id: type.id, label: renaming.label }, t('typeSaveRename')); },
          }) : h('span', { className: 'dtp-badge dtp-badge-type' }, type.label),
          renaming?.id === type.id ? null : h('span', { className: 'dtp-mono dtp-dim' }, type.id),
          renaming?.id === type.id
            ? h('button', { type: 'button', className: 'dtp-btn dtp-btn-primary', onClick: () => run({ op: 'type-update', id: type.id, label: renaming.label }, t('typeSaveRename')) }, t('typeSaveRename'))
            : h('button', { type: 'button', className: 'dtp-btn', onClick: () => setRenaming({ id: type.id, label: type.label }) }, t('typeRename')),
          h('button', { type: 'button', className: 'dtp-btn dtp-btn-danger', onClick: () => setConfirmDelete(type) }, t('typeDelete')),
        )),
        h('div', { className: 'dtp-form-grid' },
          h(Field, { label: t('typeAddLabel') }, h('input', {
            className: 'dtp-input', value: label, placeholder: t('typeAddLabel'),
            onChange: (e) => setLabel(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter' && label.trim()) { run({ op: 'type-add', label }, t('typeAdd')); setLabel(''); } },
          })),
          h('div', { className: 'dtp-actions', style: { alignItems: 'flex-end' } },
            h('button', {
              type: 'button', className: 'dtp-btn dtp-btn-primary', disabled: !label.trim(),
              onClick: () => { run({ op: 'type-add', label }, t('typeAdd')); setLabel(''); },
            }, t('typeAdd')),
          ),
        ),
        confirmDelete ? h(Confirm, {
          title: t('typeDelete'),
          body: `«${confirmDelete.label}» (${confirmDelete.id})`,
          actionLabel: t('typeDelete'),
          onClose: () => setConfirmDelete(null),
          onConfirm: () => run({ op: 'type-delete', id: confirmDelete.id }, t('typeDelete')),
        }) : null,
      );
    }

    // -- главная панель -----------------------------------------------------------------

    /** Граница ошибок: сбой внутри панели не скрывает её целиком, а показывает сообщение. */
    class PanelErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      render() {
        if (this.state.error) {
          return h('div', { className: 'dtp-panel' },
            h('div', { className: 'dtp-body' },
              h(Notice, { kind: 'error' }, `${t_or_error_label()}: ${this.state.error?.message ?? String(this.state.error)}`),
              h('button', { type: 'button', className: 'dtp-btn', onClick: () => this.setState({ error: null }) }, '↺'),
            ),
          );
        }
        return this.props.children;
      }
    }
    const t_or_error_label = () => 'Ошибка интерфейса панели — нажмите ↺, чтобы продолжить';

    function DocTemplatesPanel(props) {
      const t = props.t;
      const ctx = props.ctx;
      const [filters, setFilters] = useState({ query: '', type: '', scope: '', tag: '' });
      const [sort, setSort] = useState({ by: 'name', direction: 'asc' });
      const [view, setView] = useState(null); // { kind, ... }
      const [menuRow, setMenuRow] = useState(null);
      const [notice, setNotice] = useState(null);
      const notify = useCallback((value) => {
        setNotice(value);
        if (value.kind !== 'error') setTimeout(() => setNotice((current) => (current === value ? null : current)), 4000);
      }, []);

      const sessionsState = props.useSessions?.((state) => state) ?? null;
      const sessionId = useMemo(() => {
        const byId = sessionsState?.byId ?? {};
        const main = Object.values(byId).find((session) => (session.retainedBy?.mainView ?? 0) > 0);
        return main?.id ?? null;
      }, [sessionsState]);

      const [listState, reload] = useAsync(() => {
        if (!sessionId) return Promise.resolve({ ok: true, rows: [], tags: [] });
        return api(ctx, sessionId, {
          op: 'list',
          query: filters.query || undefined,
          type: filters.type || undefined,
          scope: filters.scope || undefined,
          tag: filters.tag || undefined,
          sort: sort.by,
          direction: sort.direction,
        });
      }, [sessionId, filters.query, filters.type, filters.scope, filters.tag, sort.by, sort.direction]);

      const rows = listState.data?.rows ?? [];
      const tags = listState.data?.tags ?? [];
      const types = listState.data?.types ?? BASE_TYPES.map((id) => ({ id, label: TYPE_LABELS[id], builtin: true }));
      const selectedIds = rows.filter((row) => !row.builtin).map((row) => row.id);

      const closeMenu = useCallback(() => setMenuRow(null), []);
      useEffect(() => {
        if (!menuRow) return;
        const onDoc = (event) => {
          if (!event.target.closest?.('.dtp-menu-wrap')) closeMenu();
        };
        document.addEventListener('pointerdown', onDoc);
        return () => document.removeEventListener('pointerdown', onDoc);
      }, [menuRow, closeMenu]);

      const mutate = async (args, message) => {
        try {
          await api(ctx, sessionId, args);
          notify({ kind: 'success', text: message });
          await reload();
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };

      const onRowActivate = async (row, action) => {
        if (action === 'duplicate') {
          closeMenu();
          await mutate({ op: 'duplicate', id: row.id }, t('duplicated'));
          return;
        }
        if (action === 'delete') {
          closeMenu();
          setView({ kind: 'confirm-delete', row });
          return;
        }
        if (action === 'export') {
          closeMenu();
          api(ctx, sessionId, { op: 'export', ids: [row.id] })
            .then((response) => downloadText(JSON.stringify(response.document, null, 2), `${row.name || row.id}.json`))
            .catch((error) => notify({ kind: 'error', text: error.message }));
          return;
        }
        // Просмотр и генерация требуют полного шаблона (содержимое, переменные).
        try {
          const full = await api(ctx, sessionId, { op: 'get', id: row.id });
          setView(action === 'generate' ? { kind: 'generate', row: full.template } : { kind: 'preview', row: full.template });
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };
      const onActions = (row) => setMenuRow(row ? { id: row.id } : null);

      const closeView = () => setView(null);
      const previewTemplate = view?.kind === 'preview' ? view.row : null;

      return h(PanelErrorBoundary, null,
        h('div', { className: 'dtp-panel' },
        h('div', { className: 'dtp-header' },
          h('div', { className: 'dtp-title' }, t('title')),
          h('div', { className: 'dtp-toolbar' },
            h('span', { className: 'dtp-dim' }, t('count').replace('{count}', String(rows.length))),
            h('div', { className: 'dtp-toolbar-spacer' }),
            h('button', { type: 'button', className: 'dtp-btn', onClick: () => setView({ kind: 'types' }) }, t('typesButton')),
            h('button', { type: 'button', className: 'dtp-btn', onClick: () => setView({ kind: 'transfer' }) }, t('importExport')),
            h('button', { type: 'button', className: 'dtp-btn dtp-btn-primary', onClick: () => setView({ kind: 'editor-new' }) }, t('newTemplate')),
          ),
        ),
        !sessionId ? h('div', { className: 'dtp-body' }, h(Notice, { kind: 'info' }, t('noSession'))) : h('div', { className: 'dtp-body' },
          notice ? h(Notice, { kind: notice.kind, onClose: () => setNotice(null) }, notice.text) : null,
          rows.some((row) => row.readonly) ? h('div', { className: 'dtp-dim dtp-readonly-note' }, t('readonlyNote')) : null,
          h(TemplateList, {
            t, rows, tags, types, filters, setFilters, sort, setSort,
            onActions, actions: menuRow, onRowActivate,
            busy: listState.busy, error: listState.error, reload,
          }),
        ),
        previewTemplate ? h(TemplatePreview, { ctx, sessionId, t, notify, template: previewTemplate, onClose: closeView }) : null,
        view?.kind === 'generate' ? h(GenerateDocumentForm, { ctx, sessionId, t, notify, template: rows.find((row) => row.id === view.row.id) ?? view.row, onClose: closeView }) : null,
        view?.kind === 'editor' ? h(TemplateEditor, { ctx, sessionId, t, notify, target: { mode: 'edit', id: view.row.id }, types, onClose: closeView, onSaved: () => { closeView(); reload(); } }) : null,
        view?.kind === 'editor-new' ? h(TemplateEditor, { ctx, sessionId, t, notify, target: { mode: 'new' }, types, onClose: closeView, onSaved: () => { closeView(); reload(); } }) : null,
        view?.kind === 'types' ? h(Modal, { title: t('typesTitle'), onClose: closeView, wide: true },
          h(TypesDialog, { ctx, sessionId, t, notify, types, onClose: closeView, onChanged: reload }),
        ) : null,
        view?.kind === 'transfer' ? h(ImportExportDialog, { ctx, sessionId, t, notify, selectedIds, onClose: closeView, onDone: reload }) : null,
        view?.kind === 'confirm-delete' ? h(Confirm, {
          title: t('deleteConfirmTitle'),
          body: t('deleteConfirmBody').replace('{name}', view.row.name),
          actionLabel: t('deleteConfirmYes'),
          onClose: closeView,
          onConfirm: () => mutate({ op: 'delete', id: view.row.id }, t('deleted')),
        }) : null,
        ),
      );
    }

    // -- стили ---------------------------------------------------------------------------

    const STYLES = `
    .dtp-panel{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fbfcfd);color:var(--dsw-alias-label-primary,#1c1d21);font-size:13px;line-height:1.45;overflow:hidden}
    .dtp-header{padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#dcdee2)}
    [data-platform=darwin] .dtp-header{padding-top:calc(16px + var(--dsh-frame-top-clearance,0px))}
    .dtp-title{font-size:18px;font-weight:600;margin-bottom:10px}
    .dtp-body{flex:1;overflow:auto;padding:12px 20px 20px}
    .dtp-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
    .dtp-toolbar-spacer{flex:1}
    .dtp-input{background:var(--dsw-alias-bg-layer-1,#f2f3f5);border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-radius:8px;color:var(--dsw-alias-label-primary,#1c1d21);padding:6px 10px;font:inherit;min-width:0}
    .dtp-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4a6bdf)}
    .dtp-search{flex:1;min-width:160px;max-width:340px}
    .dtp-select{max-width:220px}
    .dtp-btn{appearance:none;background:var(--dsw-alias-button-tool-bar-fill,var(--dsw-alias-bg-layer-1,#f2f3f5));border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-radius:8px;color:var(--dsw-alias-label-primary,#1c1d21);padding:5px 12px;font:inherit;cursor:pointer}
    .dtp-btn:hover{background:var(--dsw-alias-button-tool-bar-hover,var(--dsw-alias-bg-layer-2,#e9eaec))}
    .dtp-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a6bdf);outline-offset:1px}
    .dtp-btn:disabled{opacity:.5;cursor:default}
    .dtp-btn-primary{background:var(--dsw-alias-button-primary-fill,#4a6bdf);border-color:transparent;color:var(--dsw-alias-brand-text,#fff)}
    .dtp-btn-primary:hover{background:var(--dsw-alias-button-primary-hover,#3d5cc9)}
    .dtp-btn-danger{background:var(--dsw-alias-state-error-primary,#d5484d);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}
    .dtp-btn-ghost{border-color:transparent;background:transparent}
    .dtp-listwrap{display:flex;flex-direction:column}
    .dtp-group{margin-bottom:14px}
    .dtp-group-title{font-weight:600;color:var(--dsw-alias-label-secondary,#6c7079);margin:8px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
    .dtp-list{display:flex;flex-direction:column;gap:6px}
    .dtp-row{display:flex;gap:8px;align-items:stretch;background:var(--dsw-alias-bg-layer-1,#f2f3f5);border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-radius:10px;padding:4px}
    .dtp-row-main{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;text-align:left;appearance:none;background:none;border:none;color:inherit;font:inherit;padding:8px 10px;cursor:pointer;border-radius:8px}
    .dtp-row-main:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a6bdf);outline-offset:-2px}
    .dtp-row-name{font-weight:600}
    .dtp-row-desc{color:var(--dsw-alias-label-secondary,#6c7079);flex-basis:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .dtp-row-tags{display:flex;gap:4px;flex-wrap:wrap}
    .dtp-tag{border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-radius:999px;padding:0 8px;font-size:11px;color:var(--dsw-alias-label-secondary,#6c7079)}
    .dtp-row-meta{display:flex;gap:10px}
    .dtp-row-actions{display:flex;gap:4px;align-items:center}
    .dtp-badge{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;background:var(--dsw-alias-bg-layer-2,#e9eaec);border:1px solid var(--dsw-alias-border-l1,#dcdee2);color:var(--dsw-alias-label-secondary,#6c7079);white-space:nowrap}
    .dtp-badge-type{color:var(--dsw-alias-label-primary-bluish,#3050a0);border-color:currentColor;background:transparent}
    .dtp-badge-info{color:var(--dsw-alias-state-warn-label,#a06a00);border-color:currentColor;background:transparent}
    .dtp-badge-ok{color:var(--dsw-alias-state-success-primary,#2f9e5f);border-color:currentColor;background:transparent}
    .dtp-badge-warn{color:var(--dsw-alias-state-warn-primary,#c47f17);border-color:currentColor;background:transparent}
    .dtp-badge-dim{opacity:.8}
    .dtp-dim{color:var(--dsw-alias-label-secondary,#6c7079);font-size:12px}
    .dtp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
    .dtp-menu-wrap{position:relative}
    .dtp-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:200px;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#c9ccd2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;display:flex;flex-direction:column}
    .dtp-menu-item{appearance:none;background:none;border:none;text-align:left;color:var(--dsw-alias-label-primary,#1c1d21);padding:7px 10px;border-radius:6px;font:inherit;cursor:pointer;white-space:nowrap}
    .dtp-menu-item:hover{background:var(--dsw-alias-bg-layer-2,#e9eaec)}
    .dtp-menu-danger{color:var(--dsw-alias-state-error-primary,#d5484d)}
    .dtp-modal-backdrop{position:fixed;inset:0;z-index:80;background:var(--dsw-alias-bg-mask-1,rgba(15,18,24,.45));display:flex;align-items:center;justify-content:center;padding:16px}
    .dtp-modal{background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#1c1d21);border:1px solid var(--dsw-alias-border-l2,#c9ccd2);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.22);width:560px;max-width:100%;max-height:92vh;display:flex;flex-direction:column}
    .dtp-modal-wide{width:920px}
    .dtp-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,#dcdee2)}
    .dtp-modal-title{font-weight:600;font-size:15px}
    .dtp-modal-body{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px}
    .dtp-field{display:flex;flex-direction:column;gap:4px;min-width:0}
    .dtp-field-label{font-size:12px;color:var(--dsw-alias-label-secondary,#6c7079)}
    .dtp-field-hint{font-size:11px;color:var(--dsw-alias-label-secondary,#6c7079)}
    .dtp-textarea{width:100%;background:var(--dsw-alias-bg-layer-1,#f2f3f5);border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-radius:8px;color:var(--dsw-alias-label-primary,#1c1d21);padding:8px 10px;font:inherit;resize:vertical}
    .dtp-textarea:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4a6bdf)}
    .dtp-mono.dtp-textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre;overflow-x:auto}
    .dtp-form{display:flex;flex-direction:column;gap:12px}
    .dtp-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .dtp-form-grid-3{grid-template-columns:2fr 1.4fr 1fr}
    .dtp-var-row{display:grid;grid-template-columns:minmax(110px,.8fr) minmax(130px,1fr) 110px minmax(110px,.9fr) minmax(110px,1fr) 32px;gap:6px;align-items:center}
    @media (max-width:720px){.dtp-var-row{grid-template-columns:1fr 1fr;}.dtp-form-grid,.dtp-form-grid-3{grid-template-columns:1fr}}
    .dtp-section-title{font-weight:600;margin:6px 0}
    .dtp-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .dtp-check{display:inline-flex;gap:6px;align-items:center;color:var(--dsw-alias-label-secondary,#6c7079)}
    .dtp-notice{display:flex;gap:8px;align-items:flex-start;border-radius:10px;padding:8px 12px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l1,#dcdee2);background:var(--dsw-alias-bg-layer-1,#f2f3f5)}
    .dtp-notice-error{border-color:var(--dsw-alias-state-error-primary,#d5484d);color:var(--dsw-alias-state-error-primary,#d5484d)}
    .dtp-notice-success{border-color:var(--dsw-alias-state-success-primary,#2f9e5f)}
    .dtp-notice-text{flex:1}
    .dtp-notice-close{padding:0 4px}
    .dtp-loading{color:var(--dsw-alias-label-secondary,#6c7079);padding:16px 0}
    .dtp-empty{color:var(--dsw-alias-label-secondary,#6c7079);padding:24px 0;text-align:center}
    .dtp-confirm-body{color:var(--dsw-alias-label-primary,#1c1d21)}
    .dtp-kv{display:flex;flex-direction:column;gap:6px}
    .dtp-kv-key{display:inline-block;min-width:180px;color:var(--dsw-alias-label-secondary,#6c7079)}
    .dtp-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1,#dcdee2);margin-bottom:4px}
    .dtp-tab{appearance:none;background:none;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary,#6c7079);padding:8px 12px;font:inherit;cursor:pointer}
    .dtp-tab-active{color:var(--dsw-alias-label-primary,#1c1d21);border-bottom-color:var(--dsw-alias-state-business-primary,#4a6bdf);font-weight:600}
    .dtp-preview-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .dtp-ph-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .dtp-ph-code,.dtp-code{background:var(--dsw-alias-bg-layer-2,#e9eaec);border-radius:6px;padding:1px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
    mark.dtp-ph{background:var(--dsw-alias-state-business-primary,#4a6bdf);color:var(--dsw-alias-label-primary-inverted,#fff);border-radius:4px;padding:0 4px}
    .dtp-md{border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-radius:10px;padding:14px 16px;overflow:auto;background:var(--dsw-alias-bg-base,#fbfcfd)}
    .dtp-md-preview > div > :first-child{margin-top:0}
    .dtp-md .dtp-h1,.dtp-md .dtp-h2{border-bottom:1px solid var(--dsw-alias-border-l1,#dcdee2);padding-bottom:4px}
    .dtp-md .dtp-p{margin:.5em 0}
    .dtp-md .dtp-list{margin:.4em 0 .4em 1.2em;display:block;gap:0}
    .dtp-md .dtp-list li{margin:.2em 0;list-style:disc}
    .dtp-md ol.dtp-list li{list-style:decimal}
    .dtp-md .dtp-check{display:flex;align-items:flex-start;gap:8px;color:inherit}
    .dtp-md .dtp-check-box{display:inline-flex;width:16px;height:16px;min-width:16px;border:1.5px solid var(--dsw-alias-border-l2,#c9ccd2);border-radius:4px;align-items:center;justify-content:center;font-size:12px;margin-top:2px}
    .dtp-md .dtp-check-on .dtp-check-box{background:var(--dsw-alias-state-business-primary,#4a6bdf);border-color:var(--dsw-alias-state-business-primary,#4a6bdf);color:var(--dsw-alias-label-primary-inverted,#fff)}
    .dtp-md .dtp-table{border-collapse:collapse;width:100%;margin:.6em 0;font-size:12.5px}
    .dtp-md .dtp-table th,.dtp-md .dtp-table td{border:1px solid var(--dsw-alias-border-l1,#dcdee2);padding:5px 8px;text-align:left}
    .dtp-md .dtp-table th{background:var(--dsw-alias-bg-layer-2,#e9eaec)}
    .dtp-md .dtp-quote{border-left:3px solid var(--dsw-alias-border-l2,#c9ccd2);margin:.5em 0;padding:.2em .8em;color:var(--dsw-alias-label-secondary,#6c7079)}
    .dtp-md .dtp-hr{border:none;border-top:1px solid var(--dsw-alias-border-l1,#dcdee2);margin:1em 0}
    .dtp-md pre.dtp-code{display:block;padding:10px 12px;overflow:auto;margin:.6em 0}
    .dtp-md pre.dtp-code code{background:none;padding:0}
    .dtp-md .dtp-code-mermaid{border-left:3px solid var(--dsw-alias-state-business-primary,#4a6bdf)}
    .dtp-save-confirm{border:1px solid var(--dsw-alias-state-business-primary,#4a6bdf);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
    .dtp-save-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
    .dtp-readonly-note{margin-bottom:8px}
    .dtp-md-compact{max-height:260px}
    .dtp-editor-toolbar{display:flex;gap:4px;align-items:center;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-bottom:none;border-radius:8px 8px 0 0;padding:4px 6px;background:var(--dsw-alias-bg-layer-2,#e9eaec)}
    .dtp-tb-btn{appearance:none;background:transparent;border:none;border-radius:6px;color:var(--dsw-alias-label-primary,#1c1d21);font:inherit;font-size:12px;padding:3px 8px;cursor:pointer;min-width:26px}
    .dtp-tb-btn:hover{background:var(--dsw-alias-bg-base,#fbfcfd)}
    .dtp-tb-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a6bdf)}
    .dtp-tb-sep{width:1px;height:18px;background:var(--dsw-alias-border-l2,#c9ccd2);margin:0 2px}
    .dtp-editor-toolbar + .dtp-textarea{border-radius:0 0 8px 8px}
    .dtp-types-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-radius:8px;padding:6px 10px}
    /* Светлая тема: белые поверхности вместо серых заливок и синяя основная кнопка
       (в светлой теме токен button-primary-fill почти белый — использовать его нельзя). */
    body:not([data-ds-dark-theme]) .dtp-btn{background:#fff}
    body:not([data-ds-dark-theme]) .dtp-btn:hover{background:#f2f4f8}
    body:not([data-ds-dark-theme]) .dtp-btn-ghost{background:transparent}
    body:not([data-ds-dark-theme]) .dtp-btn-ghost:hover{background:#f2f4f8}
    body:not([data-ds-dark-theme]) .dtp-btn-primary{background:var(--dsw-alias-state-business-primary,#4176e6);border-color:transparent;color:#fff}
    body:not([data-ds-dark-theme]) .dtp-btn-primary:hover{background:#3563c9}
    body:not([data-ds-dark-theme]) .dtp-row,body:not([data-ds-dark-theme]) .dtp-input,body:not([data-ds-dark-theme]) .dtp-textarea,body:not([data-ds-dark-theme]) .dtp-notice,body:not([data-ds-dark-theme]) .dtp-modal,body:not([data-ds-dark-theme]) .dtp-menu,body:not([data-ds-dark-theme]) .dtp-md,body:not([data-ds-dark-theme]) .dtp-types-row,body:not([data-ds-dark-theme]) .dtp-save-confirm{background:#fff}
    body:not([data-ds-dark-theme]) .dtp-tb-btn:hover{background:#eef1f6}
    body[data-ds-dark-theme] .dtp-btn-primary{color:var(--dsw-alias-brand-text,#f9fafb)}
    `;

    // Стили панели внедряются так же, как в официальных клиентских плагинах DSH:
    // <style data-plugin data-plugin-css> в document.head на materialization фабрики —
    // тогда система клиентских модулей «забирает» стиль себе и убирает при выгрузке плагина.
    const CSS_TAG_ID = '@local/doc-templates-panel/panel.css';
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
      const styleTag = document.createElement('style');
      styleTag.dataset.plugin = '@local/doc-templates-panel';
      styleTag.dataset.pluginCss = CSS_TAG_ID;
      styleTag.textContent = STYLES;
      document.head.appendChild(styleTag);
    }

    // -- иконка панели (нейтральный документ с галочкой) ---------------------------------

    function PanelGlyph({ size = 18 }) {
      return h('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 4, y: 4, width: 56, height: 56, rx: 14, fill: 'var(--dsw-alias-brand-primary, #4a7dc4)' }),
        h('path', { d: 'M20 14h16l8 8v28a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2z', fill: '#fff' }),
        h('path', { d: 'M36 14v8h8', fill: 'none', stroke: 'var(--dsw-alias-brand-primary, #4a7dc4)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
        h('rect', { x: 23, y: 30, width: 18, height: 2.6, rx: 1.3, fill: '#4a7dc4', opacity: .85 }),
        h('rect', { x: 23, y: 36, width: 18, height: 2.6, rx: 1.3, fill: '#4a7dc4', opacity: .6 }),
        h('rect', { x: 23, y: 42, width: 12, height: 2.6, rx: 1.3, fill: '#4a7dc4', opacity: .4 }),
        h('path', { d: 'M45 46l3 3 6-7', fill: 'none', stroke: '#8fe08f', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      );
    }

    // -- apply --------------------------------------------------------------------------

    const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.commands'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { ru, en }), 'doc-templates-panel: словари');
      const t = ctx.locale.bind(NS);

      // Панель в основной области (key = id элемента боковой навигации).
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ ctx, t }),
      }, DocTemplatesPanel));

      // Элемент в левой панели навигации.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: () => t('panel'),
        locale: NS,
      }, PanelGlyph));

      return () => {};
    }

    // Экспорт чистых функций для тестов (node --test подменяет window и require).
    return { inject, apply, renderMarkdown, escapeHtml, inlineFormat };
  },
});
