/**
 * Pure-логика персональных напоминаний с несколькими временами в день.
 * @module services/reminder/habitReminderSlots
 */

import { formatYMDUtc, getNowInTimezone, parseTime } from '../../utils/date.js';

/** Сколько персональных напоминаний может быть у одной привычки. */
export const MAX_HABIT_REMINDERS = 5;

/** Минимальная форма HabitReminder для расчётов. */
export type ReminderSlot = {
  id: number;
  time: string;
  lastSentDate: string | null;
};

/** Минут с полуночи для времени HH:MM. */
const toMinutes = (time: string): number => {
  const { hours, minutes } = parseTime(time);
  return hours * 60 + minutes;
};

/**
 * Времена, которые уже наступили сегодня и по которым сегодня ещё не слали.
 * Если бот лежал и наступило сразу несколько, юзер получает одно сообщение,
 * а все такие времена помечаются отправленными.
 *
 * @param slots - Напоминания привычки
 * @param nowMinutes - Минут с полуночи в поясе юзера
 * @param todayDate - Сегодня (YYYY-MM-DD) в поясе юзера
 * @returns Напоминания, которые пора отправить (пустой массив — некому)
 */
export const pickPendingSlots = <T extends ReminderSlot>(
  slots: T[],
  nowMinutes: number,
  todayDate: string
): T[] => slots.filter((s) => s.lastSentDate !== todayDate && toMinutes(s.time) <= nowMinutes);

/**
 * Какой lastSentDate ставить новому (или изменённому) времени: если оно
 * сегодня уже прошло — сегодняшний день, чтобы напоминание не пришло сразу
 * после настройки; если впереди — null, тогда оно сработает сегодня.
 */
export const initialLastSentDate = (
  time: string,
  nowMinutes: number,
  todayDate: string
): string | null => (toMinutes(time) <= nowMinutes ? todayDate : null);

/**
 * Сегодняшний день и минуты с полуночи в поясе юзера из одного чтения часов —
 * чтобы около полуночи дата и минуты не оказались из разных суток.
 */
export const nowInTimezone = (timezoneOffset: number): { today: string; minutes: number } => {
  const now = getNowInTimezone(timezoneOffset);
  return { today: formatYMDUtc(now), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
};

/** Сортирует времена HH:MM по возрастанию. */
export const sortTimes = (times: string[]): string[] => [...times].sort((a, b) => a.localeCompare(b));
