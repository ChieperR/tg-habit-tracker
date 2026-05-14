/**
 * Детерминированный выбор текстов из пулов вариантов.
 *
 * Используется hash от seed'а (userId + date + trigger + scope) для выбора
 * одного варианта из массива. Это гарантирует:
 * - Идемпотентность: повторный вызов с теми же параметрами вернёт тот же текст
 *   (важно для cron-retry'ев)
 * - Разнообразие: разные юзеры на одну дату/триггер увидят разные варианты
 * - Стабильность во времени: один юзер на одну дату всегда видит один и тот же
 *   текст
 *
 * @module services/streak/textSelector
 */

/**
 * Простой 32-bit hash для строки (xmur3 — fast, stable, deterministic).
 */
const hashString = (str: string): number => {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return Math.abs(h);
};

/**
 * Выбирает один элемент из массива по seed детерминированно.
 *
 * @param pool Массив вариантов
 * @param seed Строка, например `${userId}:${date}:${trigger}`
 */
export const pickDeterministic = <T>(pool: readonly T[], seed: string): T => {
  if (pool.length === 0) {
    throw new Error('pickDeterministic: pool is empty');
  }
  const index = hashString(seed) % pool.length;
  return pool[index]!;
};

/**
 * Простая текстовая подстановка плейсхолдеров вида `{name}`.
 */
export const renderTemplate = (template: string, vars: Record<string, string | number>): string => {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, String(value));
  }
  return result;
};
