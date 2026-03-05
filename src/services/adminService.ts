import { format, subDays } from 'date-fns';
import { prisma } from '../db/index.js';

/**
 * Сервис администрирования — статистика бота
 * @module services/adminService
 */

/**
 * Статистика бота
 */
export type BotStats = {
  /** Всего пользователей */
  totalUsers: number;
  /** Активных пользователей за последние 7 дней */
  activeUsers7d: number;
  /** Активных пользователей за последние 30 дней */
  activeUsers30d: number;
  /** Всего привычек (включая неактивные) */
  totalHabits: number;
  /** Активных привычек */
  activeHabits: number;
  /** Привычек с типом "daily" */
  dailyHabits: number;
  /** Привычек с типом "interval" */
  intervalHabits: number;
  /** Привычек с типом "weekdays" */
  weekdaysHabits: number;
  /** Привычек с персональным напоминанием */
  habitsWithReminder: number;
  /** Выполнений привычек сегодня */
  completionsToday: number;
  /** Напоминаний отправлено сегодня (habit + morning + evening) */
  remindersSentToday: number;
  /** Топ-5 эмодзи в привычках: массив [emoji, count] */
  topEmoji: [string, number][];
};

/**
 * Возвращает строку сегодняшней даты в формате YYYY-MM-DD (UTC)
 */
const todayUtc = (): string => format(new Date(), 'yyyy-MM-dd');

/**
 * Собирает статистику бота из БД
 * @returns Объект со статистикой
 */
export const getBotStats = async (): Promise<BotStats> => {
  const today = todayUtc();
  const date7dAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
  const date30dAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  // --- Пользователи ---
  const totalUsers = await prisma.user.count();

  const activeUsers7dRaw = await prisma.habitLog.findMany({
    where: {
      completed: true,
      date: { gte: date7dAgo },
    },
    select: {
      habit: { select: { userId: true } },
    },
    distinct: ['habitId'],
  });
  const activeUsers7d = new Set(activeUsers7dRaw.map((l) => l.habit.userId)).size;

  const activeUsers30dRaw = await prisma.habitLog.findMany({
    where: {
      completed: true,
      date: { gte: date30dAgo },
    },
    select: {
      habit: { select: { userId: true } },
    },
    distinct: ['habitId'],
  });
  const activeUsers30d = new Set(activeUsers30dRaw.map((l) => l.habit.userId)).size;

  // --- Привычки ---
  const totalHabits = await prisma.habit.count();
  const activeHabits = await prisma.habit.count({ where: { isActive: true } });

  const dailyHabits = await prisma.habit.count({
    where: { isActive: true, frequencyType: 'daily' },
  });
  const intervalHabits = await prisma.habit.count({
    where: { isActive: true, frequencyType: 'interval' },
  });
  const weekdaysHabits = await prisma.habit.count({
    where: { isActive: true, frequencyType: 'weekdays' },
  });

  const habitsWithReminder = await prisma.habit.count({
    where: { isActive: true, reminderTime: { not: null } },
  });

  // --- Выполнения сегодня ---
  const completionsToday = await prisma.habitLog.count({
    where: { date: today, completed: true },
  });

  // --- Напоминания отправлены сегодня ---
  const habitRemindersToday = await prisma.habit.count({
    where: { lastHabitReminderDate: today },
  });
  const morningRemindersToday = await prisma.user.count({
    where: { lastMorningReminderDate: today },
  });
  const eveningRemindersToday = await prisma.user.count({
    where: { lastEveningReminderDate: today },
  });
  const remindersSentToday = habitRemindersToday + morningRemindersToday + eveningRemindersToday;

  // --- Топ-5 эмодзи ---
  const allEmoji = await prisma.habit.findMany({
    where: { isActive: true },
    select: { emoji: true },
  });

  const emojiCount: Record<string, number> = {};
  for (const { emoji } of allEmoji) {
    emojiCount[emoji] = (emojiCount[emoji] ?? 0) + 1;
  }

  const topEmoji = Object.entries(emojiCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5) as [string, number][];

  return {
    totalUsers,
    activeUsers7d,
    activeUsers30d,
    totalHabits,
    activeHabits,
    dailyHabits,
    intervalHabits,
    weekdaysHabits,
    habitsWithReminder,
    completionsToday,
    remindersSentToday,
    topEmoji,
  };
};
