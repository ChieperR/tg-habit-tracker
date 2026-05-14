/**
 * Сервис интерактивной недельной статистики
 * @module services/weeklyService
 */

import { prisma } from '../db/index.js';
import { getTodayDate, isHabitDueOnDate, getWeekStartMonday } from '../utils/date.js';
import { escapeMarkdown } from '../utils/telegram.js';
import { format, addDays, parse } from 'date-fns';
import type { FrequencyType } from '../types/index.js';

/** Состояние дня в недельном календаре */
export type DayState = 'done' | 'missed' | 'frozen' | 'off' | 'future';

/** Строка недели для одной привычки */
export type HabitWeekRow = {
  habitId: number;
  name: string;
  emoji: string;
  scheduleLabel: string;
  states: DayState[];
};

const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Формирует подпись расписания привычки для отображения
 * @param habit - Привычка из БД
 * @returns Строка типа "Ежедневно", "Пн, Ср, Пт", "Раз в 3 дня"
 */
const getScheduleLabel = (habit: {
  frequencyType: string;
  frequencyDays: number;
  weekdays: string | null;
}): string => {
  switch (habit.frequencyType) {
    case 'daily':
      return 'Ежедневно';
    case 'interval':
      return habit.frequencyDays === 1
        ? 'Ежедневно'
        : `Раз в ${habit.frequencyDays} дн.`;
    case 'weekdays':
      if (!habit.weekdays) return '—';
      const days = habit.weekdays.split(',').map(Number).sort((a, b) => a - b);
      return days.map((d) => WEEKDAY_NAMES[d]).join(', ');
    default:
      return '—';
  }
};

/**
 * Возвращает дату первого выполнения привычки (YYYY-MM-DD) или null
 * @param habitId - ID привычки
 * @returns Дата первого выполнения или null
 */
export const getFirstCompletionDate = async (habitId: number): Promise<string | null> => {
  const log = await prisma.habitLog.findFirst({
    where: { habitId, completed: true },
    orderBy: { date: 'asc' },
    select: { date: true },
  });
  return log?.date ?? null;
};

/**
 * Определяет, была ли привычка запланирована на дату (для interval нужна referenceDate)
 * @param habit - Привычка из БД
 * @param dateStr - Дата YYYY-MM-DD
 * @param firstCompletionDate - Дата первого выполнения или null
 * @returns true если в этот день привычка должна была быть выполнена
 */
const wasHabitDueOnDate = (
  habit: { frequencyType: string; frequencyDays: number; weekdays: string | null; createdAt: Date },
  dateStr: string,
  firstCompletionDate: string | null
): boolean => {
  const referenceDate =
    firstCompletionDate ?? format(habit.createdAt, 'yyyy-MM-dd');
  return isHabitDueOnDate({
    frequencyType: habit.frequencyType as FrequencyType,
    frequencyDays: habit.frequencyDays,
    weekdays: habit.weekdays,
    referenceDate,
    dateStr,
  });
};

/**
 * Возвращает состояния 7 дней недели для одной привычки
 * @param habitId - ID привычки
 * @param weekStartMonday - Понедельник недели (YYYY-MM-DD)
 * @param timezoneOffset - Смещение часового пояса
 * @returns Массив из 7 состояний: done | missed | off | future
 */
export const getWeekStatesForHabit = async (
  habitId: number,
  weekStartMonday: string,
  timezoneOffset: number = 180
): Promise<DayState[]> => {
  const today = getTodayDate(timezoneOffset);
  const habit = await prisma.habit.findUnique({
    where: { id: habitId },
  });
  if (!habit) {
    return ['off', 'off', 'off', 'off', 'off', 'off', 'off'];
  }

  const firstCompletion = await getFirstCompletionDate(habitId);
  const monday = parse(weekStartMonday, 'yyyy-MM-dd', new Date());
  const weekEndStr = format(addDays(monday, 6), 'yyyy-MM-dd');

  const [completedLogs, freezeUsages] = await Promise.all([
    prisma.habitLog.findMany({
      where: {
        habitId,
        completed: true,
        date: { gte: weekStartMonday, lte: weekEndStr },
      },
      select: { date: true },
    }),
    prisma.freezeUsage.findMany({
      where: { userId: habit.userId, date: { gte: weekStartMonday, lte: weekEndStr } },
      select: { date: true },
    }),
  ]);

  const completedDates = new Set(completedLogs.map((l) => l.date));
  const frozenDates = new Set(freezeUsages.map((f) => f.date));

  const habitCreatedDate = format(habit.createdAt, 'yyyy-MM-dd');

  const states: DayState[] = [];
  for (let d = 0; d < 7; d++) {
    const date = addDays(monday, d);
    const dateStr = format(date, 'yyyy-MM-dd');
    const isFuture = dateStr > today;
    const completed = completedDates.has(dateStr);
    const frozen = frozenDates.has(dateStr);
    const due = wasHabitDueOnDate(habit, dateStr, firstCompletion);

    if (isFuture) {
      states.push('future');
    } else if (completed) {
      states.push('done');
    } else if (dateStr < habitCreatedDate) {
      // День до создания привычки — не могло быть выполнено
      states.push('off');
    } else if (frozen && due) {
      // День покрыт freeze — отображаем 🧊 (только если был due для этой привычки)
      states.push('frozen');
    } else if (due) {
      states.push('missed');
    } else {
      states.push('off');
    }
  }
  return states;
};

/**
 * Формирует текст и данные для сообщения «Неделя»
 * @param userId - ID пользователя в БД
 * @param weekStartMonday - Понедельник недели (YYYY-MM-DD)
 * @param timezoneOffset - Смещение часового пояса
 * @returns Текст сообщения и массив строк по привычкам
 */
export const getWeeklyData = async (
  userId: number,
  weekStartMonday: string,
  timezoneOffset: number = 180
): Promise<{ text: string; rows: HabitWeekRow[] }> => {
  const habits = await prisma.habit.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  const rows: HabitWeekRow[] = [];
  for (const habit of habits) {
    const states = await getWeekStatesForHabit(habit.id, weekStartMonday, timezoneOffset);
    rows.push({
      habitId: habit.id,
      name: habit.name,
      emoji: habit.emoji,
      scheduleLabel: getScheduleLabel(habit),
      states,
    });
  }

  const monday = parse(weekStartMonday, 'yyyy-MM-dd', new Date());
  const sunday = addDays(monday, 6);
  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const startLabel = `${monday.getDate()} ${monthNames[monday.getMonth()]}`;
  const endLabel = `${sunday.getDate()} ${monthNames[sunday.getMonth()]}`;

  let text = `📅 Неделя: ${startLabel} — ${endLabel}\n\n`;

  if (rows.length === 0) {
    text += 'У тебя пока нет привычек.\n\n';
  } else {
    for (const row of rows) {
      const symbols = row.states.map((s) => {
        switch (s) {
          case 'done':
            return '🟢';
          case 'missed':
            return '🔴';
          case 'frozen':
            return '🧊';
          case 'off':
            return '⏸️';
          case 'future':
            return '⚪';
          default:
            return '⚪';
        }
      });
      text += `${row.emoji} ${escapeMarkdown(row.name)} (${row.scheduleLabel})\n`;
      text += '`' + symbols.join('') + '`\n\n';
    }
  }

  text += '🟢 — Сделал  🔴 — Пропустил  🧊 — Заморожен  ⏸️ — Выходной  ⚪ — ещё не наступило';

  return { text, rows };
};
