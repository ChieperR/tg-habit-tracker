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
