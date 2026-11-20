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
  /** Привычка удалена или внедрена (показывается только в неделях, где есть её история) */
  deleted: boolean;
  /** Привычка внедрена (подпись «внедрена» вместо «удалена») */
  graduated: boolean;
  states: DayState[];
};

/** Поля привычки, нужные для состояний дней недели */
type WeekHabit = {
  frequencyType: string;
  frequencyDays: number;
  weekdays: string | null;
  createdAt: Date;
  deletedDate: string | null;
};

const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Формирует подпись расписания привычки для отображения
 * @param habit - Привычка из БД
 * @returns Строка типа "Ежедневно", "Пн, Ср, Пт", "Раз в 3 дня"
 */
export const getScheduleLabel = (habit: {
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
 * Определяет, была ли привычка запланирована на дату (для interval нужна referenceDate)
 * @param habit - Привычка из БД
 * @param dateStr - Дата YYYY-MM-DD
 * @param firstCompletionDate - Дата первого выполнения или null
 * @returns true если в этот день привычка должна была быть выполнена
 */
export const wasHabitDueOnDate = (
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
 * Pure: состояния 7 дней недели одной привычки по уже загруженным отметкам и
 * заморозкам. У удалённой привычки дни начиная с дня удаления — `off`
 * (как дни до создания), отметки при этом остаются `done`.
 * @param habit - Привычка
 * @param weekStartMonday - Понедельник недели (YYYY-MM-DD)
 * @param today - Сегодня у юзера (YYYY-MM-DD)
 * @param completedDates - Даты выполнений привычки
 * @param frozenDates - Даты заморозок юзера
 * @param firstCompletion - Дата первого выполнения или null
 * @returns Массив из 7 состояний
 */
export const computeWeekStates = (
  habit: WeekHabit,
  weekStartMonday: string,
  today: string,
  completedDates: Set<string>,
  frozenDates: Set<string>,
  firstCompletion: string | null
): DayState[] => {
  const monday = parse(weekStartMonday, 'yyyy-MM-dd', new Date());
  const habitCreatedDate = format(habit.createdAt, 'yyyy-MM-dd');

  const states: DayState[] = [];
  for (let d = 0; d < 7; d++) {
    const dateStr = format(addDays(monday, d), 'yyyy-MM-dd');
    const frozen = frozenDates.has(dateStr);
    const due = wasHabitDueOnDate(habit, dateStr, firstCompletion);

    const completed = completedDates.has(dateStr);

    if (habit.deletedDate !== null && dateStr >= habit.deletedDate && !completed) {
      states.push('off');
    } else if (dateStr > today) {
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
  // Удалённые — только если удалены не раньше этой недели; строка остаётся,
  // если в неделе есть её история (отметка, пропуск или заморозка).
  const habits = await prisma.habit.findMany({
    where: {
      userId,
      OR: [{ isActive: true }, { isActive: false, deletedDate: { gte: weekStartMonday } }],
    },
    orderBy: { createdAt: 'asc' },
  });

  const today = getTodayDate(timezoneOffset);
  const weekEnd = format(addDays(parse(weekStartMonday, 'yyyy-MM-dd', new Date()), 6), 'yyyy-MM-dd');
  const habitIds = habits.map((h) => h.id);
  const [weekLogs, firstCompletions, freezeUsages] = await Promise.all([
    prisma.habitLog.findMany({
      // Любая отметка дня — 🟢, в том числе часть отметок у привычки на несколько раз в день.
      where: { habitId: { in: habitIds }, count: { gt: 0 }, date: { gte: weekStartMonday, lte: weekEnd } },
      select: { habitId: true, date: true },
    }),
    prisma.habitLog.groupBy({
      by: ['habitId'],
      where: { habitId: { in: habitIds }, completed: true },
      _min: { date: true },
    }),
    prisma.freezeUsage.findMany({
      where: { userId, date: { gte: weekStartMonday, lte: weekEnd } },
      select: { date: true },
    }),
  ]);
  const frozenDates = new Set(freezeUsages.map((f) => f.date));
  const firstCompletionById = new Map(firstCompletions.map((f) => [f.habitId, f._min.date]));

  const rows: HabitWeekRow[] = [];
  const deletedRows: HabitWeekRow[] = [];
  for (const habit of habits) {
    const completedDates = new Set(weekLogs.filter((l) => l.habitId === habit.id).map((l) => l.date));
    const states = computeWeekStates(
      habit,
      weekStartMonday,
      today,
      completedDates,
      frozenDates,
      firstCompletionById.get(habit.id) ?? null
    );
    const row: HabitWeekRow = {
      habitId: habit.id,
      name: habit.name,
      emoji: habit.emoji,
      scheduleLabel: getScheduleLabel(habit),
      deleted: !habit.isActive,
      graduated: habit.graduated,
      states,
    };
    if (habit.isActive) {
      rows.push(row);
    } else if (states.some((s) => s === 'done' || s === 'missed' || s === 'frozen')) {
      deletedRows.push(row);
    }
  }
  rows.push(...deletedRows);

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
      const label = row.graduated ? 'внедрена' : row.deleted ? 'удалена' : row.scheduleLabel;
      text += `${row.emoji} ${escapeMarkdown(row.name)} (${label})\n`;
      text += '`' + symbols.join('') + '`\n\n';
    }
  }

  text += '🟢 — Сделал  🔴 — Пропустил  🧊 — Заморожен  ⏸️ — Выходной  ⚪ — ещё не наступило';

  return { text, rows };
};
