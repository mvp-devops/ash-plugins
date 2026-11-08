/**
 * Agent Studio — Client half (Web UI).
 *
 * Registers:
 * - `sidebar.panellist` entry "agent-studio" (left navigation icon),
 * - `main` panel "agent-studio" (the Agent Studio page),
 * - `shell.overlay` launcher (template quick-pick + compact run form),
 * - a session context-menu action "Run subagent",
 * - a chat selection gesture "Run subagent" on selected text.
 *
 * All data flows through the `/agent-studio` session command on the Host.
 */

window.__ModuleLoader__.load({
  id: '@local/agent-studio',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } = React;

    const NS = 'agentStudio';

    // -- locale ---------------------------------------------------------------

    const en = {
      panel: 'Agent Studio',
      'tab.agents': 'Subagents',
      'tab.skills': 'Skills',
      'tab.tools': 'Tools',
      'tab.settings': 'Settings',
      'tab.transfer': 'Import / export',
      'agents.search': 'Search by name, role or tag',
      'agents.filter.role': 'All roles',
      'agents.filter.scope': 'All scopes',
      'agents.filter.status': 'All statuses',
      'scope.global': 'Global',
      'scope.project': 'Project',
      'scope.builtin': 'Built-in',
      'status.enabled': 'Enabled',
      'status.disabled': 'Disabled',
      'agents.run': 'Run',
      'agents.new': 'New template',
      'agents.undo': 'Undo',
      'agents.empty': 'No templates match the filters',
      'agents.projectOverride': 'Project override',
      'row.duplicate': 'Duplicate',
      'row.edit': 'Edit',
      'row.toggle.enable': 'Enable',
      'row.toggle.disable': 'Disable',
      'row.delete': 'Delete',
      'row.effective': 'Effective policy',
      'row.share': 'Share template (export)',
      'row.toProject': 'Save to project',
      'form.title.new': 'New subagent template',
      'form.title.edit': 'Edit subagent template',
      'form.name': 'Name',
      'form.role': 'Role / persona',
      'form.description': 'Description',
      'form.instructions': 'System instructions',
      'form.skills': 'Skills (comma-separated)',
      'form.preset': 'Tool policy preset',
      'form.model': 'Model / provider override (provider/model, optional)',
      'form.depth': 'Max delegation depth',
      'form.tags': 'Tags (comma-separated)',
      'form.scope': 'Scope',
      'form.enabled': 'Enabled',
      'form.tools': 'Tool policy rules',
      'form.tool': 'Tool',
      'form.category': 'Category',
      'form.ruleStatus': 'Status',
      'form.ruleNote': 'Reason / note',
      'form.ruleSource': 'Override source',
      'form.save': 'Save',
      'form.cancel': 'Cancel',
      'policy.allowed': 'Allowed',
      'policy.denied': 'Denied',
      'policy.ask': 'Ask',
      'policy.inherit': 'Inherit',
      'skills.title': 'Available skills',
      'skills.catalog': 'Skill catalog',
      'skills.project': 'Project skills',
      'skills.new': 'New skill',
      'skills.dir': 'Directory',
      'skills.noProject': 'No project skills yet — create one, it will live in .dsh/skills',
      'skills.name': 'Skill name',
      'skills.description': 'Description (for the model)',
      'skills.body': 'Skill instructions (Markdown body)',
      'skills.delete': 'Delete skill',
      'skills.deleteBody': 'Delete project skill "{name}" (SKILL.md)? The skill stops being available to agents.',
      'tools.custom': 'Project tools (Agent Studio)',
      'tools.new': 'New tool',
      'tools.customHint': 'Project tools are model-facing knowledge tools backed by Agent Studio; their content is returned to the agent that calls them. They can be referenced in tool policy rules.',
      'tools.noCustom': 'No project tools yet',
      'tools.live': 'Registered',
      'tools.inactive': 'Not registered',
      'tools.name': 'Tool name',
      'tools.content': 'Content returned by the tool',
      'tools.delete': 'Delete tool',
      'tools.deleteBody': 'Delete project tool "{name}"? Agents will no longer see it.',
      'skills.from': 'Source',
      'tools.title': 'Tool registry',
      'tools.count': 'tools',
      'settings.title': 'Settings',
      'settings.project': 'Project configuration',
      'settings.projectFile': 'File',
      'settings.projectRoot': 'Project root',
      'settings.projectMissing': 'No project configuration in this workspace yet',
      'settings.projectError': 'Project configuration error',
      'settings.projectSave': 'Save all global templates to project',
      'settings.projectIds': 'Templates in project file',
      'settings.note': 'Global templates live in machine-local storage; use Import/export to move them between machines. Project configuration is stored in .agent-studio/agent-templates.json and is portable.',
      'transfer.title': 'Import / export',
      'transfer.exportAll': 'Export all templates',
      'transfer.exportSelected': 'Export selected',
      'transfer.copy': 'Copy',
      'transfer.download': 'Download',
      'transfer.importTitle': 'Import configuration',
      'transfer.importPlaceholder': 'Paste an exported JSON document here',
      'transfer.strategy': 'Strategy',
      'transfer.preview': 'Preview import',
      'transfer.apply': 'Apply import',
      'transfer.confirmOverwrite': 'Allow overwriting existing templates',
      'transfer.diff': 'Import preview',
      'transfer.noSession': 'Open a session to use Agent Studio (configuration is resolved per session working directory).',
      'loading': 'Loading…',
      'error': 'Error',
      'started': 'Subagent started',
      'run.title': 'Run subagent',
      'run.pick': 'Choose a template',
      'run.task': 'Task',
      'run.context': 'Optional context',
      'run.model': 'Optional model override (provider/model)',
      'run.depth': 'Optional max delegation depth',
      'run.background': 'Run in background',
      'run.submit': 'Run subagent',
      'run.back': 'Back',
      'run.conflict': 'Policy conflicts',
      'confirm.delete': 'Delete template',
      'confirm.deleteBody': 'Delete template "{name}"? You can undo immediately after.',
      'confirm.yes': 'Delete',
      'close': 'Close',
      'copied': 'Copied to clipboard',
      'selectRun': 'Run subagent',
    };
    const ru = {
      panel: 'Agent Studio',
      'tab.agents': 'Сабагенты',
      'tab.skills': 'Skills',
      'tab.tools': 'Tools',
      'tab.settings': 'Настройки',
      'tab.transfer': 'Импорт / экспорт',
      'agents.search': 'Поиск по имени, роли или тегу',
      'agents.filter.role': 'Все роли',
      'agents.filter.scope': 'Все scope',
      'agents.filter.status': 'Все статусы',
      'scope.global': 'Глобальный',
      'scope.project': 'Project',
      'scope.builtin': 'Встроенный',
      'status.enabled': 'Включён',
      'status.disabled': 'Отключён',
      'agents.run': 'Run',
      'agents.new': 'Новый шаблон',
      'agents.undo': 'Отменить',
      'agents.empty': 'Нет шаблонов по выбранным фильтрам',
      'agents.projectOverride': 'Project override',
      'row.duplicate': 'Дублировать',
      'row.edit': 'Редактировать',
      'row.toggle.enable': 'Включить',
      'row.toggle.disable': 'Отключить',
      'row.delete': 'Удалить',
      'row.effective': 'Effective policy',
      'row.share': 'Поделиться шаблоном (экспорт)',
      'row.toProject': 'Сохранить в project',
      'form.title.new': 'Новый шаблон сабагента',
      'form.title.edit': 'Редактирование шаблона',
      'form.name': 'Имя',
      'form.role': 'Роль / persona',
      'form.description': 'Описание',
      'form.instructions': 'Системные инструкции',
      'form.skills': 'Skills (через запятую)',
      'form.preset': 'Пресет tool policy',
      'form.model': 'Модель / провайдер (provider/model, необязательно)',
      'form.depth': 'Max delegation depth',
      'form.tags': 'Теги (через запятую)',
      'form.scope': 'Scope',
      'form.enabled': 'Включён',
      'form.tools': 'Правила tool policy',
      'form.tool': 'Tool',
      'form.category': 'Категория',
      'form.ruleStatus': 'Статус',
      'form.ruleNote': 'Причина / примечание',
      'form.ruleSource': 'Источник override',
      'form.save': 'Сохранить',
      'form.cancel': 'Отмена',
      'policy.allowed': 'Разрешён',
      'policy.denied': 'Запрещён',
      'policy.ask': 'Спросить',
      'policy.inherit': 'Наследовать',
      'skills.title': 'Доступные skills',
      'skills.catalog': 'Каталог skills',
      'skills.project': 'Project skills',
      'skills.new': 'Новый skill',
      'skills.dir': 'Каталог',
      'skills.noProject': 'Проектных skills пока нет — создайте, файл появится в .dsh/skills',
      'skills.name': 'Имя skill',
      'skills.description': 'Описание (для модели)',
      'skills.body': 'Инструкции skill (Markdown-тело)',
      'skills.delete': 'Удалить skill',
      'skills.deleteBody': 'Удалить проектный skill «{name}» (SKILL.md)? Он перестанет быть доступен агентам.',
      'tools.custom': 'Project tools (Agent Studio)',
      'tools.new': 'Новый tool',
      'tools.customHint': 'Project tools — модельные knowledge-tools на базе Agent Studio: агент, вызвавший tool, получает его содержимое. Их можно упоминать в правилах tool policy.',
      'tools.noCustom': 'Проектных tools пока нет',
      'tools.live': 'Зарегистрирован',
      'tools.inactive': 'Не зарегистрирован',
      'tools.name': 'Имя tool',
      'tools.content': 'Содержимое, возвращаемое tool',
      'tools.delete': 'Удалить tool',
      'tools.deleteBody': 'Удалить проектный tool «{name}»? Агенты больше его не увидят.',
      'skills.from': 'Источник',
      'tools.title': 'Реестр tools',
      'tools.count': 'tools',
      'settings.title': 'Настройки',
      'settings.project': 'Project-конфигурация',
      'settings.projectFile': 'Файл',
      'settings.projectRoot': 'Корень проекта',
      'settings.projectMissing': 'В этом workspace пока нет project-конфигурации',
      'settings.projectError': 'Ошибка project-конфигурации',
      'settings.projectSave': 'Сохранить все глобальные шаблоны в project',
      'settings.projectIds': 'Шаблоны в project-файле',
      'settings.note': 'Глобальные шаблоны хранятся локально на этой машине; для переноса используйте «Импорт / экспорт». Project-конфигурация хранится в .agent-studio/agent-templates.json и переносима.',
      'transfer.title': 'Импорт / экспорт',
      'transfer.exportAll': 'Экспортировать все шаблоны',
      'transfer.exportSelected': 'Экспортировать выбранные',
      'transfer.copy': 'Копировать',
      'transfer.download': 'Скачать',
      'transfer.importTitle': 'Импорт конфигурации',
      'transfer.importPlaceholder': 'Вставьте JSON экспорта сюда',
      'transfer.strategy': 'Стратегия',
      'transfer.preview': 'Предпросмотр импорта',
      'transfer.apply': 'Применить импорт',
      'transfer.confirmOverwrite': 'Разрешить перезапись существующих шаблонов',
      'transfer.diff': 'Предпросмотр импорта',
      'transfer.noSession': 'Откройте сессию, чтобы использовать Agent Studio (конфигурация зависит от рабочей директории сессии).',
      'loading': 'Загрузка…',
      'error': 'Ошибка',
      'started': 'Сабагент запущен',
      'run.title': 'Запуск сабагента',
      'run.pick': 'Выберите шаблон',
      'run.task': 'Задача',
      'run.context': 'Контекст (необязательно)',
      'run.model': 'Модель (provider/model, необязательно)',
      'run.depth': 'Max delegation depth (необязательно)',
      'run.background': 'Запустить в фоне',
      'run.submit': 'Запустить',
      'run.back': 'Назад',
      'run.conflict': 'Конфликты политики',
      'confirm.delete': 'Удалить шаблон',
      'confirm.deleteBody': 'Удалить шаблон «{name}»? Сразу после этого доступна отмена.',
      'confirm.yes': 'Удалить',
      'close': 'Закрыть',
      'copied': 'Скопировано в буфер обмена',
      'selectRun': 'Запустить сабагента',
    };

    // -- launcher store (outside React) ---------------------------------------

    const launcher = {
      state: null,
      pending: null, // {sessionId} captured by the selection gesture
      listeners: new Set(),
      open(state) {
        this.state = { ...state };
        this.emit();
      },
      close() {
        this.state = null;
        this.emit();
      },
      emit() {
        for (const listener of this.listeners) listener();
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      snapshot() {
        return this.state;
      },
    };

    function useLauncher() {
      return useSyncExternalStore(
        (cb) => launcher.subscribe(cb),
        () => launcher.snapshot(),
        () => null,
      );
    }

    // -- API bridge ------------------------------------------------------------

    async function api(ctx, sessionId, args) {
      let commands;
      try {
        commands = ctx.remote?.commands;
      } catch {
        commands = undefined;
      }
      if (!commands) throw new Error('Agent Studio: the commands bridge is unavailable (plugin not fully active)');
      const line = `/agent-studio ${JSON.stringify(args)}`;
      const outcome = await commands.execute(sessionId, line, []);
      if (!outcome.ok) throw new Error(outcome.error?.message ?? 'agent-studio command failed');
      const execution = outcome.value;
      const result = execution?.result;
      if (!result) throw new Error('agent-studio command returned no result');
      if (result.kind === 'error') {
        let payload = null;
        try { payload = JSON.parse(result.text); } catch { /* plain error text */ }
        throw new Error(payload?.error ?? result.text);
      }
      return JSON.parse(result.text);
    }

    // -- small building blocks ---------------------------------------------------

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
      return h('div', { className: `asx-notice asx-notice-${kind ?? 'info'}`, role: kind === 'error' ? 'alert' : 'status' },
        h('span', { className: 'asx-notice-text' }, children),
        onClose ? h('button', { type: 'button', className: 'asx-btn asx-btn-ghost asx-notice-close', 'aria-label': 'Close', onClick: onClose }, '×') : null,
      );
    }

    function Modal({ title, onClose, children, wide }) {
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);
      return h('div', { className: 'asx-modal-backdrop', onPointerDown: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h('div', { className: `asx-modal${wide ? ' asx-modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { className: 'asx-modal-head' },
            h('div', { className: 'asx-modal-title' }, title),
            h('button', { type: 'button', className: 'asx-btn asx-btn-ghost', onClick: onClose, 'aria-label': 'Close' }, '×'),
          ),
          h('div', { className: 'asx-modal-body' }, children),
        ),
      );
    }

    function Confirm({ title, body, actionLabel, onConfirm, onClose }) {
      return h(Modal, { title, onClose },
        h('div', { className: 'asx-confirm-body' }, body),
        h('div', { className: 'asx-actions' },
          h('button', { type: 'button', className: 'asx-btn asx-btn-danger', onClick: () => { onClose(); onConfirm(); } }, actionLabel),
          h('button', { type: 'button', className: 'asx-btn', onClick: onClose }, 'Cancel'),
        ),
      );
    }

    function Field({ label, children, hint }) {
      return h('label', { className: 'asx-field' },
        h('span', { className: 'asx-field-label' }, label),
        children,
        hint ? h('span', { className: 'asx-field-hint' }, hint) : null,
      );
    }

    const STATUS_LABELS = { allow: 'policy.allowed', deny: 'policy.denied', ask: 'policy.ask', inherit: 'policy.inherit' };

    function PolicyBadges({ summary, t }) {
      if (!summary) return null;
      return h('span', { className: 'asx-policy-badges' },
        h('span', { className: 'asx-badge' }, summary.preset),
        h('span', { className: 'asx-badge asx-badge-ok' }, `✓ ${summary.allow}`),
        h('span', { className: 'asx-badge asx-badge-bad' }, `✕ ${summary.deny}`),
      );
    }

    // -- panel: subagents tab -------------------------------------------------

    function AgentsTab({ ctx, sessionId, t, notify }) {
      const [filters, setFilters] = useState({ query: '', role: '', scope: '', status: '' });
      const [listState, reload] = useAsync(
        () => api(ctx, sessionId, { op: 'list', query: filters.query || undefined, role: filters.role || undefined, scope: filters.scope || undefined, status: filters.status || undefined }),
        [sessionId, filters.query, filters.role, filters.scope, filters.status],
      );
      const [formTarget, setFormTarget] = useState(null); // null | {mode:'new'} | {mode:'edit', template}
      const [confirmDelete, setConfirmDelete] = useState(null);
      const [effective, setEffective] = useState(null); // template id under review
      const [shareExport, setShareExport] = useState(null); // exported document text

      const rows = listState.data?.rows ?? [];
      const roles = useMemo(() => [...new Set(rows.map((r) => r.role))].sort(), [rows]);

      const mutate = async (args, message) => {
        try {
          await api(ctx, sessionId, args);
          notify({ kind: 'success', text: message });
          await reload();
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };

      const rowMenu = (row) => {
        const items = [];
        items.push({ label: t('agents.run'), primary: true, run: () => launcher.open({ sessionId, template: row.id }) });
        if (!row.builtin) items.push({ label: t('row.edit'), run: () => setFormTarget({ mode: 'edit', id: row.id }) });
        items.push({ label: t('row.duplicate'), run: () => mutate({ op: 'duplicate', id: row.id }, t('row.duplicate')) });
        if (!row.builtin) items.push({ label: row.enabled ? t('row.toggle.disable') : t('row.toggle.enable'), run: () => mutate({ op: 'toggle', id: row.id }, row.enabled ? t('row.toggle.disable') : t('row.toggle.enable')) });
        items.push({ label: t('row.effective'), run: () => setEffective(row.id) });
        items.push({ label: t('row.toProject'), run: () => mutate({ op: 'project-save', ids: [row.id], confirm: true }, t('row.toProject')) });
        items.push({ label: t('row.share'), run: async () => {
          try {
            const result = await api(ctx, sessionId, { op: 'export', ids: [row.id] });
            setShareExport(JSON.stringify(result.document, null, 2));
          } catch (error) { notify({ kind: 'error', text: error.message }); }
        } });
        if (!row.builtin) items.push({ label: t('row.delete'), danger: true, run: () => setConfirmDelete(row) });
        return items;
      };

      return h('div', { className: 'asx-agents' },
        h('div', { className: 'asx-toolbar' },
          h('input', {
            type: 'search', className: 'asx-input asx-search', placeholder: t('agents.search'), value: filters.query,
            onChange: (e) => setFilters((f) => ({ ...f, query: e.target.value })),
          }),
          select(t('agents.filter.role'), filters.role, ['', ...roles], (v) => setFilters((f) => ({ ...f, role: v })), (value) => value === '' ? t('agents.filter.role') : value),
          select(t('agents.filter.scope'), filters.scope, ['', 'global', 'project'], (v) => setFilters((f) => ({ ...f, scope: v })), (value) => value === '' ? t('agents.filter.scope') : t(`scope.${value}`)),
          select(t('agents.filter.status'), filters.status, ['', 'enabled', 'disabled'], (v) => setFilters((f) => ({ ...f, status: v })), (value) => value === '' ? t('agents.filter.status') : t(`status.${value}`)),
          h('div', { className: 'asx-toolbar-spacer' }),
          h('button', { type: 'button', className: 'asx-btn', onClick: () => api(ctx, sessionId, { op: 'undo' }).then((r) => notify({ kind: 'success', text: r.message })).catch((e) => notify({ kind: 'error', text: e.message })) }, t('agents.undo')),
          h('button', { type: 'button', className: 'asx-btn asx-btn-primary', onClick: () => setFormTarget({ mode: 'new' }) }, t('agents.new')),
        ),
        listState.busy && rows.length === 0 ? h('div', { className: 'asx-loading' }, t('loading')) : null,
        listState.error ? h(Notice, { kind: 'error' }, `${t('error')}: ${listState.error}`) : null,
        h('div', { className: 'asx-list' },
          rows.length === 0 && !listState.busy ? h('div', { className: 'asx-empty' }, t('agents.empty')) : null,
          rows.map((row) => h(TemplateRow, { key: `${row.origin}:${row.id}`, row, t, menu: rowMenu(row), onRun: () => launcher.open({ sessionId, template: row.id }) })),
        ),
        formTarget ? h(TemplateForm, {
          ctx, sessionId, t, notify, target: formTarget, onClose: () => setFormTarget(null),
          onSaved: () => { setFormTarget(null); reload(); },
        }) : null,
        confirmDelete ? h(Confirm, {
          title: t('confirm.delete'),
          body: t('confirm.deleteBody').replace('{name}', confirmDelete.name),
          actionLabel: t('confirm.yes'),
          onClose: () => setConfirmDelete(null),
          onConfirm: () => mutate({ op: 'delete', id: confirmDelete.id }, t('row.delete')),
        }) : null,
        effective ? h(EffectiveDialog, { ctx, sessionId, id: effective, t, onClose: () => setEffective(null) }) : null,
        shareExport ? h(Modal, { title: t('row.share'), onClose: () => setShareExport(null), wide: true },
          h('textarea', { className: 'asx-textarea asx-mono', readOnly: true, value: shareExport, onFocus: (e) => e.target.select() }),
          h('div', { className: 'asx-actions' },
            h('button', { type: 'button', className: 'asx-btn', onClick: () => { navigator.clipboard?.writeText(shareExport); notify({ kind: 'success', text: t('copied') }); } }, t('transfer.copy')),
            h('button', { type: 'button', className: 'asx-btn', onClick: () => downloadJson(shareExport, 'agent-studio-template.json') }, t('transfer.download')),
          ),
        ) : null,
      );
    }

    function TemplateRow({ row, t, menu, onRun }) {
      const [open, setOpen] = useState(false);
      const ref = useRef(null);
      useEffect(() => {
        if (!open) return;
        const onDoc = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false); };
        document.addEventListener('pointerdown', onDoc);
        return () => document.removeEventListener('pointerdown', onDoc);
      }, [open]);
      const scopeLabel = row.builtin ? t('scope.builtin') : row.scope === 'project' ? t('scope.project') : t('scope.global');
      return h('div', { className: 'asx-row' },
        h('div', { className: 'asx-row-main' },
          h('div', { className: 'asx-row-title' },
            h('span', { className: 'asx-row-name' }, row.name),
            h('span', { className: 'asx-badge asx-badge-role' }, row.role),
            h('span', { className: `asx-badge ${row.enabled ? 'asx-badge-ok' : 'asx-badge-dim'}` }, row.enabled ? t('status.enabled') : t('status.disabled')),
            h('span', { className: 'asx-badge asx-badge-dim' }, scopeLabel),
            row.hasProjectOverride ? h('span', { className: 'asx-badge asx-badge-info' }, t('agents.projectOverride')) : null,
          ),
          row.description ? h('div', { className: 'asx-row-desc' }, row.description) : null,
          h('div', { className: 'asx-row-meta' },
            PolicyBadges({ summary: row.policy, t }),
            h('span', { className: 'asx-dim' }, `${row.skills} skills`),
            row.tags.length ? h('span', { className: 'asx-dim' }, row.tags.join(', ')) : null,
          ),
        ),
        h('div', { className: 'asx-row-actions' },
          h('button', { type: 'button', className: 'asx-btn asx-btn-primary', onClick: onRun }, t('agents.run')),
          h('div', { className: 'asx-menu-wrap', ref },
            h('button', { type: 'button', className: 'asx-btn asx-btn-ghost', 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-label': 'Actions', onClick: () => setOpen((v) => !v) }, '⋯'),
            open ? h('div', { className: 'asx-menu', role: 'menu' },
              menu.map((item, index) => h('button', {
                key: index, type: 'button', role: 'menuitem',
                className: `asx-menu-item${item.danger ? ' asx-menu-danger' : ''}${item.primary ? ' asx-menu-primary' : ''}`,
                onClick: () => { setOpen(false); item.run(); },
              }, item.label)),
            ) : null,
          ),
        ),
      );
    }

    function select(label, value, options, onChange, render) {
      return h('label', { className: 'asx-select' },
        h('select', { className: 'asx-input', value, onChange: (e) => onChange(e.target.value), 'aria-label': label },
          options.map((option) => h('option', { key: option, value: option }, render ? render(option) : option)),
        ),
      );
    }

    function downloadJson(text, name) {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }

    // -- template form ---------------------------------------------------------

    async function loadTemplateForEdit(ctx, sessionId, id) {
      const result = await api(ctx, sessionId, { op: 'get', id });
      return result.template;
    }

    function TemplateForm({ ctx, sessionId, t, notify, target, onClose, onSaved }) {
      const [state, setState] = useState({ busy: true, tools: null, template: null, error: null });
      useEffect(() => {
        let live = true;
        Promise.all([
          target.mode === 'edit' ? loadTemplateForEdit(ctx, sessionId, target.id) : Promise.resolve(null),
          api(ctx, sessionId, { op: 'tools' }),
        ]).then(([template, tools]) => {
          if (!live) return;
          setState({ busy: false, tools, template: template ?? blankTemplate() });
        }).catch((error) => live && setState({ busy: false, tools: null, template: null, error: error.message }));
        return () => { live = false; };
      }, [ctx, sessionId, target]);

      if (state.busy) return h(Modal, { title: t('form.title.new'), onClose }, h('div', { className: 'asx-loading' }, t('loading')));
      if (state.error) return h(Modal, { title: t('error'), onClose }, h(Notice, { kind: 'error' }, state.error));
      const template = state.template;
      const tools = state.tools;
      const setField = (field, value) => setState((prev) => ({ ...prev, template: { ...prev.template, [field]: value } }));
      const setRule = (tool, patch) => setState((prev) => {
        const rules = { ...prev.template.toolPolicy.rules };
        const notes = { ...(prev.template.toolPolicy.notes ?? {}) };
        if (patch.status !== undefined) {
          if (patch.status === 'inherit') delete rules[tool];
          else rules[tool] = patch.status;
        }
        if (patch.note !== undefined) {
          if (patch.note) notes[tool] = patch.note;
          else delete notes[tool];
        }
        return { ...prev, template: { ...prev.template, toolPolicy: { ...prev.template.toolPolicy, rules, ...(Object.keys(notes).length ? { notes } : {}) } } };
      });

      const save = async () => {
        const payload = {
          id: template.id,
          name: template.name,
          role: template.role,
          description: template.description,
          instructions: template.instructions,
          skills: template.skills,
          toolPolicy: { preset: template.toolPolicy.preset, rules: template.toolPolicy.rules, ...(template.toolPolicy.notes ? { notes: template.toolPolicy.notes } : {}) },
          model: template.model && (template.model.provider || template.model.model) ? template.model : null,
          maxDelegationDepth: template.maxDelegationDepth,
          tags: template.tags,
          enabled: template.enabled,
        };
        try {
          await api(ctx, sessionId, { op: 'save', template: payload });
          if (payload.scope === 'project') {
            await api(ctx, sessionId, { op: 'project-save', ids: [payload.id], confirm: true });
          }
          notify({ kind: 'success', text: t('form.save') });
          onSaved();
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };

      const modelText = template.model ? `${template.model.provider ?? ''}${template.model.provider && template.model.model ? '/' : ''}${template.model.model ?? ''}` : '';
      const rows = tools?.rows ?? [];

      return h(Modal, { title: target.mode === 'edit' ? t('form.title.edit') : t('form.title.new'), onClose, wide: true },
        h('div', { className: 'asx-form' },
          h('div', { className: 'asx-form-grid' },
            h(Field, { label: t('form.name') }, h('input', { className: 'asx-input', value: template.name, disabled: target.mode === 'edit', onChange: (e) => setField('name', e.target.value) })),
            h(Field, { label: t('form.role') }, h('input', { className: 'asx-input', value: template.role, onChange: (e) => setField('role', e.target.value) })),
          ),
          h(Field, { label: t('form.description') }, h('textarea', { className: 'asx-textarea', rows: 2, value: template.description, onChange: (e) => setField('description', e.target.value) })),
          h(Field, { label: t('form.instructions') }, h('textarea', { className: 'asx-textarea', rows: 6, value: template.instructions, onChange: (e) => setField('instructions', e.target.value) })),
          h('div', { className: 'asx-form-grid' },
            h(Field, { label: t('form.skills') }, h('input', { className: 'asx-input', value: template.skills.join(', '), onChange: (e) => setField('skills', e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) })),
            h(Field, { label: t('form.tags') }, h('input', { className: 'asx-input', value: template.tags.join(', '), onChange: (e) => setField('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) })),
          ),
          h('div', { className: 'asx-form-grid asx-form-grid-3' },
            h(Field, { label: t('form.preset') },
              h('select', { className: 'asx-input', value: template.toolPolicy.preset, onChange: (e) => setField('toolPolicy', { ...template.toolPolicy, preset: e.target.value }) },
                ['read-only', 'code-editing', 'full-developer', 'safe-qa', 'research-only', 'custom'].map((preset) => h('option', { key: preset, value: preset }, preset)),
              ),
            ),
            h(Field, { label: t('form.model'), hint: modelText || undefined },
              h('input', {
                className: 'asx-input', placeholder: 'provider/model', defaultValue: modelText,
                onChange: (e) => {
                  const value = e.target.value.trim();
                  if (!value) return setField('model', null);
                  const slash = value.indexOf('/');
                  setField('model', slash > 0 ? { provider: value.slice(0, slash), model: value.slice(slash + 1) } : { model: value });
                },
              }),
            ),
            h(Field, { label: t('form.depth') },
              h('select', { className: 'asx-input', value: String(template.maxDelegationDepth), onChange: (e) => setField('maxDelegationDepth', Number(e.target.value)) },
                [1, 2, 3, 4].map((depth) => h('option', { key: depth, value: String(depth) }, String(depth))),
              ),
            ),
          ),
          h('div', { className: 'asx-form-grid asx-form-grid-2' },
            h(Field, { label: t('form.scope') },
              h('select', { className: 'asx-input', value: template.scope ?? 'global', onChange: (e) => setField('scope', e.target.value) },
                h('option', { value: 'global' }, t('scope.global')),
                h('option', { value: 'project' }, `${t('scope.project')} (${t('row.toProject')})`),
              ),
            ),
            h(Field, { label: t('form.enabled') },
              h('button', {
                type: 'button', role: 'switch', 'aria-checked': template.enabled !== false,
                className: `asx-switch${template.enabled !== false ? ' asx-switch-on' : ''}`,
                onClick: () => setField('enabled', template.enabled === false),
              }, h('span', { className: 'asx-switch-knob' })),
            ),
          ),
          h('div', { className: 'asx-section-title' }, t('form.tools')),
          h('div', { className: 'asx-tools-table', role: 'table' },
            h('div', { className: 'asx-tools-head', role: 'row' },
              h('span', null, t('form.tool')), h('span', null, t('form.category')), h('span', null, t('form.ruleStatus')), h('span', null, t('form.ruleNote')),
            ),
            rows.map((row) => {
              const status = template.toolPolicy.rules[row.name] ?? 'inherit';
              const note = template.toolPolicy.notes?.[row.name] ?? '';
              const source = template.toolPolicy.rules[row.name] ? 'Template' : 'Preset';
              return h('div', { key: row.name, className: 'asx-tools-row', role: 'row' },
                h('span', { className: 'asx-mono', role: 'cell' }, row.name),
                h('span', { role: 'cell' }, row.categoryLabel ?? row.category),
                h('span', { role: 'cell' },
                  h('select', { className: 'asx-input asx-input-compact', value: status, 'aria-label': `${row.name} status`, onChange: (e) => setRule(row.name, { status: e.target.value }) },
                    ['inherit', 'allow', 'deny', 'ask'].map((value) => h('option', { key: value, value }, t(STATUS_LABELS[value]))),
                  ),
                ),
                h('span', { role: 'cell' },
                  h('input', { className: 'asx-input asx-input-compact', value: note, 'aria-label': `${row.name} note`, onChange: (e) => setRule(row.name, { note: e.target.value }) }),
                ),
                h('span', { className: 'asx-dim', role: 'cell' }, source),
              );
            }),
          ),
          h('div', { className: 'asx-actions' },
            h('button', { type: 'button', className: 'asx-btn asx-btn-primary', onClick: save }, t('form.save')),
            h('button', { type: 'button', className: 'asx-btn', onClick: onClose }, t('form.cancel')),
          ),
        ),
      );
    }

    function blankTemplate() {
      return {
        id: `custom-${Date.now().toString(36)}`,
        name: '',
        role: '',
        description: '',
        instructions: '',
        skills: [],
        toolPolicy: { preset: 'custom', rules: {} },
        model: null,
        maxDelegationDepth: 2,
        tags: [],
        scope: 'global',
        enabled: true,
      };
    }

    function EffectiveDialog({ ctx, sessionId, id, t, onClose }) {
      const [state] = useAsync(() => api(ctx, sessionId, { op: 'effective', id }), [sessionId, id]);
      const data = state.data;
      return h(Modal, { title: `${t('row.effective')} — ${id}`, onClose, wide: true },
        state.busy ? h('div', { className: 'asx-loading' }, t('loading')) : null,
        state.error ? h(Notice, { kind: 'error' }, state.error) : null,
        data ? h('div', null,
          h('div', { className: 'asx-dim' }, `merge order: ${data.trail.map((step) => step.source).join(' → ')}`),
          h('table', { className: 'asx-table' },
            h('thead', null, h('tr', null, h('th', null, t('form.tool')), h('th', null, t('form.category')), h('th', null, 'Status'), h('th', null, t('form.ruleSource')))),
            h('tbody', null, Object.entries(data.policy.statuses).map(([name, status]) => h('tr', { key: name },
              h('td', { className: 'asx-mono' }, name),
              h('td', null, data.policy.categories?.[name] ?? ''),
              h('td', null, h('span', { className: `asx-badge ${status === 'allow' ? 'asx-badge-ok' : status === 'deny' ? 'asx-badge-bad' : 'asx-badge-warn'}` }, t(STATUS_LABELS[status] ?? status))),
              h('td', { className: 'asx-dim' }, data.policy.sources[name]?.source ?? ''),
            ))),
          ),
          data.policy.conflicts.length ? h('div', null,
            h('div', { className: 'asx-section-title' }, t('run.conflict')),
            data.policy.conflicts.map((conflict, index) => h('div', { key: index, className: 'asx-dim' }, `${conflict.tool}: ${conflict.attempted} → ${conflict.resolution} (${conflict.source})`)),
          ) : null,
        ) : null,
      );
    }

    // -- skills & tools tabs -----------------------------------------------------

    function SkillsTab({ ctx, sessionId, t, notify }) {
      const [state, reload] = useAsync(() => api(ctx, sessionId, { op: 'skill-list' }), [sessionId]);
      const [editor, setEditor] = useState(null);
      const [confirmDelete, setConfirmDelete] = useState(null);
      const rows = state.data?.rows ?? [];
      const managed = state.data?.managed ?? [];
      const managedNames = new Set(managed.map((skill) => skill.name));
      const edit = async (name) => {
        try {
          const data = await api(ctx, sessionId, { op: 'skill-get', name });
          setEditor({ name, description: data.description, body: data.body });
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };
      const managedRow = (skill) => h('div', { key: `m:${skill.name}`, className: 'asx-row' },
        h('div', { className: 'asx-row-main' },
          h('div', { className: 'asx-row-title' },
            h('span', { className: 'asx-mono' }, skill.name),
            h('span', { className: 'asx-badge asx-badge-info' }, t('scope.project')),
            h('span', { className: 'asx-badge asx-badge-dim' }, skill.format),
          ),
          skill.description ? h('div', { className: 'asx-row-desc' }, skill.description) : null,
        ),
        h('div', { className: 'asx-row-actions' },
          h('button', { type: 'button', className: 'asx-btn', onClick: () => edit(skill.name) }, t('row.edit')),
          h('button', { type: 'button', className: 'asx-btn asx-btn-danger-ghost', onClick: () => setConfirmDelete(skill) }, t('row.delete')),
        ),
      );
      const catalogRow = (skill) => h('div', { key: skill.name, className: 'asx-row' },
        h('div', { className: 'asx-row-main' },
          h('div', { className: 'asx-row-title' },
            h('span', { className: 'asx-mono' }, skill.name),
            skill.source ? h('span', { className: 'asx-badge asx-badge-dim' }, skill.source) : null,
            managedNames.has(skill.name) ? h('span', { className: 'asx-badge asx-badge-info' }, t('scope.project')) : null,
          ),
          skill.description ? h('div', { className: 'asx-row-desc' }, skill.description) : null,
        ),
        managedNames.has(skill.name) ? h('div', { className: 'asx-row-actions' },
          h('button', { type: 'button', className: 'asx-btn', onClick: () => edit(skill.name) }, t('row.edit')),
        ) : null,
      );
      return h('div', null,
        state.error ? h(Notice, { kind: 'error' }, state.error) : null,
        state.busy && !state.data ? h('div', { className: 'asx-loading' }, t('loading')) : null,
        state.data?.error ? h(Notice, { kind: 'error' }, `${t('error')}: ${state.data.error}`) : null,
        h('div', { className: 'asx-toolbar' },
          h('div', { className: 'asx-section-title', style: { margin: 0 } }, t('skills.project')),
          h('div', { className: 'asx-toolbar-spacer' }),
          h('button', { type: 'button', className: 'asx-btn asx-btn-primary', onClick: () => setEditor({ name: '', description: '', body: '' }) }, t('skills.new')),
        ),
        state.data?.managedDir ? h('div', { className: 'asx-dim' }, `${t('skills.dir')}: ${state.data.managedDir}`) : null,
        h('div', { className: 'asx-list' },
          managed.length === 0 ? h('div', { className: 'asx-empty' }, t('skills.noProject')) : null,
          managed.map(managedRow),
        ),
        h('div', { className: 'asx-section-title' }, t('skills.catalog')),
        h('div', { className: 'asx-list' },
          rows.length === 0 && !state.busy ? h('div', { className: 'asx-empty' }, t('agents.empty')) : null,
          rows.map(catalogRow),
        ),
        editor ? h(SkillEditor, {
          ctx, sessionId, t, notify, editor, onClose: () => setEditor(null),
          onSaved: () => { setEditor(null); reload(); },
        }) : null,
        confirmDelete ? h(Confirm, {
          title: t('skills.delete'),
          body: t('skills.deleteBody').replace('{name}', confirmDelete.name),
          actionLabel: t('confirm.yes'),
          onClose: () => setConfirmDelete(null),
          onConfirm: async () => {
            try {
              await api(ctx, sessionId, { op: 'skill-delete', name: confirmDelete.name });
              notify({ kind: 'success', text: t('row.delete') });
              await reload();
            } catch (error) {
              notify({ kind: 'error', text: error.message });
            }
          },
        }) : null,
      );
    }

    function SkillEditor({ ctx, sessionId, t, notify, editor, onClose, onSaved }) {
      const [name, setName] = useState(editor.name ?? '');
      const [description, setDescription] = useState(editor.description ?? '');
      const [body, setBody] = useState(editor.body ?? '');
      const isNew = !editor.name;
      const save = async () => {
        try {
          await api(ctx, sessionId, { op: 'skill-save', name: name.trim(), description, body });
          notify({ kind: 'success', text: t('form.save') });
          onSaved();
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };
      return h(Modal, { title: isNew ? t('skills.new') : `${t('row.edit')} — ${name}`, onClose, wide: true },
        h('div', { className: 'asx-form' },
          h('div', { className: 'asx-form-grid' },
            h(Field, { label: t('skills.name'), hint: 'a-z 0-9 -' }, h('input', { className: 'asx-input', value: name, disabled: !isNew, onChange: (e) => setName(e.target.value) })),
            h(Field, { label: t('skills.description') }, h('input', { className: 'asx-input', value: description, onChange: (e) => setDescription(e.target.value) })),
          ),
          h(Field, { label: t('skills.body') }, h('textarea', { className: 'asx-textarea asx-mono', rows: 12, value: body, onChange: (e) => setBody(e.target.value) })),
          h('div', { className: 'asx-actions' },
            h('button', { type: 'button', className: 'asx-btn asx-btn-primary', onClick: save }, t('form.save')),
            h('button', { type: 'button', className: 'asx-btn', onClick: onClose }, t('form.cancel')),
          ),
        ),
      );
    }

    // -- custom tools manager ---------------------------------------------------

    function CustomToolsSection({ ctx, sessionId, t, notify }) {
      const [state, reload] = useAsync(() => api(ctx, sessionId, { op: 'tool-list' }), [sessionId]);
      const [editor, setEditor] = useState(null);
      const [confirmDelete, setConfirmDelete] = useState(null);
      const rows = state.data?.rows ?? [];
      const edit = async (row) => {
        try {
          const all = await api(ctx, sessionId, { op: 'tool-list' });
          const full = all.rows.find((item) => item.id === row.id);
          setEditor(full?.content !== undefined ? full : row);
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };
      return h('div', null,
        h('div', { className: 'asx-toolbar' },
          h('div', { className: 'asx-section-title', style: { margin: 0 } }, t('tools.custom')),
          h('div', { className: 'asx-toolbar-spacer' }),
          h('button', { type: 'button', className: 'asx-btn asx-btn-primary', onClick: () => setEditor({ id: null, name: '', description: '', content: '' }) }, t('tools.new')),
        ),
        h('div', { className: 'asx-dim' }, t('tools.customHint')),
        state.error ? h(Notice, { kind: 'error' }, state.error) : null,
        h('div', { className: 'asx-list' },
          rows.length === 0 && !state.busy ? h('div', { className: 'asx-empty' }, t('tools.noCustom')) : null,
          rows.map((row) => h('div', { key: row.id, className: 'asx-row' },
            h('div', { className: 'asx-row-main' },
              h('div', { className: 'asx-row-title' },
                h('span', { className: 'asx-mono' }, row.name),
                h('span', { className: `asx-badge ${row.live ? 'asx-badge-ok' : 'asx-badge-warn'}` }, row.live ? t('tools.live') : t('tools.inactive')),
              ),
              row.description ? h('div', { className: 'asx-row-desc' }, row.description) : null,
            ),
            h('div', { className: 'asx-row-actions' },
              h('button', { type: 'button', className: 'asx-btn', onClick: () => edit(row) }, t('row.edit')),
              h('button', { type: 'button', className: 'asx-btn asx-btn-danger-ghost', onClick: () => setConfirmDelete(row) }, t('row.delete')),
            ),
          )),
        ),
        editor ? h(CustomToolEditor, {
          ctx, sessionId, t, notify, editor, onClose: () => setEditor(null),
          onSaved: () => { setEditor(null); reload(); },
        }) : null,
        confirmDelete ? h(Confirm, {
          title: t('tools.delete'),
          body: t('tools.deleteBody').replace('{name}', confirmDelete.name),
          actionLabel: t('confirm.yes'),
          onClose: () => setConfirmDelete(null),
          onConfirm: async () => {
            try {
              await api(ctx, sessionId, { op: 'tool-delete', id: confirmDelete.id });
              notify({ kind: 'success', text: t('row.delete') });
              await reload();
            } catch (error) {
              notify({ kind: 'error', text: error.message });
            }
          },
        }) : null,
      );
    }

    function CustomToolEditor({ ctx, sessionId, t, notify, editor, onClose, onSaved }) {
      const [name, setName] = useState(editor.name ?? '');
      const [description, setDescription] = useState(editor.description ?? '');
      const [content, setContent] = useState(editor.content ?? '');
      const save = async () => {
        try {
          await api(ctx, sessionId, { op: 'tool-save', id: editor.id ?? undefined, name: name.trim(), description, content });
          notify({ kind: 'success', text: t('form.save') });
          onSaved();
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };
      return h(Modal, { title: editor.id ? `${t('row.edit')} — ${name}` : t('tools.new'), onClose, wide: true },
        h('div', { className: 'asx-form' },
          h('div', { className: 'asx-form-grid' },
            h(Field, { label: t('tools.name'), hint: 'a-z 0-9 _' }, h('input', { className: 'asx-input asx-mono', value: name, onChange: (e) => setName(e.target.value) })),
            h(Field, { label: t('form.description') }, h('input', { className: 'asx-input', value: description, onChange: (e) => setDescription(e.target.value) })),
          ),
          h(Field, { label: t('tools.content') }, h('textarea', { className: 'asx-textarea asx-mono', rows: 10, value: content, onChange: (e) => setContent(e.target.value) })),
          h('div', { className: 'asx-actions' },
            h('button', { type: 'button', className: 'asx-btn asx-btn-primary', onClick: save }, t('form.save')),
            h('button', { type: 'button', className: 'asx-btn', onClick: onClose }, t('form.cancel')),
          ),
        ),
      );
    }

    function ToolsTab({ ctx, sessionId, t, notify }) {
      const [state] = useAsync(() => api(ctx, sessionId, { op: 'tools' }), [sessionId]);
      const rows = state.data?.rows ?? [];
      return h('div', null,
        state.error ? h(Notice, { kind: 'error' }, state.error) : null,
        state.busy ? h('div', { className: 'asx-loading' }, t('loading')) : null,
        h('div', { className: 'asx-section-title' }, `${t('tools.title')} — ${rows.length} ${t('tools.count')}`),
        h('div', { className: 'asx-list' }, rows.map((row) => h('div', { key: row.name, className: 'asx-row' },
          h('div', { className: 'asx-row-main' },
            h('div', { className: 'asx-row-title' },
              h('span', { className: 'asx-mono' }, row.name),
              h('span', { className: 'asx-badge asx-badge-dim' }, row.categoryLabel ?? row.category),
            ),
          ),
        ))),
        state.data ? h(CustomToolsSection, { ctx, sessionId, t, notify }) : null,
      );
    }

    // -- settings tab --------------------------------------------------------------

    function SettingsTab({ ctx, sessionId, t, notify }) {
      const [state, reload] = useAsync(() => api(ctx, sessionId, { op: 'project-status' }), [sessionId]);
      const data = state.data;
      const save = async () => {
        try {
          const result = await api(ctx, sessionId, { op: 'project-save', all: true, confirm: true });
          notify({ kind: 'success', text: `${result.path} (${result.templates})` });
          await reload();
        } catch (error) {
          notify({ kind: 'error', text: error.message });
        }
      };
      return h('div', null,
        h('div', { className: 'asx-section-title' }, t('settings.project')),
        h('div', { className: 'asx-dim' }, t('settings.note')),
        state.busy ? h('div', { className: 'asx-loading' }, t('loading')) : null,
        state.error ? h(Notice, { kind: 'error' }, state.error) : null,
        data ? h('div', { className: 'asx-kv' },
          h('div', null, h('span', { className: 'asx-kv-key' }, t('settings.projectRoot')), h('span', { className: 'asx-mono' }, data.root ?? '—')),
          h('div', null, h('span', { className: 'asx-kv-key' }, t('settings.projectFile')), h('span', { className: 'asx-mono' }, data.file)),
          h('div', null, h('span', { className: 'asx-kv-key' }, t('settings.projectIds')), data.exists ? (data.ids?.join(', ') || '—') : t('settings.projectMissing')),
          data.error ? h(Notice, { kind: 'error' }, `${t('settings.projectError')}: ${data.error}`) : null,
        ) : null,
        h('div', { className: 'asx-actions' }, h('button', { type: 'button', className: 'asx-btn', onClick: save }, t('settings.projectSave'))),
      );
    }

    // -- import / export tab ----------------------------------------------------------

    function TransferTab({ ctx, sessionId, t, notify }) {
      const [exported, setExported] = useState('');
      const [importText, setImportText] = useState('');
      const [strategy, setStrategy] = useState('merge');
      const [confirmOverwrite, setConfirmOverwrite] = useState(false);
      const [preview, setPreview] = useState(null);
      const exportAll = async () => {
        try {
          const result = await api(ctx, sessionId, { op: 'export', all: true });
          setExported(JSON.stringify(result.document, null, 2));
          notify({ kind: 'success', text: t('transfer.exportAll') });
        } catch (error) { notify({ kind: 'error', text: error.message }); }
      };
      const doPreview = async () => {
        setPreview(null);
        try {
          const result = await api(ctx, sessionId, { op: 'import', document: importText, strategy });
          setPreview(result);
        } catch (error) { notify({ kind: 'error', text: error.message }); }
      };
      const doApply = async () => {
        try {
          const result = await api(ctx, sessionId, { op: 'import', document: importText, strategy, apply: true, confirmOverwrite });
          setPreview(null);
          setImportText('');
          notify({ kind: 'success', text: JSON.stringify(result.outcomes) });
        } catch (error) { notify({ kind: 'error', text: error.message }); }
      };
      const needsConfirmation = preview?.diff?.some((entry) => entry.action === 'update') ?? false;
      return h('div', null,
        h('div', { className: 'asx-section-title' }, t('transfer.title')),
        h('div', { className: 'asx-actions' },
          h('button', { type: 'button', className: 'asx-btn', onClick: exportAll }, t('transfer.exportAll')),
          h('button', { type: 'button', className: 'asx-btn', disabled: !exported, onClick: () => { navigator.clipboard?.writeText(exported); notify({ kind: 'success', text: t('copied') }); } }, t('transfer.copy')),
          h('button', { type: 'button', className: 'asx-btn', disabled: !exported, onClick: () => downloadJson(exported, 'agent-studio-templates.json') }, t('transfer.download')),
        ),
        exported ? h('textarea', { className: 'asx-textarea asx-mono', rows: 8, readOnly: true, value: exported, onFocus: (e) => e.target.select() }) : null,
        h('div', { className: 'asx-section-title' }, t('transfer.importTitle')),
        h('textarea', { className: 'asx-textarea asx-mono', rows: 8, placeholder: t('transfer.importPlaceholder'), value: importText, onChange: (e) => setImportText(e.target.value) }),
        h('div', { className: 'asx-actions' },
          select(t('transfer.strategy'), strategy, ['merge', 'overwrite', 'skip-existing', 'create-copy'], setStrategy),
          h('button', { type: 'button', className: 'asx-btn', disabled: !importText.trim(), onClick: doPreview }, t('transfer.preview')),
          h('label', { className: 'asx-check' },
            h('input', { type: 'checkbox', checked: confirmOverwrite, onChange: (e) => setConfirmOverwrite(e.target.checked) }),
            t('transfer.confirmOverwrite'),
          ),
        ),
        preview ? h('div', null,
          h('div', { className: 'asx-section-title' }, t('transfer.diff')),
          (preview.warnings ?? []).map((warning, index) => h(Notice, { key: index, kind: 'error' }, warning)),
          h('div', { className: 'asx-list' }, (preview.diff ?? []).map((entry) => h('div', { key: entry.id, className: 'asx-row' },
            h('div', { className: 'asx-row-main' },
              h('div', { className: 'asx-row-title' },
                h('span', { className: 'asx-mono' }, entry.id),
                h('span', { className: `asx-badge ${entry.action === 'create' ? 'asx-badge-ok' : entry.action === 'update' ? 'asx-badge-warn' : 'asx-badge-dim'}` }, entry.action),
                h('span', { className: 'asx-dim' }, entry.name),
              ),
              entry.changes ? h('div', { className: 'asx-row-desc' }, entry.changes.map((change) => change.field).join(', ')) : null,
            ),
          ))),
          h('div', { className: 'asx-actions' },
            h('button', { type: 'button', className: 'asx-btn asx-btn-primary', onClick: doApply }, t('transfer.apply')),
          ),
        ) : null,
        needsConfirmation && !confirmOverwrite ? h(Notice, { kind: 'error' }, t('transfer.confirmOverwrite')) : null,
      );
    }

    // -- main panel -------------------------------------------------------------------

    function AgentStudioPanel(props) {
      const t = props.t;
      const ctx = props.ctx;
      const [tab, setTab] = useState('agents');
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
      const tabs = [
        ['agents', t('tab.agents')],
        ['skills', t('tab.skills')],
        ['tools', t('tab.tools')],
        ['settings', t('tab.settings')],
        ['transfer', t('tab.transfer')],
      ];
      return h('div', { className: 'asx-panel' },
        h('div', { className: 'asx-header' },
          h('div', { className: 'asx-title' }, t('panel')),
          h('div', { className: 'asx-tabs', role: 'tablist' },
            tabs.map(([key, label]) => h('button', {
              key, type: 'button', role: 'tab', 'aria-selected': tab === key,
              className: `asx-tab${tab === key ? ' asx-tab-active' : ''}`,
              onClick: () => setTab(key),
            }, label)),
          ),
        ),
        notice ? h(Notice, { kind: notice.kind, onClose: () => setNotice(null) }, notice.text) : null,
        !sessionId ? h(Notice, { kind: 'error' }, t('transfer.noSession')) : h('div', { className: 'asx-body' },
          tab === 'agents' ? h(AgentsTab, { ctx, sessionId, t, notify }) : null,
          tab === 'skills' ? h(SkillsTab, { ctx, sessionId, t, notify }) : null,
          tab === 'tools' ? h(ToolsTab, { ctx, sessionId, t, notify }) : null,
          tab === 'settings' ? h(SettingsTab, { ctx, sessionId, t, notify }) : null,
          tab === 'transfer' ? h(TransferTab, { ctx, sessionId, t, notify }) : null,
        ),
      );
    }

    // -- launcher overlay (quick pick + compact run form) --------------------------------

    function LauncherOverlay(props) {
      const t = props.t;
      const ctx = props.ctx;
      const open = useLauncher();
      const [step, setStep] = useState('pick');
      const [template, setTemplate] = useState(null);
      const [rows, setRows] = useState(null);
      const [query, setQuery] = useState('');
      const [task, setTask] = useState('');
      const [context, setContext] = useState('');
      const [model, setModel] = useState('');
      const [depth, setDepth] = useState('');
      const [background, setBackground] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [started, setStarted] = useState(null);

      const sessionId = open?.sessionId ?? null;
      const prefill = open?.prefill ?? '';

      useEffect(() => {
        if (!open) return;
        setStep('pick');
        setTemplate(null);
        setQuery('');
        setTask(prefill);
        setContext('');
        setModel('');
        setDepth('');
        setBackground(false);
        setBusy(false);
        setError(null);
        setStarted(null);
        setRows(null);
        if (sessionId) {
          api(ctx, sessionId, { op: 'list', status: 'enabled' })
            .then((result) => setRows(result.rows ?? []))
            .catch((err) => setError(err.message));
        }
      }, [open, sessionId, prefill]);

      if (!open) return null;
      const filtered = (rows ?? []).filter((row) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return `${row.name} ${row.role} ${row.tags.join(' ')}`.toLowerCase().includes(q);
      });

      const run = async () => {
        setBusy(true);
        setError(null);
        try {
          const overrides = {};
          if (model.trim()) {
            const value = model.trim();
            const slash = value.indexOf('/');
            overrides.model = slash > 0 ? { provider: value.slice(0, slash), model: value.slice(slash + 1) } : { model: value };
          }
          if (depth) overrides.maxDelegationDepth = Number(depth);
          const result = await api(ctx, sessionId, {
            op: 'run',
            template: template.id,
            task,
            ...(context.trim() ? { context } : {}),
            run_in_background: background,
            ...(Object.keys(overrides).length ? { overrides } : {}),
          });
          setStarted(result.subagentId);
          setBusy(false);
          setTimeout(() => launcher.close(), 2500);
        } catch (err) {
          setError(err.message);
          setBusy(false);
        }
      };

      return h('div', { className: 'asx-launcher-backdrop', onPointerDown: (e) => { if (e.target === e.currentTarget) launcher.close(); } },
        h('div', { className: 'asx-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('run.title') },
          h('div', { className: 'asx-modal-head' },
            h('div', { className: 'asx-modal-title' }, t('run.title')),
            h('button', { type: 'button', className: 'asx-btn asx-btn-ghost', onClick: () => launcher.close(), 'aria-label': 'Close' }, '×'),
          ),
          h('div', { className: 'asx-modal-body' },
            error ? h(Notice, { kind: 'error' }, error) : null,
            started ? h(Notice, { kind: 'success' }, `${t('started')}: ${started}`) : null,
            step === 'pick' ? h('div', null,
              h('input', { type: 'search', className: 'asx-input', placeholder: t('agents.search'), value: query, autoFocus: true, onChange: (e) => setQuery(e.target.value) }),
              h('div', { className: 'asx-launcher-list' },
                rows === null ? h('div', { className: 'asx-loading' }, t('loading')) : null,
                filtered.map((row) => h('button', {
                  key: `${row.origin}:${row.id}`, type: 'button', className: 'asx-launcher-row',
                  onClick: () => { setTemplate(row); setStep('form'); },
                },
                  h('div', { className: 'asx-row-title' },
                    h('span', { className: 'asx-row-name' }, row.name),
                    h('span', { className: 'asx-badge asx-badge-role' }, row.role),
                    row.hasProjectOverride ? h('span', { className: 'asx-badge asx-badge-info' }, t('agents.projectOverride')) : null,
                  ),
                  row.description ? h('div', { className: 'asx-row-desc' }, row.description) : null,
                  h('div', { className: 'asx-row-meta' }, PolicyBadges({ summary: row.policy, t })),
                )),
                rows !== null && filtered.length === 0 ? h('div', { className: 'asx-empty' }, t('agents.empty')) : null,
              ),
            ) : h('div', { className: 'asx-form' },
              h('div', { className: 'asx-row-title' },
                h('span', { className: 'asx-row-name' }, template?.name),
                template ? h('span', { className: 'asx-badge asx-badge-role' }, template.role) : null,
              ),
              template ? h('div', { className: 'asx-row-meta' }, PolicyBadges({ summary: template.policy, t })) : null,
              h(Field, { label: t('run.task') }, h('textarea', { className: 'asx-textarea', rows: 4, value: task, autoFocus: true, onChange: (e) => setTask(e.target.value) })),
              h(Field, { label: t('run.context') }, h('textarea', { className: 'asx-textarea', rows: 2, value: context, onChange: (e) => setContext(e.target.value) })),
              h('div', { className: 'asx-form-grid asx-form-grid-3' },
                h(Field, { label: t('run.model') }, h('input', { className: 'asx-input', value: model, placeholder: 'provider/model', onChange: (e) => setModel(e.target.value) })),
                h(Field, { label: t('run.depth') }, h('input', { className: 'asx-input', type: 'number', min: 1, max: 4, value: depth, onChange: (e) => setDepth(e.target.value) })),
                h(Field, { label: t('run.background') }, h('input', { type: 'checkbox', checked: background, onChange: (e) => setBackground(e.target.checked) })),
              ),
              h('div', { className: 'asx-actions' },
                h('button', { type: 'button', className: 'asx-btn', onClick: () => setStep('pick') }, t('run.back')),
                h('button', { type: 'button', className: 'asx-btn asx-btn-primary', disabled: busy || !task.trim() || !template, onClick: run }, t('run.submit')),
              ),
            ),
          ),
        ),
      );
    }

    // -- styles -----------------------------------------------------------------------

    const STYLES = `
.asx-panel{box-sizing:border-box;height:100%;display:flex;flex-direction:column;background:transparent;color:var(--dsw-alias-label-primary,#111);font-size:13px;line-height:1.45;overflow:hidden}
.asx-header{padding:16px 20px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#d9dde3)}
.asx-title{font-size:18px;font-weight:600;margin-bottom:12px}
.asx-tabs{display:flex;gap:2px}
.asx-tab{appearance:none;background:none;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary,#5b6470);padding:8px 12px;font:inherit;cursor:pointer}
.asx-tab-active{color:var(--dsw-alias-label-primary,#1a1d23);border-bottom-color:var(--dsw-alias-brand-primary,#247bbf);font-weight:600}
.asx-body{flex:1;overflow:auto;padding:16px 20px}
.asx-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.asx-toolbar-spacer{flex:1}
.asx-input{background:var(--dsw-alias-bg-layer-1,#f5f6f8);border:1px solid var(--dsw-alias-border-l1,#d9dde3);border-radius:8px;color:var(--dsw-alias-label-primary,#1a1d23);padding:6px 10px;font:inherit;min-width:0}
.asx-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#247bbf)}
.asx-input-compact{padding:2px 6px;font-size:12px;width:100%}
.asx-search{flex:1;min-width:180px;max-width:320px}
.asx-select{display:inline-flex}
.asx-btn{appearance:none;background:var(--dsw-alias-bg-layer-1,#f5f6f8);border:1px solid var(--dsw-alias-border-l1,#d9dde3);border-radius:8px;color:var(--dsw-alias-label-primary,#1a1d23);padding:5px 12px;font:inherit;cursor:pointer}
.asx-btn:hover{background:var(--dsw-alias-bg-layer-2,#eceef2)}
.asx-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#247bbf);outline-offset:1px}
.asx-btn:disabled{opacity:.5;cursor:default}
.asx-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#247bbf));border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.asx-btn-danger-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-state-error-primary,#c73a3a)}
.asx-btn-danger-ghost:hover{background:var(--dsw-alias-bg-layer-2,#eceef2)}
.asx-btn-danger{background:var(--dsw-alias-state-error-primary,#c73a3a);border-color:var(--dsw-alias-state-error-primary,#c73a3a);color:#fff}
.asx-btn-ghost{border-color:transparent;background:transparent}
.asx-list{display:flex;flex-direction:column;gap:8px}
.asx-row{display:flex;gap:12px;align-items:flex-start;background:var(--dsw-alias-bg-layer-1,#f5f6f8);border:1px solid var(--dsw-alias-border-l1,#d9dde3);border-radius:10px;padding:10px 12px}
.asx-row-main{flex:1;min-width:0}
.asx-row-title{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.asx-row-name{font-weight:600}
.asx-row-desc{color:var(--dsw-alias-label-secondary,#5b6470);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.asx-row-meta{display:flex;gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap}
.asx-row-actions{display:flex;gap:6px;align-items:center}
.asx-badge{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;background:var(--dsw-alias-bg-layer-2,#eceef2);border:1px solid var(--dsw-alias-border-l1,#d9dde3);color:var(--dsw-alias-label-secondary,#5b6470);white-space:nowrap}
.asx-badge-ok{color:var(--dsw-alias-state-success-primary,#2f8a4c);border-color:var(--dsw-alias-state-success-primary,#2f8a4c)}
.asx-badge-bad{color:var(--dsw-alias-state-error-primary,#c73a3a);border-color:var(--dsw-alias-state-error-primary,#c73a3a)}
.asx-badge-warn{color:var(--dsw-alias-state-warn-primary,#b97a1f);border-color:var(--dsw-alias-state-warn-primary,#b97a1f)}
.asx-badge-info{color:var(--dsw-alias-brand-primary,#247bbf);border-color:var(--dsw-alias-brand-primary,#247bbf)}
.asx-badge-dim{opacity:.75}
.asx-badge-role{color:var(--dsw-alias-brand-primary,#247bbf)}
.asx-policy-badges{display:inline-flex;gap:4px}
.asx-dim{color:var(--dsw-alias-label-secondary,#5b6470);font-size:12px}
.asx-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.asx-menu-wrap{position:relative}
.asx-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:200px;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#c2c8d0);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);padding:4px;display:flex;flex-direction:column}
.asx-menu-item{appearance:none;background:none;border:none;text-align:left;color:var(--dsw-alias-label-primary,#1a1d23);padding:7px 10px;border-radius:6px;font:inherit;cursor:pointer;white-space:nowrap}
.asx-menu-item:hover{background:var(--dsw-alias-bg-layer-2,#eceef2)}
.asx-menu-danger{color:var(--dsw-alias-state-error-primary,#c73a3a)}
.asx-menu-primary{font-weight:600}
.asx-modal-backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}
.asx-modal{background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#1a1d23);border:1px solid var(--dsw-alias-border-l2,#c2c8d0);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.35);width:520px;max-width:100%;max-height:90vh;display:flex;flex-direction:column}
.asx-modal-wide{width:860px}
.asx-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,#d9dde3)}
.asx-modal-title{font-weight:600;font-size:15px}
.asx-modal-body{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.asx-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.asx-field-label{font-size:12px;color:var(--dsw-alias-label-secondary,#5b6470)}
.asx-field-hint{font-size:11px;color:var(--dsw-alias-label-secondary,#5b6470)}
.asx-textarea{width:100%;background:var(--dsw-alias-bg-layer-1,#f5f6f8);border:1px solid var(--dsw-alias-border-l1,#d9dde3);border-radius:8px;color:var(--dsw-alias-label-primary,#1a1d23);padding:8px 10px;font:inherit;resize:vertical}
.asx-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#247bbf)}
.asx-mono.asx-textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.asx-form{display:flex;flex-direction:column;gap:12px}
.asx-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.asx-form-grid-3{grid-template-columns:2fr 2fr 1fr}
.asx-form-grid-2{grid-template-columns:1fr 1fr}
.asx-section-title{font-weight:600;margin:6px 0}
.asx-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.asx-switch{width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#eceef2);border:1px solid var(--dsw-alias-border-l2,#c2c8d0);position:relative;cursor:pointer;padding:0}
.asx-switch-on{background:var(--dsw-alias-brand-primary,#247bbf);border-color:var(--dsw-alias-brand-primary,#247bbf)}
.asx-switch-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}
.asx-switch-on .asx-switch-knob{left:18px}
.asx-check{display:inline-flex;gap:6px;align-items:center;color:var(--dsw-alias-label-secondary,#5b6470)}
.asx-tools-table{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1,#d9dde3);border-radius:10px;max-height:300px;overflow:auto}
.asx-tools-head,.asx-tools-row{display:grid;grid-template-columns:minmax(140px,1.2fr) 1fr 110px 1.4fr 90px;gap:8px;padding:6px 10px;align-items:center}
.asx-tools-head{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2,#eceef2);font-size:12px;color:var(--dsw-alias-label-secondary,#5b6470)}
.asx-tools-row{border-top:1px solid var(--dsw-alias-border-l1,#d9dde3)}
.asx-table{width:100%;border-collapse:collapse;font-size:12px}
.asx-table th,.asx-table td{text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1,#d9dde3);padding:5px 8px}
.asx-kv{display:flex;flex-direction:column;gap:6px}
.asx-kv-key{display:inline-block;min-width:140px;color:var(--dsw-alias-label-secondary,#5b6470)}
.asx-notice{display:flex;gap:8px;align-items:flex-start;border-radius:10px;padding:8px 12px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l1,#d9dde3);background:var(--dsw-alias-bg-layer-1,#f5f6f8)}
.asx-notice-error{border-color:var(--dsw-alias-state-error-primary,#c73a3a);color:var(--dsw-alias-state-error-primary,#c73a3a)}
.asx-notice-success{border-color:var(--dsw-alias-state-success-primary,#2f8a4c)}
.asx-notice-text{flex:1}
.asx-notice-close{padding:0 4px}
.asx-loading{color:var(--dsw-alias-label-secondary,#5b6470);padding:16px 0}
.asx-empty{color:var(--dsw-alias-label-secondary,#5b6470);padding:24px 0;text-align:center}
.asx-confirm-body{color:var(--dsw-alias-label-primary,#1a1d23)}
.asx-launcher-backdrop{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:10vh}
.asx-launcher-list{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto;margin-top:10px}
.asx-launcher-row{appearance:none;text-align:left;background:var(--dsw-alias-bg-layer-1,#f5f6f8);border:1px solid var(--dsw-alias-border-l1,#d9dde3);border-radius:10px;padding:10px 12px;font:inherit;color:inherit;cursor:pointer}
.asx-launcher-row:hover{background:var(--dsw-alias-bg-layer-2,#eceef2)}
.asx-selection-btn{appearance:none;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#1a1d23);border:1px solid var(--dsw-alias-border-l2,#c2c8d0);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
    `.trim();

    // -- icons ------------------------------------------------------------------------

    function PanelGlyph({ size = 18 }) {
      return h('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 4, y: 4, width: 56, height: 56, rx: 14, fill: 'var(--dsw-alias-brand-primary, #247bbf)' }),
        h('circle', { cx: 20, cy: 22, r: 7, fill: '#fff' }),
        h('circle', { cx: 44, cy: 22, r: 7, fill: 'rgba(255,255,255,.65)' }),
        h('circle', { cx: 32, cy: 44, r: 7, fill: '#fff' }),
        h('path', { d: 'M25 26 L29 38 M39 26 L35 38 M27 44 L37 44', stroke: 'rgba(255,255,255,.65)', 'stroke-width': 4, 'stroke-linecap': 'round', fill: 'none' }),
        h('path', { d: 'M27 22 L37 22', stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none' }),
      );
    }

    function MenuGlyph({ size = 16 }) {
      return h('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
        h('circle', { cx: 32, cy: 20, r: 8, fill: 'currentColor' }),
        h('circle', { cx: 22, cy: 44, r: 8, fill: 'currentColor', opacity: .6 }),
        h('circle', { cx: 42, cy: 44, r: 8, fill: 'currentColor', opacity: .6 }),
        h('path', { d: 'M27 27 L24 37 M37 27 L40 37 M29 44 L35 44', stroke: 'currentColor', 'stroke-width': 4, 'stroke-linecap': 'round', fill: 'none' }),
      );
    }

    // -- apply -------------------------------------------------------------------------

    const inject = ['slots', 'locale', 'remote', 'remote.commands', 'contextMenus', 'uiConversation'];

    /** Inject one stylesheet element owned by the plugin (removed on unload). */
    function injectStyles() {
      const element = document.createElement('style');
      element.setAttribute('data-agent-studio', '');
      element.textContent = STYLES;
      document.head.appendChild(element);
      return () => element.remove();
    }

    function apply(ctx) {
      ctx.effect(injectStyles, 'agent-studio: stylesheet');
      ctx.effect(() => ctx.locale.register(NS, { en, ru }), 'agent-studio: dictionaries');
      const t = ctx.locale.bind(NS);

      // Panel + left navigation entry.
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'agent-studio',
        locale: NS,
        inject: () => ({ ctx, t }),
      }, AgentStudioPanel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'agent-studio',
        order: 20,
        label: () => t('panel'),
        locale: NS,
      }, PanelGlyph));

      // Launcher overlay for context-menu and selection entries.
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'agent-studio.launcher',
        locale: NS,
        inject: () => ({ ctx, t }),
      }, LauncherOverlay));

      // Context-menu glyph for the "Run subagent" action.
      ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({
        name: 'contextMenu.icon',
        key: 'agent-studio.run',
      }, MenuGlyph));

      // "Run subagent" in the session context menu.
      ctx.effect(() => ctx.contextMenus.register({
        id: 'agent-studio.run-subagent',
        target: 'session',
        order: 150,
        observe: () => [ctx.locale],
        resolve: (target) => [{
          id: 'run-subagent',
          label: t('selectRun'),
          icon: { key: 'agent-studio.run' },
          run: () => {
            launcher.open({ sessionId: target.sessionId, prefill: '' });
          },
        }],
      }), 'agent-studio: session menu action');

      // "Run subagent" on selected chat text.
      try {
        ctx.uiConversation.interactions.register({
          id: 'agent-studio.run-selection',
          onInteraction(request) {
            if (request.trigger !== 'selection' || request.readText() === null) return;
            launcher.pending = { sessionId: request.sessionId };
            request.open();
          },
        });
        ctx.slots.inject('conversation.chat.text-interaction', () => ctx.slots.register({
          name: 'conversation.chat.text-interaction',
          key: 'agent-studio.run-selection',
          locale: NS,
          inject: () => ({ ctx, t }),
        }, SelectionAction));
      } catch {
        // uiConversation without interactions support: selection gesture unavailable.
      }

      return () => {};
    }

    function SelectionAction({ dismiss, readText, clearSelection, useSession, t: translate }) {
      const enabled = useSession?.((s) => !s.removed) ?? true;
      useEffect(() => { if (!enabled) dismiss?.(); }, [enabled, dismiss]);
      if (!enabled) return null;
      return h('button', {
        type: 'button',
        className: 'asx-selection-btn',
        onClick: () => {
          const textValue = readText?.();
          if (textValue === null || textValue === undefined) { dismiss?.(); return; }
          const sessionId = launcher.pending?.sessionId ?? null;
          if (sessionId) {
            launcher.open({ sessionId, prefill: textValue });
            launcher.pending = null;
          }
          clearSelection?.();
          dismiss?.();
        },
      }, translate('selectRun'));
    }

    return { inject, apply };
  },
});
