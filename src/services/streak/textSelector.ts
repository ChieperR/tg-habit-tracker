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
 * Cooldown 14 дней — отдельная логика поверх selector'а: проверяет MessageSent
 * и фильтрует недавно использованные templateId. Если все отфильтровались —
 * fallback на любой вариант (нет idle pool).
 *
 * @module services/streak/textSelector
 */

import { prisma } from '../../db/index.js';
import { subDays, format, parse } from 'date-fns';

/** Cooldown в днях: один и тот же templateId не повторяется чаще. */
export const TEMPLATE_COOLDOWN_DAYS = 14;

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
 * Получает список templateId которые юзер видел за последние N дней (cooldown).
 */
export const getRecentTemplateIds = async (
  userId: number,
  cutoffDate: string
): Promise<Set<string>> => {
  const sent = await prisma.messageSent.findMany({
    where: { userId, date: { gte: cutoffDate } },
    select: { templateId: true },
  });
  return new Set(sent.map((s) => s.templateId));
};

/**
 * Выбирает вариант из пула с учётом cooldown (избегает недавно показанных
 * templateId). Если все варианты в cooldown'е — fallback на pickDeterministic
 * без фильтрации.
 *
 * Не записывает MessageSent — это делает caller после успешной отправки.
 */
export const pickWithCooldown = async <T extends { id: string }>(
  pool: readonly T[],
  seed: string,
  userId: number,
  todayDate: string
): Promise<T> => {
  if (pool.length === 0) {
    throw new Error('pickWithCooldown: pool is empty');
  }

  const cutoffDate = format(
    subDays(parse(todayDate, 'yyyy-MM-dd', new Date()), TEMPLATE_COOLDOWN_DAYS),
    'yyyy-MM-dd'
  );
  const recent = await getRecentTemplateIds(userId, cutoffDate);
  const available = pool.filter((v) => !recent.has(v.id));

  if (available.length === 0) {
    // Все в cooldown'е — fallback на полный пул (не блокируем доставку).
    return pickDeterministic(pool, seed);
  }
  return pickDeterministic(available, seed);
};

/**
 * Записывает что юзеру был отправлен данный templateId сегодня (для cooldown).
 */
export const recordTemplateSent = async (
  userId: number,
  templateId: string,
  trigger: string,
  date: string
): Promise<void> => {
  await prisma.messageSent.create({
    data: { userId, templateId, trigger, date },
  });
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
