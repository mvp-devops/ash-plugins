/**
 * Ошибки плагина sdd-workflow-plugin.
 *
 * Все ошибки несут стабильный `code`, путь файла и (для ошибок валидации)
 * имя поля и подсказку по исправлению — чтобы сообщение всегда отвечало
 * на вопросы «где» и «как чинить».
 */

/** Стабильные коды ошибок плагина. */
export type SddErrorCode =
  | 'SDD_NOT_INITIALIZED'
  | 'SDD_ALREADY_INITIALIZED'
  | 'SDD_INVALID_JSON'
  | 'SDD_INVALID_ARTIFACT'
  | 'SDD_MISSING_FIELD'
  | 'SDD_DUPLICATE_ID'
  | 'SDD_UNKNOWN_REFERENCE'
  | 'SDD_BLOCKERS_PRESENT'
  | 'SDD_EVIDENCE_REQUIRED'
  | 'SDD_FS_ERROR'
  | 'SDD_RUNNER_UNAVAILABLE'
  | 'SDD_COMMAND_ERROR'
  | 'SDD_OVERWRITE_DECLINED';

/** Базовая ошибка плагина. */
export class SddError extends Error {
  readonly code: SddErrorCode;
  /** Относительный путь файла, к которому относится ошибка (если известен). */
  readonly file?: string;
  /** Имя поля в структуре JSON, к которому относится ошибка (если известно). */
  readonly field?: string;
  /** Подсказка, как исправить ошибку. */
  readonly hint?: string;

  constructor(
    code: SddErrorCode,
    message: string,
    options: { file?: string; field?: string; hint?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'SddError';
    this.code = code;
    if (options.file !== undefined) this.file = options.file;
    if (options.field !== undefined) this.field = options.field;
    if (options.hint !== undefined) this.hint = options.hint;
  }

  /** Человекочитаемое сообщение с файлом, полем и подсказкой. */
  formatted(): string {
    const parts: string[] = [this.message];
    if (this.file) parts.push(`файл: ${this.file}`);
    if (this.field) parts.push(`поле: ${this.field}`);
    if (this.hint) parts.push(`как исправить: ${this.hint}`);
    return parts.join('; ');
  }
}

/** Ошибка валидации структуры артефакта (spec.json, plan, tasks, report). */
export class ArtifactValidationError extends SddError {
  constructor(message: string, options: { file: string; field?: string; hint?: string; cause?: unknown }) {
    super('SDD_INVALID_ARTIFACT', message, options);
    this.name = 'ArtifactValidationError';
  }
}

/** Ошибка чтения/записи файловой службы. */
export class FsOperationError extends SddError {
  constructor(message: string, options: { file: string; hint?: string; cause?: unknown }) {
    super('SDD_FS_ERROR', message, options);
    this.name = 'FsOperationError';
  }
}

/** Обёртка над неожиданными ошибками команд. */
export function toSddError(error: unknown, file?: string): SddError {
  if (error instanceof SddError) {
    if (file && !error.file) {
      return new SddError(error.code, error.message, { file, field: error.field, hint: error.hint, cause: error });
    }
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SddError('SDD_COMMAND_ERROR', message, { file, hint: 'проверьте аргументы команды и состояние .sdd/' });
}
