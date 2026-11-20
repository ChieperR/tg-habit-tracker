/**
 * Утилиты форматирования для отображения
 * @module utils/format
 */

/** Названия дней недели */
const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Форматирует расписание привычки для отображения.
 * frequencyType принимает string т.к. Prisma возвращает string (SQLite не имеет enum).
 */
export const formatScheduleText = (habit: {
  frequencyType: string;
  frequencyDays: number;
  weekdays: string | null;
  timesPerDay?: number;
}): string => {
  const days = formatScheduleDays(habit);
  const times = habit.timesPerDay ?? 1;
  return times > 1 ? `${days}, ${formatTimesPerDay(times)}` : days;
};

/**
 * «2 раза в день» / «5 раз в день».
 * @param times - Сколько раз в день
 */
export const formatTimesPerDay = (times: number): string =>
  `${times} ${times >= 2 && times <= 4 ? 'раза' : 'раз'} в день`;

/**
 * Прогресс отметок дня «1/2» для привычек с несколькими разами в день,
 * пустая строка для обычных.
 */
export const formatDayProgress = (done: number, target: number): string =>
  target > 1 ? `${Math.min(done, target)}/${target}` : '';

const formatScheduleDays = (habit: {
  frequencyType: string;
  frequencyDays: number;
  weekdays: string | null;
}): string => {
  switch (habit.frequencyType) {
    case 'daily':
      return 'ежедневно';
    case 'interval':
      return `раз в ${habit.frequencyDays} дн.`;
    case 'weekdays': {
      if (!habit.weekdays) return '';
      const days = habit.weekdays.split(',').map(Number);
      const sorted = [...days].sort((a, b) => {
        const aIdx = a === 0 ? 7 : a;
        const bIdx = b === 0 ? 7 : b;
        return aIdx - bIdx;
      });
      return sorted.map(d => WEEKDAY_NAMES[d]).join(', ');
    }
    default:
      return '';
  }
};
