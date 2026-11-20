import { prisma } from '../db/index.js';
import { GraduatedHabitStats, HabitStats, UserStats } from '../types/index.js';
import { getLastNDays, getTodayDate } from '../utils/date.js';
import { escapeMarkdown } from '../utils/telegram.js';
import { format, subWeeks, startOfWeek, addDays, parse, differenceInCalendarDays } from 'date-fns';
import {
  calculateOverallStreak,
  calculatePerHabitMaxStreak,
  calculatePerHabitStreak,
  getEffectiveStartDate,
  type StreakHabit,
  type StreakHabitLog,
  type StreakFreezeUsage,
} from './streak/calculator.js';
import { FREEZE_CAP } from './streak/freezeService.js';

/**
 * Сервис для работы со статистикой
 * @module services/statsService
 */

const MONTH_NAMES_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const ACTIVITY_GRID_WEEKS = 12;

/**
 * Pure: считает completionRate по уже загруженным логам.
 * Берёт `lastNDays` (массив YYYY-MM-DD) и пересекает с completion-датами.
 */
export const computeCompletionRate = (
  habitLogs: { date: string; completed: boolean }[],
  frequencyDays: number,
  lastNDays: string[]
): number => {
  const expectedCompletions = Math.ceil(lastNDays.length / frequencyDays);
  if (expectedCompletions === 0) return 100;
  const window = new Set(lastNDays);
  const completedCount = habitLogs.filter((l) => l.completed && window.has(l.date)).length;
  return Math.round((completedCount / expectedCompletions) * 100);
};

/** Сколько внедрённых привычек показывать в /stats. */
const MAX_GRADUATED_SHOWN = 10;

/** Поля привычки, нужные для итога внедрённой. */
type GraduatedSource = {
  id: number;
  name: string;
  emoji: string;
  frequencyType: string;
  frequencyDays: number;
  weekdays: string | null;
  createdAt: Date;
  deletedDate: string | null;
};

/**
 * Pure: итог внедрённой привычки — выполнения, лучшая серия и сколько дней
 * она была в списке (с начала по день завершения включительно).
 */
export const computeGraduatedStats = (
  habit: GraduatedSource,
  allLogs: StreakHabitLog[],
  allFreezes: StreakFreezeUsage[]
): GraduatedHabitStats => {
  const graduatedDate = habit.deletedDate ?? format(habit.createdAt, 'yyyy-MM-dd');
  // Серии считаются по истории до дня завершения так же, как у живой привычки.
  const asActive: StreakHabit = { ...habit, isActive: true, deletedDate: null };
  const start = getEffectiveStartDate(asActive, allLogs);
  return {
    name: habit.name,
    emoji: habit.emoji,
    graduatedDate,
    totalCompleted: allLogs.filter((l) => l.habitId === habit.id && l.completed).length,
    // Заморозки — только до дня завершения: в этот день привычка уже ничего не требовала.
    maxStreak: calculatePerHabitMaxStreak(
      asActive,
      allLogs,
      allFreezes.filter((f) => f.date < graduatedDate),
      graduatedDate
    ),
    days:
      differenceInCalendarDays(parse(graduatedDate, 'yyyy-MM-dd', new Date()), parse(start, 'yyyy-MM-dd', new Date())) + 1,
  };
};

/**
 * Итог только что внедрённой привычки для поздравления.
 * @param habitId - ID привычки
 * @param userId - ID владельца (заморозки общие на юзера)
 */
export const getGraduatedHabitSummary = async (
  habitId: number,
  userId: number
): Promise<GraduatedHabitStats | null> => {
  const [habit, logs, freezes] = await Promise.all([
    prisma.habit.findFirst({ where: { id: habitId, userId, graduated: true } }),
    prisma.habitLog.findMany({ where: { habitId }, select: { habitId: true, date: true, completed: true } }),
    prisma.freezeUsage.findMany({ where: { userId }, select: { date: true } }),
  ]);
  return habit ? computeGraduatedStats(habit, logs, freezes) : null;
};

/**
 * Pure: собирает per-habit stats из уже загруженных логов и freeze-usage.
 */
const computeHabitStats = (
  habit: {
    id: number;
    name: string;
    emoji: string;
    frequencyType: string;
    frequencyDays: number;
    weekdays: string | null;
    createdAt: Date;
    isActive: boolean;
    deletedDate: string | null;
  },
  allLogs: StreakHabitLog[],
  allFreezes: StreakFreezeUsage[],
  todayDate: string,
  lastNDays: string[]
): HabitStats => {
  const ownLogs = allLogs.filter((l) => l.habitId === habit.id);
  const totalCompleted = ownLogs.filter((l) => l.completed).length;

  const streakHabit: StreakHabit = {
    id: habit.id,
    frequencyType: habit.frequencyType,
    frequencyDays: habit.frequencyDays,
    weekdays: habit.weekdays,
    createdAt: habit.createdAt,
    isActive: habit.isActive,
    deletedDate: habit.deletedDate,
  };

  const currentStreak = calculatePerHabitStreak(streakHabit, allLogs, allFreezes, todayDate, {
    lenientToday: true,
  });
  const maxStreak = calculatePerHabitMaxStreak(streakHabit, allLogs, allFreezes, todayDate);
  const completionRate = computeCompletionRate(ownLogs, habit.frequencyDays, lastNDays);

  return {
    habitId: habit.id,
    name: habit.name,
    emoji: habit.emoji,
    totalCompleted,
    currentStreak,
    maxStreak,
    completionRate,
  };
};

/**
 * Pure: рендерит график активности по списку дат с выполнением.
 * Сетка ACTIVITY_GRID_WEEKS недель, последняя — текущая.
 */
export const renderActivityGraph = (
  activeDates: Set<string>,
  todayDate: string
): string => {
  const today = parse(todayDate, 'yyyy-MM-dd', new Date());
  const currentMonday = startOfWeek(today, { weekStartsOn: 1 });
  const firstMonday = subWeeks(currentMonday, ACTIVITY_GRID_WEEKS - 1);

  const startDay = firstMonday.getDate();
  const startMonth = MONTH_NAMES_SHORT[firstMonday.getMonth()];
  const endDay = today.getDate();
  const endMonth = MONTH_NAMES_SHORT[today.getMonth()];

  let graph = `📊 *Активность* (${startDay} ${startMonth} — ${endDay} ${endMonth})\n\n`;

  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    const dayLabel = `\`${WEEKDAY_LABELS[dayOfWeek] ?? ''}\``;
    let row = `${dayLabel} `;
    for (let week = 0; week < ACTIVITY_GRID_WEEKS; week++) {
      const checkDate = addDays(firstMonday, week * 7 + dayOfWeek);
      if (checkDate > today) continue;
      const dateStr = format(checkDate, 'yyyy-MM-dd');
      row += activeDates.has(dateStr) ? '🟩' : '⬜';
    }
    graph += row + '\n';
  }

  graph += '\n🟩 — выполнено  ⬜ — нет';
  return graph;
};

/**
 * Загружает все данные пользователя одним «пакетом» и считает всю
 * статистику через pure-функции. Один проход по логам/freeze'ам.
 *
 * @param userId - ID пользователя в БД
 * @param timezoneOffset - Смещение часового пояса
 * @returns Полная статистика пользователя со встроенным графиком
 */
export const getUserStats = async (
  userId: number,
  timezoneOffset: number = 180
): Promise<UserStats> => {
  const todayDate = getTodayDate(timezoneOffset);
  const lastNDays = getLastNDays(30, timezoneOffset);

  const [user, habits, allLogsRaw, allFreezesRaw] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { freezeCount: true, freezeEnabled: true },
    }),
    prisma.habit.findMany({ where: { userId } }),
    prisma.habitLog.findMany({
      where: { habit: { userId } },
      select: { habitId: true, date: true, completed: true },
    }),
    prisma.freezeUsage.findMany({
      where: { userId },
      select: { date: true },
    }),
  ]);

  const allLogs: StreakHabitLog[] = allLogsRaw;
  const allFreezes: StreakFreezeUsage[] = allFreezesRaw;

  const activeHabits = habits.filter((h) => h.isActive);
  const totalCompletions = allLogs.filter((l) => l.completed).length;

  const habitStats: HabitStats[] = activeHabits.map((h) =>
    computeHabitStats(h, allLogs, allFreezes, todayDate, lastNDays)
  );
  const graduatedHabits = habits
    .filter((h) => h.graduated)
    .map((h) => computeGraduatedStats(h, allLogs, allFreezes))
    .sort((a, b) => a.graduatedDate.localeCompare(b.graduatedDate));

  // Для UI используем lenient версию: пока сегодня не закончен и юзер ещё
  // ничего не отметил, показываем «вчерашний» стрик вместо 0.
  // Для milestone/earn-freeze/triggers используется строгая версия отдельно.
  const overallStreak =
    habits.length > 0
      ? calculateOverallStreak(habits, allLogs, allFreezes, todayDate, { lenientToday: true })
      : 0;

  // Отметки удалённых привычек тоже красят свои дни: удаление привычки не
  // стирает историю (так же считается и общий стрик).
  const activeDates = new Set(allLogs.filter((l) => l.completed).map((l) => l.date));

  return {
    totalHabits: habits.length,
    activeHabits: activeHabits.length,
    totalCompletions,
    overallStreak,
    freezeCount: user?.freezeCount ?? 0,
    freezeEnabled: user?.freezeEnabled ?? true,
    activityGraph: renderActivityGraph(activeDates, todayDate),
    habitStats,
    graduatedHabits,
  };
};

/**
 * Pure-форматирование сообщения статистики. Все данные уже посчитаны в
 * `getUserStats` — здесь только сборка строки, без БД запросов.
 */
export const formatStatsMessage = (stats: UserStats): string => {
  if (stats.activeHabits === 0 && stats.totalCompletions === 0 && stats.graduatedHabits.length === 0) {
    return '📊 *Статистика*\n\nУ тебя пока нет привычек. Добавь первую! ✨';
  }

  let message = '📊 *Твоя статистика*\n\n';
  message += `📝 Активных привычек: *${stats.activeHabits}*\n`;
  message += `✅ Всего выполнений: *${stats.totalCompletions}*\n`;
  message += `🔥 Общий стрик активности: *${stats.overallStreak}* дн.\n`;
  message += stats.freezeEnabled
    ? `🧊 Заморозки: *${stats.freezeCount}/${FREEZE_CAP}*\n\n`
    : `🧊 Заморозки: *выключены*\n\n`;

  message += stats.activityGraph + '\n';
  if (stats.habitStats.length > 0) message += '━━━━━━━━━━━━━━━\n\n';

  for (const habit of stats.habitStats) {
    const recordSuffix =
      habit.currentStreak < habit.maxStreak ? ` (Рекорд: ${habit.maxStreak})` : '';
    message += `${habit.emoji} *${escapeMarkdown(habit.name)}*\n`;
    message += `   🔥 Стрик: ${habit.currentStreak} дн.${recordSuffix}\n`;
    message += `   📈 За 30 дней: ${habit.completionRate}%\n\n`;
  }

  if (stats.graduatedHabits.length > 0) {
    if (stats.habitStats.length === 0) message += '━━━━━━━━━━━━━━━\n\n';
    message += '🏆 *Внедрённые*\n';
    // Последние по дате, чтобы длинная история не упёрлась в лимит сообщения.
    const shown = stats.graduatedHabits.slice(-MAX_GRADUATED_SHOWN);
    for (const g of shown) {
      const [year, month, day] = g.graduatedDate.split('-');
      message += `${g.emoji} *${escapeMarkdown(g.name)}* — внедрена ${day}.${month}.${year}, выполнений: ${g.totalCompleted}, рекорд: ${g.maxStreak} дн.\n`;
    }
    const hidden = stats.graduatedHabits.length - shown.length;
    if (hidden > 0) message += `…и ещё ${hidden}\n`;
  }

  return message;
};
