/**
 * Копирование JSON-схем из src/schemas в dist/schemas после tsc:
 * tsc переносит только импортируемые модули, а схемы предназначены
 * для внешних потребителей (export "./schema/*.json").
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'src', 'schemas');
const target = path.join(root, 'dist', 'schemas');

fs.mkdirSync(target, { recursive: true });
for (const file of fs.readdirSync(source)) {
  if (file.endsWith('.json')) fs.copyFileSync(path.join(source, file), path.join(target, file));
}
const copied = fs.readdirSync(target);
console.log(`copied ${copied.length} schemas: ${copied.join(', ')}`);
