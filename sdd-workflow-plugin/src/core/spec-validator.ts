/**
 * Валидатор спецификации.
 *
 * Находит: противоречия, неоднозначные формулировки, требования без
 * acceptance criteria, критерии без проверяемого результата, незакрытые
 * вопросы, конфликты между requirements/constraints/edge cases, битые
 * ссылки и дубликаты идентификаторов. Каждая находка имеет severity
 * `blocker | major | minor | info`, путь файла и минимальный fix.
 */

import type { IssueSeverity, Spec } from './spec-model.js';
import { TBD } from './spec-model.js';

export interface SpecIssue {
  /** Стабильный код находки. */
  code: string;
  severity: IssueSeverity;
  message: string;
  /** Относительный путь файла. */
  file: string;
  /** Поле структуры, к которому относится находка. */
  field: string;
  /** Минимальное исправление. */
  fix: string;
}

/** Признаки неоднозначных формулировок (границы слов с поддержкой кириллицы). */
const WORD_START = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';
const AMBIGUOUS_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /TBD|to be defined|подлежит уточнению/iu, label: 'маркер «TBD»' },
  { pattern: new RegExp(`${WORD_START}(?:maybe|somehow|etc|and so on|or something|при необходимости|и так далее|и т\\. ?д|какой-нибудь|как-то)${WORD_END}`, 'iu'), label: 'расплывчатая формулировка' },
  { pattern: new RegExp(`${WORD_START}(?:fast|slow|quickly|быстро|медленно|долго)${WORD_END}(?![^.;]*\\b(?:ms|seconds?|секунд|миллисекунд|\\d+)\\b)`, 'iu'), label: 'качество без измеримой величины' },
  { pattern: new RegExp(`${WORD_START}(?:several|some users|многие|некоторые пользователи)${WORD_END}`, 'iu'), label: 'неопределённое множество' },
];

/** Токены-«слабые» обещания в критериях приёмки. */
const WEAK_CRITERION_PATTERNS: RegExp[] = [
  new RegExp(`${WORD_START}(?:should work|works well|user friendly|удобно|корректно|нормально)${WORD_END}`, 'iu'),
  /^(?:должно быть хорошо|всё работает)$/iu,
];

/**
 * Полная проверка спецификации. Порядок стабилен: сначала структурные
 * находки, затем семантические.
 */
export function validateSpec(spec: Spec, file = '.sdd/spec.json'): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const push = (code: string, severity: IssueSeverity, field: string, message: string, fix: string): void => {
    issues.push({ code, severity, message, file, field, fix });
  };

  // -- критические поля --------------------------------------------------------
  for (const field of ['id', 'title', 'goal', 'scope'] as const) {
    const value = spec[field];
    if (typeof value !== 'string' || value.trim() === '' || value.trim() === TBD) {
      push(
        'spec.critical-field-missing',
        'blocker',
        field,
        `Критическое поле «${field}» не заполнено (значение: ${JSON.stringify(value) ?? 'пусто'}).`,
        `Заполните «${field}» через sdd-spec set или явно ответьте на вопрос интервью.`,
      );
    }
  }
  if (spec.owner.trim() === '' || spec.owner.trim() === TBD) {
    push('spec.owner-missing', 'major', 'owner', 'Не указан владелец спецификации.', 'Укажите owner — он подтверждает изменения требований.');
  }

  // -- идентификаторы и дубликаты ----------------------------------------------
  const seen = new Map<string, string>();
  const checkId = (kind: string, id: string, field: string): void => {
    const owner = seen.get(id);
    if (owner) {
      push('spec.duplicate-id', 'blocker', `${field}.id`, `Дубликат идентификатора «${id}» (уже использован в ${owner}).`, 'Идентификаторы должны быть уникальными во всей спецификации.');
    } else {
      seen.set(id, kind);
    }
  };
  spec.user_stories.forEach((story) => checkId('user_stories', story.id, 'user_stories'));
  spec.functional_requirements.forEach((req) => checkId('functional_requirements', req.id, 'functional_requirements'));
  spec.non_functional_requirements.forEach((req) => checkId('non_functional_requirements', req.id, 'non_functional_requirements'));
  spec.acceptance_criteria.forEach((ac) => checkId('acceptance_criteria', ac.id, 'acceptance_criteria'));
  spec.data_contracts.forEach((c) => checkId('data_contracts', c.id, 'data_contracts'));
  spec.api_contracts.forEach((c) => checkId('api_contracts', c.id, 'api_contracts'));
  spec.edge_cases.forEach((ec) => checkId('edge_cases', ec.id, 'edge_cases'));
  spec.constraints.forEach((c) => checkId('constraints', c.id, 'constraints'));
  spec.risks.forEach((r) => checkId('risks', r.id, 'risks'));
  spec.open_questions.forEach((q) => checkId('open_questions', q.id, 'open_questions'));

  // -- требования и acceptance criteria -----------------------------------------
  const requirementIds = new Set<string>([...spec.functional_requirements, ...spec.non_functional_requirements].map((r) => r.id));
  if (spec.functional_requirements.length === 0 && spec.non_functional_requirements.length === 0) {
    push('spec.no-requirements', 'blocker', 'functional_requirements', 'В спецификации нет ни одного требования.', 'Добавьте хотя бы одно функциональное требование.');
  }
  for (const req of [...spec.functional_requirements, ...spec.non_functional_requirements]) {
    const linked = spec.acceptance_criteria.filter((ac) => ac.requirement_id === req.id);
    if (linked.length === 0) {
      push(
        'spec.requirement-without-criteria',
        'major',
        `requirements.${req.id}`,
        `Требование «${req.id}» не имеет ни одного acceptance criterion — его выполнение нельзя проверить объективно.`,
        `Добавьте критерий приёмки с requirement_id: "${req.id}".`,
      );
    }
    for (const text of [req.title, req.description]) {
      for (const { pattern, label } of AMBIGUOUS_PATTERNS) {
        if (pattern.test(text)) {
          push('spec.ambiguous-wording', 'minor', `requirements.${req.id}`, `Неоднозначная формулировка (${label}): «${trim(text)}».`, 'Сформулируйте измеримо и однозначно.');
          break;
        }
      }
    }
  }
  for (const ac of spec.acceptance_criteria) {
    if (!requirementIds.has(ac.requirement_id)) {
      push(
        'spec.criterion-unknown-requirement',
        'major',
        `acceptance_criteria.${ac.id}.requirement_id`,
        `Критерий «${ac.id}» ссылается на несуществующее требование «${ac.requirement_id}».`,
        'Исправьте requirement_id на существующее требование или удалите критерий.',
      );
      continue;
    }
    if (ac.statement.trim() === '') {
      push('spec.criterion-empty', 'major', `acceptance_criteria.${ac.id}.statement`, `Критерий «${ac.id}» пуст.`, 'Опишите проверяемое условие.');
    } else if (ac.verification === 'manual') {
      push('spec.criterion-manual', 'info', `acceptance_criteria.${ac.id}.verification`, `Критерий «${ac.id}» проверяется вручную.`, 'По возможности замените на автоматическую проверку (test/build/lint/typecheck).');
    }
    for (const pattern of WEAK_CRITERION_PATTERNS) {
      if (pattern.test(ac.statement)) {
        push('spec.criterion-not-verifiable', 'major', `acceptance_criteria.${ac.id}.statement`, `Критерий «${ac.id}» не содержит проверяемого результата: «${trim(ac.statement)}».`, 'Опишите наблюдаемый результат («при X происходит Y, что видно по Z»).');
        break;
      }
    }
  }

  // -- контракты и edge cases ----------------------------------------------------
  for (const contract of [...spec.data_contracts, ...spec.api_contracts]) {
    for (const requirementId of contract.requirement_ids) {
      if (!requirementIds.has(requirementId)) {
        push('spec.contract-unknown-requirement', 'major', `contracts.${contract.id}.requirement_ids`, `Контракт «${contract.id}» ссылается на несуществующее требование «${requirementId}».`, 'Исправьте или удалите ссылку.');
      }
    }
    if (contract.description.trim() === '') {
      push('spec.contract-empty', 'minor', `contracts.${contract.id}.description`, `Контракт «${contract.id}» без описания.`, 'Опишите форму данных/запроса-ответа.');
    }
  }
  for (const edgeCase of spec.edge_cases) {
    for (const requirementId of edgeCase.requirement_ids) {
      if (!requirementIds.has(requirementId)) {
        push('spec.edge-case-unknown-requirement', 'major', `edge_cases.${edgeCase.id}.requirement_ids`, `Edge case «${edgeCase.id}» ссылается на несуществующее требование «${requirementId}».`, 'Исправьте или удалите ссылку.');
      }
    }
    if (edgeCase.expected_behavior.trim() === '') {
      push('spec.edge-case-no-expected', 'major', `edge_cases.${edgeCase.id}.expected_behavior`, `Edge case «${edgeCase.id}» без ожидаемого поведения.`, 'Опишите, что именно должно произойти.');
    }
  }

  // -- конфликты requirements ↔ constraints ↔ edge cases -------------------------
  const negation = new RegExp(`${WORD_START}(?:no|not|without|запрещено|нельзя|не использовать|без)${WORD_END}`, 'iu');
  const addition = new RegExp(`${WORD_START}(?:add|introduce|install|include|добавить|подключить|установить|ввести)${WORD_END}`, 'iu');
  const keywordsOf = (text: string): Set<string> =>
    new Set(
      text
        .toLowerCase()
        .split(/[^a-zа-яё0-9]+/u)
        .filter((token) => token.length >= 4),
    );
  for (const constraint of spec.constraints) {
    const constraintKeywords = keywordsOf(constraint.description);
    for (const req of [...spec.functional_requirements, ...spec.non_functional_requirements]) {
      const requirementKeywords = keywordsOf(`${req.title} ${req.description}`);
      const shared = [...constraintKeywords].filter((token) => requirementKeywords.has(token));
      const overlap = shared.length > 0;
      const conflicts =
        overlap &&
        ((negation.test(constraint.description) && addition.test(`${req.title} ${req.description}`)) ||
          (negation.test(`${req.title} ${req.description}`) && addition.test(constraint.description)));
      if (conflicts) {
        push(
          'spec.requirement-constraint-conflict',
          'major',
          `constraints.${constraint.id}`,
          `Возможный конфликт: ограничение «${constraint.id}» («${trim(constraint.description)}») против требования «${req.id}» («${trim(req.title)}»). Общая лексика: ${shared.slice(0, 4).join(', ')}.`,
          'Уточните формулировки так, чтобы ограничение и требование не противоречили друг другу, либо исключите требование.',
        );
      }
    }
  }
  for (const edgeCase of spec.edge_cases) {
    for (const requirementId of edgeCase.requirement_ids) {
      const req = [...spec.functional_requirements, ...spec.non_functional_requirements].find((item) => item.id === requirementId);
      if (req && keywordsOf(edgeCase.expected_behavior).has('error') && keywordsOf(`${req.title} ${req.description}`).has('always')) {
        push('spec.edge-case-requirement-conflict', 'minor', `edge_cases.${edgeCase.id}`, `Edge case «${edgeCase.id}» описывает ошибку, тогда как требование «${req.id}» обещает безусловное («always») поведение.`, 'Уточните требование с учётом edge case.');
      }
    }
  }

  // -- незакрытые вопросы ----------------------------------------------------------
  for (const question of spec.open_questions) {
    if (question.status === 'answered' && !question.answer?.trim()) {
      push('spec.question-answered-without-answer', 'minor', `open_questions.${question.id}`, `Вопрос «${question.id}» помечен отвеченным, но ответ пуст.`, 'Заполните answer или верните статус open.');
      continue;
    }
    if (question.status !== 'answered') {
      push(
        'spec.open-question',
        question.blocking ? 'blocker' : 'major',
        `open_questions.${question.id}`,
        `Незакрытый вопрос «${question.id}»: ${trim(question.question)}`,
        'Ответьте на вопрос (sdd-spec set open_questions) или явно пометьте статус tbd с обоснованием.',
      );
    }
  }

  // -- scope vs out_of_scope ---------------------------------------------------------
  for (const excluded of spec.out_of_scope) {
    const excludedKeywords = keywordsOf(excluded);
    if (excludedKeywords.size > 0 && spec.scope.trim() && [...excludedKeywords].some((token) => keywordsOf(spec.scope).has(token))) {
      push('spec.scope-overlap', 'minor', 'out_of_scope', `Пункт out_of_scope «${trim(excluded)}» лексически пересекается со scope.`, 'Переформулируйте границы объёма, чтобы они не пересекались.');
    }
  }

  // -- definition of done ---------------------------------------------------------------
  if (spec.definition_of_done.length === 0) {
    push('spec.no-definition-of-done', 'major', 'definition_of_done', 'Definition of done не задан.', 'Добавьте чек-лист завершения фичи.');
  }

  return sortIssues(issues);
}

/** Итоговая сводка валидации. */
export function summarizeIssues(issues: SpecIssue[]): { blockers: number; majors: number; minors: number; infos: number; ok: boolean } {
  const blockers = issues.filter((issue) => issue.severity === 'blocker').length;
  const majors = issues.filter((issue) => issue.severity === 'major').length;
  const minors = issues.filter((issue) => issue.severity === 'minor').length;
  const infos = issues.filter((issue) => issue.severity === 'info').length;
  return { blockers, majors, minors, infos, ok: blockers === 0 };
}

/** Есть ли blocker-находки — план по ним не создаётся. */
export function hasBlockers(issues: SpecIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'blocker');
}

function trim(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { blocker: 0, major: 1, minor: 2, info: 3 };

/** Стабильная сортировка: severity, затем код, затем поле. */
export function sortIssues(issues: SpecIssue[]): SpecIssue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code) || a.field.localeCompare(b.field));
}
