/**
 * sdd-workflow-plugin — Client-половина (Web UI).
 *
 * Регистрирует:
 *  - элемент «SDD Workflow» в левой навигации (слот `sidebar.panellist`);
 *  - основную панель в слоте `main` (key "sdd-workflow").
 *
 * Все данные проходят через сессионные команды `/sdd-*` на Host.
 * Плагин не выполняет сетевых запросов и не исполняет произвольный HTML.
 */

window.__ModuleLoader__.load({
  id: '@local/sdd-workflow-plugin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo } = React;

    const NS = 'sddWorkflow';
    const PANEL_ID = 'sdd-workflow';

    // -- словарь (интерфейс — русский, en — запасной) --------------------------

    const ru = {
      panel: 'SDD Workflow',
      title: 'Spec-Driven Development',
      noSession: 'Откройте сессию с рабочим каталогом: SDD-артефакты создаются в <workspace>/.sdd/.',
      loading: 'Загрузка…',
      refresh: 'Обновить',
      notInitialized: 'SDD workspace не инициализирован.',
      init: 'Инициализировать',
      initConfirm: 'Переинициализировать (перезаписать черновик)',
      stage: 'Стадия цикла',
      nextAction: 'Следующее действие',
      spec: 'Спецификация',
      specIssues: 'Находки валидации спецификации',
      plan: 'План',
      tasks: 'Задачи',
      traceability: 'Трассируемость',
      uncovered: 'Непокрытые критерии приёмки',
      lastValidation: 'Последняя валидация',
      blockers: 'Блокеры',
      noBlockers: 'Блокеров нет',
      validate: 'Запустить валидацию',
      export: 'Экспортировать пакет',
      status: 'Статус',
      confirmOverwrite: 'Подтверждаю перезапись',
      id: 'ID',
      title: 'Название',
      version: 'Версия',
      specStatus: 'Статус',
      owner: 'Владелец',
      requirements: 'Требования',
      criteria: 'Критерии',
      openQuestions: 'Открытые вопросы',
      items: 'пунктов',
      coverage: 'покрытие',
      total: 'всего',
      covered: 'покрыто',
      partial: 'частично',
      failed: 'провалено',
      passed: 'пройдено',
      featureComplete: 'Фича завершена',
      yes: 'да',
      no: 'нет',
      actions: 'Действия',
      exported: 'Пакет экспортирован в .sdd/export/',
      validationRun: 'Валидация выполнена',
      error: 'Ошибка',
      noPlan: 'План не сгенерирован',
      noTasks: 'Задачи не сгенерированы',
      readyTasks: 'Готовы к реализации',
      history: 'Снимки истории',
    };

    const en = {
      panel: 'SDD Workflow',
      title: 'Spec-Driven Development',
      noSession: 'Open a session with a working directory: SDD artifacts live in <workspace>/.sdd/.',
      loading: 'Loading…',
      refresh: 'Refresh',
      notInitialized: 'SDD workspace is not initialized.',
      init: 'Initialize',
      initConfirm: 'Re-initialize (overwrite draft)',
      stage: 'Cycle stage',
      nextAction: 'Recommended next action',
      spec: 'Specification',
      specIssues: 'Specification validation findings',
      plan: 'Plan',
      tasks: 'Tasks',
      traceability: 'Traceability',
      uncovered: 'Uncovered acceptance criteria',
      lastValidation: 'Last validation',
      blockers: 'Blockers',
      noBlockers: 'No blockers',
      validate: 'Run validation',
      export: 'Export package',
      status: 'Status',
      confirmOverwrite: 'I confirm overwrite',
      id: 'ID',
      title: 'Title',
      version: 'Version',
      specStatus: 'Status',
      owner: 'Owner',
      requirements: 'Requirements',
      criteria: 'Criteria',
      openQuestions: 'Open questions',
      items: 'items',
      coverage: 'coverage',
      total: 'total',
      covered: 'covered',
      partial: 'partial',
      failed: 'failed',
      passed: 'passed',
      featureComplete: 'Feature complete',
      yes: 'yes',
      no: 'no',
      actions: 'Actions',
      exported: 'Package exported to .sdd/export/',
      validationRun: 'Validation finished',
      error: 'Error',
      noPlan: 'Plan not generated',
      noTasks: 'Tasks not generated',
      readyTasks: 'Ready to implement',
      history: 'History snapshots',
    };

    // -- API-мост: сессионные команды на Host ----------------------------------

    async function api(ctx, sessionId, command, args) {
      const line = args && Object.keys(args).length > 0 ? `/${command} ${JSON.stringify(args)}` : `/${command}`;
      const outcome = await ctx.remote.commands.execute(sessionId, line, []);
      if (!outcome.ok) throw new Error(outcome.error?.message ?? `Команда /${command} не выполнена`);
      const result = outcome.value?.result;
      if (!result) throw new Error(`Команда /${command} не вернула результат`);
      if (result.kind === 'error') {
        let payload = null;
        try { payload = JSON.parse(result.text); } catch { /* простой текст ошибки */ }
        throw new Error(payload?.error ?? result.text);
      }
      return JSON.parse(result.text);
    }

    function useAsync(fn, deps) {
      const [state, setState] = useState({ busy: true, data: null, error: null });
      useEffect(() => {
        let alive = true;
        setState((current) => ({ ...current, busy: true, error: null }));
        fn().then(
          (data) => { if (alive) setState({ busy: false, data, error: null }); },
          (error) => { if (alive) setState({ busy: false, data: null, error }); },
        );
        return () => { alive = false; };
      }, deps);
      return [state, () => setState((current) => ({ ...current, busy: true })), setState];
    }

    function Notice({ notice, onClose }) {
      if (!notice) return null;
      return h('div', { className: `sdd-notice sdd-notice-${notice.kind}`, role: notice.kind === 'error' ? 'alert' : 'status' },
        h('span', { className: 'sdd-notice-text' }, notice.text),
        onClose ? h('button', { type: 'button', className: 'sdd-btn sdd-btn-ghost sdd-notice-close', 'aria-label': '×', onClick: onClose }, '×') : null,
      );
    }

    function Row({ label, children }) {
      return h('div', { className: 'sdd-row' }, h('span', { className: 'sdd-row-label' }, label), h('span', { className: 'sdd-row-value' }, children));
    }

    function Badge({ tone, children }) {
      return h('span', { className: `sdd-badge sdd-badge-${tone ?? 'neutral'}` }, children);
    }

    function severityTone(severity) {
      if (severity === 'blocker') return 'error';
      if (severity === 'major') return 'warn';
      return 'neutral';
    }

    // -- основная панель ---------------------------------------------------------

    function SddPanel({ ctx, t, props }) {
      const sessionsState = props?.useSessions?.((state) => state) ?? null;
      const sessionId = useMemo(() => {
        const byId = sessionsState?.byId ?? {};
        const main = Object.values(byId).find((session) => (session.retainedBy?.mainView ?? 0) > 0);
        return main?.id ?? null;
      }, [sessionsState]);

      const [notice, setNotice] = useState(null);
      const notify = useCallback((kind, text) => {
        setNotice({ kind, text });
        if (kind !== 'error') setTimeout(() => setNotice((current) => (current && current.text === text ? null : current)), 5000);
      }, []);

      const [statusState, reloadStatus] = useAsync(() => (sessionId ? api(ctx, sessionId, 'sdd-status') : Promise.resolve(null)), [sessionId]);
      const [issuesState, reloadIssues] = useAsync(async () => {
        if (!sessionId) return null;
        try {
          return await api(ctx, sessionId, 'sdd-spec', { op: 'validate' });
        } catch (error) {
          if (String(error.message).includes('SDD_NOT_INITIALIZED')) return null;
          throw error;
        }
      }, [sessionId, statusState.data?.spec?.updated_at]);
      const [tasksState, reloadTasks] = useAsync(async () => {
        if (!sessionId) return null;
        try {
          return await api(ctx, sessionId, 'sdd-tasks', { op: 'list' });
        } catch (error) {
          if (String(error.message).includes('SDD_NOT_INITIALIZED')) return null;
          throw error;
        }
      }, [sessionId, statusState.data?.tasks?.updated_at]);

      const status = statusState.data;
      const reloadAll = useCallback(() => {
        reloadStatus();
        reloadIssues();
        reloadTasks();
      }, [reloadStatus, reloadIssues, reloadTasks]);

      const run = useCallback(async (command, args, message) => {
        try {
          const result = await api(ctx, sessionId, command, args ?? {});
          if (message) notify('success', typeof message === 'function' ? message(result) : message);
          reloadAll();
          return result;
        } catch (error) {
          notify('error', error.message);
          return null;
        }
      }, [ctx, sessionId, notify, reloadAll]);

      const [confirmInit, setConfirmInit] = useState(false);

      const body = (() => {
        if (!sessionId) return h('p', { className: 'sdd-empty' }, t('noSession'));
        if (statusState.busy && !status) return h('p', { className: 'sdd-empty' }, t('loading'));
        if (statusState.error) {
          return h('div', { className: 'sdd-empty' },
            h('p', null, t('notInitialized')),
            confirmInit
              ? h('button', { type: 'button', className: 'sdd-btn sdd-btn-danger', onClick: () => run('sdd-init', { confirm_overwrite: true }, t('init')) }, t('initConfirm'))
              : h('button', { type: 'button', className: 'sdd-btn sdd-btn-primary', onClick: () => setConfirmInit(true) }, t('init')),
          );
        }
        if (!status) return h('p', { className: 'sdd-empty' }, t('notInitialized'));

        const spec = status.spec;
        const issues = issuesState?.data?.issues ?? [];
        const tasks = tasksState?.data;
        return h('div', { className: 'sdd-body' },
          h('div', { className: 'sdd-section' },
            h('div', { className: 'sdd-group-title' }, t('stage')),
            h(Row, { label: t('stage') }, h(Badge, { tone: status.stage === 'complete' ? 'ok' : status.stage === 'blocked_by_validation' || status.stage === 'spec_blocked' ? 'error' : 'neutral' }, String(status.stage))),
            h(Row, { label: t('nextAction') }, String(status.action ?? status.recommended_next_action ?? '')),
          ),
          spec ? h('div', { className: 'sdd-section' },
            h('div', { className: 'sdd-group-title' }, `${t('spec')} — ${spec.id ?? ''}`),
            h(Row, { label: t('title') }, String(spec.title ?? '')),
            h(Row, { label: t('version') }, `${spec.version ?? ''} (${spec.status ?? ''})`),
            h(Row, { label: t('owner') }, String(spec.owner ?? '')),
            h(Row, { label: t('requirements') }, `${spec.counts?.functional_requirements ?? 0} + НФТ ${spec.counts?.non_functional_requirements ?? 0}`),
            h(Row, { label: t('criteria') }, String(spec.counts?.acceptance_criteria ?? 0)),
            h(Row, { label: t('openQuestions') }, String(spec.counts?.open_questions ?? 0)),
          ) : null,
          issues.length > 0 ? h('div', { className: 'sdd-section' },
            h('div', { className: 'sdd-group-title' }, t('specIssues')),
            h('ul', { className: 'sdd-list' }, issues.slice(0, 12).map((issue, index) =>
              h('li', { key: `${issue.code}-${index}`, className: 'sdd-issue' },
                h(Badge, { tone: severityTone(issue.severity) }, issue.severity), ' ',
                h('span', { className: 'sdd-mono' }, issue.field), ' — ', issue.message,
              ))),
          ) : null,
          status.plan ? h('div', { className: 'sdd-section' },
            h('div', { className: 'sdd-group-title' }, t('plan')),
            h(Row, { label: t('items') }, `${status.plan.items} (${status.plan.status})`),
          ) : h('div', { className: 'sdd-section' }, h('div', { className: 'sdd-group-title' }, t('plan')), h('p', { className: 'sdd-empty' }, t('noPlan'))),
          tasks ? h('div', { className: 'sdd-section' },
            h('div', { className: 'sdd-group-title' }, `${t('tasks')} — ${tasks.summary?.total ?? 0}`),
            h(Row, { label: t('readyTasks') }, String(status.ready_tasks ?? 0)),
            h('div', { className: 'sdd-tasks' },
              ['todo', 'in_progress', 'blocked', 'review', 'done'].map((key) =>
                h(Badge, { key, tone: key === 'done' ? 'ok' : key === 'blocked' ? 'error' : 'neutral' }, `${key}: ${tasks.summary?.[key] ?? 0}`)),
            ),
          ) : h('div', { className: 'sdd-section' }, h('div', { className: 'sdd-group-title' }, t('tasks')), h('p', { className: 'sdd-empty' }, t('noTasks'))),
          status.traceability ? h('div', { className: 'sdd-section' },
            h('div', { className: 'sdd-group-title' }, `${t('traceability')} — ${Math.round((status.traceability.coverage_ratio ?? 0) * 100)}%`),
            h('div', { className: 'sdd-tasks' },
              h(Badge, { tone: 'ok' }, `${t('covered')}: ${status.traceability.covered}`),
              h(Badge, { tone: 'warn' }, `${t('partial')}: ${status.traceability.partial}`),
              h(Badge, { tone: 'error' }, `${t('total')}/${t('failed')}: ${status.traceability.uncovered}`),
            ),
            status.uncovered_criteria > 0 ? h(Row, { label: t('uncovered') }, String(status.uncovered_criteria)) : null,
          ) : null,
          status.last_validation ? h('div', { className: 'sdd-section' },
            h('div', { className: 'sdd-group-title' }, t('lastValidation')),
            h(Row, { label: t('lastValidation') }, h(Badge, { tone: status.last_validation.overall === 'passed' ? 'ok' : 'error' }, String(status.last_validation.overall))),
            h(Row, { label: t('featureComplete') }, status.last_validation.feature_complete ? t('yes') : t('no')),
            h(Row, { label: t('failed') }, `${status.last_validation.summary?.failed ?? 0} / blocked ${status.last_validation.summary?.blocked ?? 0}`),
          ) : null,
          (status.blockers ?? []).length > 0 ? h('div', { className: 'sdd-section' },
            h('div', { className: 'sdd-group-title' }, t('blockers')),
            h('ul', { className: 'sdd-list' }, status.blockers.map((blocker, index) => h('li', { key: index, className: 'sdd-issue' }, String(blocker)))),
          ) : h('div', { className: 'sdd-section' },
            h('div', { className: 'sdd-group-title' }, t('blockers')),
            h('p', { className: 'sdd-empty' }, t('noBlockers')),
          ),
        );
      })();

      return h('div', { className: 'sdd-panel' },
        h('div', { className: 'sdd-head' },
          h('div', { className: 'sdd-title' }, t('title')),
          h('div', { className: 'sdd-actions' },
            h('button', { type: 'button', className: 'sdd-btn', onClick: reloadAll }, t('refresh')),
            h('button', { type: 'button', className: 'sdd-btn sdd-btn-primary', onClick: () => run('sdd-validate', {}, t('validationRun')) }, t('validate')),
            h('button', { type: 'button', className: 'sdd-btn', onClick: () => run('sdd-export', {}, t('exported')) }, t('export')),
          ),
        ),
        h(Notice, { notice, onClose: () => setNotice(null) }),
        h('div', { className: 'sdd-scroll' }, body),
      );
    }

    function PanelGlyph({ size = 18 }) {
      return h('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 4, y: 4, width: 56, height: 56, rx: 14, fill: 'var(--dsw-alias-brand-primary, #4a7dc4)' }),
        h('path', { d: 'M18 18h28v6H18zM18 30h20v6H18zM18 42h24v6H18z', fill: '#fff' }),
        h('circle', { cx: 46, cy: 45, r: 9, fill: '#8fe08f' }),
        h('path', { d: 'M42.5 45l2.5 2.5 5-5.5', fill: 'none', stroke: '#1c5c22', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      );
    }

    // -- стили (токены темы хоста, см. practices.md) ----------------------------

    const STYLES = `
    .sdd-panel{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fbfcfd);color:var(--dsw-alias-label-primary,#1c1d21);font-size:13px;line-height:1.45;overflow:hidden}
    .sdd-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,#dcdee2);flex:none}
    .sdd-title{font-weight:600;font-size:15px}
    .sdd-actions{display:flex;gap:8px;flex-wrap:wrap}
    .sdd-scroll{overflow:auto;min-height:0;flex:1;padding:12px 16px}
    .sdd-section{border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-radius:10px;padding:10px 14px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1,#f2f3f5)}
    .sdd-group-title{font-weight:600;color:var(--dsw-alias-label-secondary,#6c7079);margin:2px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
    .sdd-row{display:flex;gap:10px;padding:2px 0;align-items:baseline}
    .sdd-row-label{flex:none;min-width:140px;color:var(--dsw-alias-label-secondary,#6c7079)}
    .sdd-row-value{min-width:0;overflow-wrap:anywhere}
    .sdd-badge{display:inline-block;padding:1px 8px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2,#c9ccd2);font-size:11px;margin:1px 2px 1px 0;background:var(--dsw-alias-bg-layer-2,#e9eaec)}
    .sdd-badge-ok{background:var(--dsw-alias-state-success-soft,#e5f4e8);border-color:transparent;color:var(--dsw-alias-state-success-primary,#1f7a34)}
    .sdd-badge-warn{background:var(--dsw-alias-state-warning-soft,#fbf3dd);border-color:transparent;color:var(--dsw-alias-state-warning-primary,#8a6116)}
    .sdd-badge-error{background:var(--dsw-alias-state-error-soft,#fbe5e6);border-color:transparent;color:var(--dsw-alias-state-error-primary,#a83a3f)}
    .sdd-list{margin:4px 0 0;padding-left:18px}
    .sdd-issue{margin:3px 0;overflow-wrap:anywhere}
    .sdd-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
    .sdd-tasks{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
    .sdd-btn{appearance:none;background:var(--dsw-alias-button-tool-bar-fill,var(--dsw-alias-bg-layer-1,#f2f3f5));border:1px solid var(--dsw-alias-border-l1,#dcdee2);border-radius:8px;color:var(--dsw-alias-label-primary,#1c1d21);padding:5px 12px;font:inherit;cursor:pointer}
    .sdd-btn:hover{background:var(--dsw-alias-button-tool-bar-hover,var(--dsw-alias-bg-layer-2,#e9eaec))}
    .sdd-btn-primary{background:var(--dsw-alias-button-primary-fill,#4a6bdf);border-color:transparent;color:var(--dsw-alias-brand-text,#fff)}
    .sdd-btn-primary:hover{background:var(--dsw-alias-button-primary-hover,#3d5cc9)}
    .sdd-btn-danger{background:var(--dsw-alias-state-error-primary,#d5484d);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}
    .sdd-btn-ghost{border-color:transparent;background:transparent}
    .sdd-empty{color:var(--dsw-alias-label-secondary,#6c7079)}
    .sdd-notice{display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#dcdee2);flex:none}
    .sdd-notice-success{background:var(--dsw-alias-state-success-soft,#e5f4e8)}
    .sdd-notice-error{background:var(--dsw-alias-state-error-soft,#fbe5e6)}
    .sdd-notice-text{min-width:0;overflow-wrap:anywhere}
    `;

    const CSS_TAG_ID = '@local/sdd-workflow-plugin/panel.css';
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
      const styleTag = document.createElement('style');
      styleTag.dataset.plugin = '@local/sdd-workflow-plugin';
      styleTag.dataset.pluginCss = CSS_TAG_ID;
      styleTag.textContent = STYLES;
      document.head.appendChild(styleTag);
    }

    // -- apply --------------------------------------------------------------------

    const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.commands'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { ru, en }), 'sdd-workflow-plugin: словари');
      const t = ctx.locale.bind(NS);

      // Панель в основной области (key = id элемента боковой навигации).
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ ctx, t }),
      }, SddPanel));

      // Элемент в левой панели навигации.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 31,
        label: () => t('panel'),
        locale: NS,
      }, PanelGlyph));

      return () => {};
    }

    // Экспорт чистых функций для тестов (node --test подменяет window и require).
    return { inject, apply, api, useAsync, PanelGlyph, SddPanel };
  },
});
