/**
 * doc-templates-panel — точка входа host-половины плагина.
 *
 * Экспортирует `name`, `apply(ctx, config)`, список сервисов `inject`
 * и схему конфигурации `Config` (Standard Schema, как ожидает cordis).
 * Клиентская половина панели — файл `client.js` (см. exports "./client").
 */

export { PLUGIN_NAME as name, apply, inject, Config, PLUGIN_VERSION, COMMAND_OPS } from './src/plugin.js';
