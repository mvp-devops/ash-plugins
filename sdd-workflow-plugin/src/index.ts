/**
 * sdd-workflow-plugin — точка входа host-половины плагина DSH.
 *
 * Экспортирует контракт плагина: `name`, `apply(ctx)`, `inject` (обязательные
 * службы), версию и список команд. Клиентская половина (панель SDD) — файл
 * `client.js`, подключаемый через exports "./client".
 */

export { PLUGIN_NAME as name, PLUGIN_VERSION, apply, inject, COMMAND_NAMES, TOOL_NAMES, parseCommandInput, dispatchCommand } from './plugin.js';
