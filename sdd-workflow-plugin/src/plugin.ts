/**
 * sdd-workflow-plugin — host-половина.
 *
 * Регистрирует через официальный механизм cordis (`ctx.effect`):
 *  - 8 сессионных команд `sdd-init … sdd-export` и зонтичную команду `sdd`
 *    (DSH допускает в именах команд только буквы, цифры, `_` и `-`, поэтому
 *    вместо невозможного `/sdd:init` используются `/sdd-init` и `/sdd init`);
 *  - 8 agent-инструментов `sdd_*` с JSON Schema параметров и output-рендером.
 *
 * Команды и инструменты работают с общими артефактами `.sdd/` рабочего
 * пространства сессии. Все записи атомарны, пути относительные.
 */

import { buildContext, type CommandContext, type HarnessServices } from './commands/context.js';
import { runInit } from './commands/init.js';
import { runSpecCommand } from './commands/spec.js';
import { runPlanCommand } from './commands/plan.js';
import { runTasksCommand } from './commands/tasks.js';
import { runImplementCommand } from './commands/implement.js';
import { runValidateCommand } from './commands/validate.js';
import { runStatusCommand } from './commands/status.js';
import { runExportCommand } from './commands/export.js';
import { toSddError } from './core/errors.js';
import type { SubprocessLike } from './core/runner.js';

export const PLUGIN_NAME = 'sdd-workflow-plugin';
export const PLUGIN_VERSION = '1.0.0';

/** Обязательные службы: команды, инструменты, файлы, рабочий каталог, subprocess. */
export const inject = ['tools', 'commands', 'fs', 'workingDirectory', 'subprocess'] as const;

/** Структура контекста cordis, используемая плагином (граница с DSH). */
interface HarnessContext extends Omit<HarnessServices, 'subprocess'> {
  effect?(registration: () => unknown, label?: string): unknown;
  commands?: { register(definition: unknown): unknown };
  tools?: { register(definition: unknown): unknown };
  logger?: { debug?(message: string): void; info?(message: string): void; warn?(message: string): void; error?(message: string): void };
  workingDirectory?: { get(session: unknown): string | undefined };
  /** Объявлена в inject — cordis предоставляет её при активации. */
  subprocess?: SubprocessLike;
}

/** Названия команд плагина. */
export const COMMAND_NAMES = ['sdd-init', 'sdd-spec', 'sdd-plan', 'sdd-tasks', 'sdd-implement', 'sdd-validate', 'sdd-status', 'sdd-export', 'sdd'] as const;

/** Названия agent-инструментов плагина. */
export const TOOL_NAMES = ['sdd_init', 'sdd_spec', 'sdd_plan', 'sdd_tasks', 'sdd_implement', 'sdd_validate', 'sdd_status', 'sdd_export'] as const;

/** Разбор входа сессионной команды: `<op> [json]` или JSON с полем op. */
export function parseCommandInput(rawInput: string | undefined): Record<string, unknown> {
  const input = (rawInput ?? '').trim();
  if (input === '') return {};
  if (input.startsWith('{') || input.startsWith('[')) {
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Аргументы команды должны быть JSON-объектом.');
    }
    return parsed as Record<string, unknown>;
  }
  const space = input.indexOf(' ');
  const head = (space === -1 ? input : input.slice(0, space)).toLowerCase();
  const rest = space === -1 ? '' : input.slice(space + 1).trim();
  const args: Record<string, unknown> = {};
  if (rest !== '') {
    try {
      const parsed = JSON.parse(rest) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(args, parsed);
      } else {
        args.value = parsed;
      }
    } catch {
      args.value = rest;
    }
  }
  if (head !== '') args.op = head;
  return args;
}

/** Диспетчеризация операции SDD по имени команды. */
export async function dispatchCommand(command: string, args: Record<string, unknown>, ctx: CommandContext): Promise<Record<string, unknown>> {
  switch (command) {
    case 'sdd-init':
      return runInit(ctx, args as { answers?: Record<string, unknown>; confirm_overwrite?: boolean });
    case 'sdd-spec':
      return runSpecCommand(ctx, args as { op?: string; patch?: Record<string, unknown>; answers?: Record<string, unknown>; question_id?: string; answer?: string });
    case 'sdd-plan':
      return runPlanCommand(ctx, args as { op?: string; plan?: Record<string, unknown>; confirm_overwrite?: boolean; allow_draft?: boolean });
    case 'sdd-tasks':
      return runTasksCommand(ctx, args);
    case 'sdd-implement':
      return runImplementCommand(ctx, args);
    case 'sdd-validate':
      return runValidateCommand(ctx, args);
    case 'sdd-status':
      return runStatusCommand(ctx, args);
    case 'sdd-export':
      return runExportCommand(ctx, args);
    default:
      throw new Error(`Неизвестная команда «${command}». Доступны: ${COMMAND_NAMES.join(', ')}`);
  }
}

/**
 * Хост-плагин. Возвращает функцию очистки.
 * @param ctx контекст cordis (services: commands, tools, fs, workingDirectory)
 */
export function apply(ctx: HarnessContext): () => void {
  const services: HarnessServices = {
    fs: ctx.fs,
    workingDirectory: ctx.workingDirectory,
    subprocess: ctx.subprocess,
    logger: ctx.logger,
  };

  const handlers: Record<string, (args: Record<string, unknown>, session: unknown) => Promise<Record<string, unknown>>> = {};
  for (const command of COMMAND_NAMES) {
    handlers[command] = async (args, session) => {
      if (command === 'sdd') {
        const sub = String(args.command ?? '');
        if (!COMMAND_NAMES.includes(`sdd-${sub}` as (typeof COMMAND_NAMES)[number])) {
          return {
            ok: false,
            error: `Укажите подкоманду: /sdd <command> [json]. Доступны: ${COMMAND_NAMES.filter((name) => name !== 'sdd').map((name) => name.slice(4)).join(', ')}`,
          };
        }
        const { command: _removed, ...rest } = args;
        void _removed;
        const context = buildContext(services, session);
        return dispatchCommand(`sdd-${sub}`, rest, context);
      }
      const context = buildContext(services, session);
      return dispatchCommand(command, args, context);
    };
  }

  // -- сессионные команды ------------------------------------------------------

  const descriptions: Record<string, string> = {    'sdd-init': 'SDD: создать рабочее пространство .sdd/ и вопросник интервью фичи',
    'sdd-spec': 'SDD: создать/обновить/проверить машиночитаемую спецификацию (.sdd/spec.json)',
    'sdd-plan': 'SDD: сгенерировать технический план из утверждённой спецификации',
    'sdd-tasks': 'SDD: преобразовать план в трассируемые задачи, обновлять статусы с evidence',
    'sdd-implement': 'SDD: очередь задач для реализации и запись объективного evidence',
    'sdd-validate': 'SDD: полная проверка соответствия реализации спецификации',
    'sdd-status': 'SDD: состояние цикла, трассируемость, блокеры и следующее действие',
    'sdd-export': 'SDD: экспорт пакета (spec, план, задачи, трассируемость, отчёт, changelog)',
    sdd: 'SDD: зонтичная команда — /sdd <init|spec|plan|tasks|implement|validate|status|export> [json]',
  };

  if (ctx.commands) {
    for (const command of COMMAND_NAMES) {
      const name = command;
      const register = (): unknown =>
        ctx.commands?.register({
          name,
          description: descriptions[name] ?? 'SDD команда',
          input: { hint: '[json] — например: /sdd-init {"answers":{"goal":"…"}}; попробуйте /sdd-status' },
          recordInput: false,
          async handler({ agent, rawInput }: { agent: { session?: unknown }; rawInput?: string; signal?: AbortSignal }) {
            try {
              const args = parseCommandInput(rawInput);
              const handler = handlers[name];
              if (!handler) throw new Error(`команда ${name} не зарегистрирована`);
              const result = await handler(args, agent?.session);
              return result.ok === false
                ? { kind: 'error' as const, text: JSON.stringify(result) }
                : { kind: 'success' as const, text: JSON.stringify(result) };
            } catch (error) {
              const sddError = toSddError(error);
              ctx.logger?.error?.(`sdd-workflow-plugin: ${name}: ${sddError.formatted()}`);
              return { kind: 'error' as const, text: JSON.stringify({ ok: false, code: sddError.code, error: sddError.formatted() }) };
            }
          },
        });
      if (ctx.effect) ctx.effect(register, `sdd-workflow-plugin: команда ${name}`);
      else register();
    }
  }

  // -- agent-инструменты ---------------------------------------------------------

  const toolArgsSchema = {
    type: 'object',
    properties: {
      op: { type: 'string', description: 'Операция команды (например generate | update | queue | record | get).' },
      patch: { type: 'object', description: 'Патч полей спецификации.', additionalProperties: true },
      answers: { type: 'object', description: 'Ответы интервью: { поле: значение }.', additionalProperties: true },
      plan: { type: 'object', description: 'Вход генерации плана: codebase_analysis, modules, architecture_decisions и др.', additionalProperties: true },
      task_id: { type: 'string', description: 'Идентификатор задачи (T-001).' },
      status: { type: 'string', description: 'Новый статус задачи: todo | in_progress | blocked | review | done.' },
      evidence: {
        type: 'object',
        description: 'Объективное доказательство: { kind: test|build|lint|typecheck|integration|manual, reference, passed, detail? }.',
        additionalProperties: true,
      },
      confirm_overwrite: { type: 'boolean', description: 'Явное подтверждение перезаписи существующих артефактов.' },
      allow_draft: { type: 'boolean', description: 'Разрешить генерацию плана по неутверждённой спецификации.' },
    },
    additionalProperties: true,
  } as const;

  const toolDefinitions: { name: string; command: string; description: string; render: (value: Record<string, unknown>) => string }[] = [
    { name: 'sdd_init', command: 'sdd-init', description: 'Создать SDD workspace (.sdd/) и получить вопросник интервью фичи.', render: (value) => `SDD workspace ${value.created ? 'создан' : 'уже существует'}; вопросов в интервью: ${Array.isArray(value.questionnaire) ? value.questionnaire.length : 0}` },
    { name: 'sdd_spec', command: 'sdd-spec', description: 'Создать/обновить спецификацию (patch/answers) или выполнить валидацию с отчётом по severity.', render: (value) => `Спецификация обновлена/проверена: blockers=${(value.summary as { blockers?: number } | undefined)?.blockers ?? 0}` },
    { name: 'sdd_plan', command: 'sdd-plan', description: 'Сгенерировать технический план из утверждённой спецификации (требует codebase_analysis).', render: (value) => `План: ${value.items ?? '?'} пунктов, трассируемых к требованиям` },
    { name: 'sdd_tasks', command: 'sdd-tasks', description: 'Преобразовать план в атомарные задачи; обновить статус задачи с evidence.', render: (value) => `Задачи: ${JSON.stringify(value.summary ?? {})}` },
    { name: 'sdd_implement', command: 'sdd-implement', description: 'Получить очередь готовых задач с правилами реализации или записать evidence выполнения.', render: (value) => `Реализация: очередь из ${(value.queue as unknown[] | undefined)?.length ?? 0} задач` },
    { name: 'sdd_validate', command: 'sdd-validate', description: 'Полная проверка соответствия реализации спецификации с отчётом validation-report.json.', render: (value) => `Валидация: overall=${String(value.overall)}, feature_complete=${String(value.feature_complete)}` },
    { name: 'sdd_status', command: 'sdd-status', description: 'Состояние SDD-цикла: трассируемость, непокрытые критерии, блокеры, следующее действие.', render: (value) => `Стадия: ${String(value.stage)}; следующее действие: ${String(value.action ?? value.recommended_next_action ?? '')}` },
    { name: 'sdd_export', command: 'sdd-export', description: 'Экспортировать SDD-пакет (Markdown + JSON) в .sdd/export/.', render: (value) => `Экспорт: ${Array.isArray(value.files) ? value.files.length : 0} файлов в ${String(value.export_dir ?? '')}` },
  ];

  if (ctx.tools) {
    for (const tool of toolDefinitions) {
      const register = (): unknown =>
        ctx.tools?.register({
          name: tool.name,
          description: tool.description,
          parameters: toolArgsSchema,
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (args: Record<string, unknown>, value: Record<string, unknown>) => [{ type: 'text' as const, text: tool.render(value ?? {}) }],
          },
          isConcurrencySafe: () => false,
          async execute(args: Record<string, unknown>, exec: { agent?: { session?: unknown }; signal?: AbortSignal }) {
            const handler = handlers[tool.command];
            if (!handler) throw new Error(`команда ${tool.command} не зарегистрирована`);
            const result = await handler(args, exec?.agent?.session);
            if (result.ok === false) throw new Error(String(result.error ?? 'операция SDD завершилась ошибкой'));
            return result;
          },
        });
      if (ctx.effect) ctx.effect(register, `sdd-workflow-plugin: инструмент ${tool.name}`);
      else register();
    }
  }

  return () => {
    // Регистрации возвращены cordis как эффекты; очистка происходит через
    // disposables самого реестра. Здесь освобождать нечего — хранилище
    // не держит открытых ресурсов.
  };
}
