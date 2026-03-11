import { format, subDays, differenceInDays } from 'date-fns';
import { prisma } from '../db/index.js';

/**
 * Сервис аналитики — трекинг событий, ежедневные снапшоты и отчёты
 * @module services/analyticsService
 */

/**
 * Период аналитики
 */
export type AnalyticsPeriod = '7d' | '30d' | '90d' | 'all';

/**
 * Данные аналитики за период
 */
export type AnalyticsData = {
  /** Период */
  period: AnalyticsPeriod;
  /** Всего пользователей */
  totalUsers: number;
  /** Новых пользователей за период */
  newUsers: number;
  /** Новых пользователей за предыдущий аналогичный период (для сравнения) */
  prevNewUsers: number;
  /** Среднее DAU за период */
  dauAvg: number;
  /** MAU (последнее значение) */
  mau: number;
  /** Всего check-in'ов за период */
  totalCheckins: number;
  /** D7 Retention, % */
  retentionD7: number;
  /** D30 Retention, % */
  retentionD30: number;
  /** Топ источников: [source, count][] */
  topSources: [string, number][];
};

/**
 * Данные для ежедневного отчёта администратору
 */
export type DailyReport = {
  /** Дата отчёта (YYYY-MM-DD) */
  date: string;
  /** DAU за день */
  dau: number;
  /** Новых пользователей за день */
  newUsers: number;
  /** Всего пользователей */
  totalUsers: number;
  /** Всего check-in'ов за день */
  totalCheckins: number;
  /** D7 Retention, % */
  retentionD7: number;
};

/**
 * Записывает аналитическое событие и обновляет lastActiveAt пользователя.
 * Обрабатывает ошибки внутри — безопасно вызывать без await (fire-and-forget).
 * @param userId - ID пользователя в БД
 * @param type - Тип события ('start' | 'checkin' | 'habit_create' | 'habit_delete' | 'reminder_sent')
 * @param metadata - Дополнительные данные
 */
/** Типы аналитических событий */
export type AnalyticsEventType = 'start' | 'checkin' | 'habit_create' | 'habit_delete' | 'reminder_sent';

export const trackEvent = async (
  userId: number,
  type: AnalyticsEventType,
  metadata?: Record<string, unknown>
): Promise<void> => {
  try {
    await prisma.$transaction([
      prisma.analyticsEvent.create({
        data: {
          userId,
          type,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { lastActiveAt: new Date() },
      }),
    ]);
  } catch (err) {
    console.error('[analytics] trackEvent error:', err);
  }
};

/**
 * Собирает агрегаты за вчера и записывает в DailySnapshot.
 * Вызывается cron-задачей каждый день в 00:05 UTC.
 */
export const takeDailySnapshot = async (): Promise<void> => {
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const startOfYesterday = new Date(`${yesterday}T00:00:00.000Z`);
  const endOfYesterday = new Date(`${yesterday}T23:59:59.999Z`);

  // Всего пользователей
  const totalUsers = await prisma.user.count();

  // Новых пользователей за вчера
  const newUsers = await prisma.user.count({
    where: {
      createdAt: { gte: startOfYesterday, lte: endOfYesterday },
    },
  });

  // DAU: уникальные пользователи с check-in за вчера
  const dauLogs = await prisma.habitLog.findMany({
    where: { date: yesterday, completed: true },
    select: { habit: { select: { userId: true } } },
  });
  const dau = new Set(dauLogs.map((l) => l.habit.userId)).size;

  // MAU: уникальные пользователи с check-in за последние 30 дней
  const mauLogs = await prisma.habitLog.findMany({
    where: { completed: true, date: { gte: thirtyDaysAgo } },
    select: { habit: { select: { userId: true } } },
  });
  const mau = new Set(mauLogs.map((l) => l.habit.userId)).size;

  // Привычки
  const totalHabits = await prisma.habit.count();
  const activeHabits = await prisma.habit.count({ where: { isActive: true } });

  // Выполнений за вчера
  const totalCheckins = await prisma.habitLog.count({
    where: { date: yesterday, completed: true },
  });

  // Средний текущий стрик по активным привычкам
  const activeHabitsList = await prisma.habit.findMany({
    where: { isActive: true },
    select: {
      id: true,
      logs: {
        where: { completed: true },
        orderBy: { date: 'desc' },
        take: 100,
        select: { date: true },
      },
    },
  });

  let totalStreaks = 0;
  let streakCount = 0;
  for (const habit of activeHabitsList) {
    if (habit.logs.length === 0) continue;
    // Считаем стрик: последовательные дни от вчера назад
    const dates = habit.logs.map((l) => l.date).sort().reverse();
    let streak = 0;
    let expectedDate = yesterday;
    for (const date of dates) {
      if (date === expectedDate) {
        streak++;
        expectedDate = format(subDays(new Date(`${expectedDate}T12:00:00Z`), 1), 'yyyy-MM-dd');
      } else if (date < expectedDate) {
        break;
      }
    }
    if (streak > 0) {
      totalStreaks += streak;
      streakCount++;
    }
  }
  const avgStreak = streakCount > 0 ? Math.round((totalStreaks / streakCount) * 10) / 10 : 0;

  await prisma.dailySnapshot.upsert({
    where: { date: yesterday },
    update: { totalUsers, newUsers, dau, mau, totalHabits, activeHabits, totalCheckins, avgStreak },
    create: { date: yesterday, totalUsers, newUsers, dau, mau, totalHabits, activeHabits, totalCheckins, avgStreak },
  });

  console.log(`[analytics] Снапшот за ${yesterday}: DAU=${dau}, newUsers=${newUsers}, checkins=${totalCheckins}`);
};

/**
 * Возвращает аналитические данные за указанный период.
 * @param period - Период ('7d' | '30d' | '90d' | 'all')
 * @returns Данные аналитики
 */
export const getAnalytics = async (period: AnalyticsPeriod): Promise<AnalyticsData> => {
  const now = new Date();

  const isAll = period === 'all';
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0;

  // Для 'all': берём от самого первого юзера
  const startDate = isAll ? '2020-01-01' : format(subDays(now, periodDays), 'yyyy-MM-dd');
  const prevStartDate = isAll ? '2020-01-01' : format(subDays(now, periodDays * 2), 'yyyy-MM-dd');

  const startDateUTC = new Date(`${startDate}T00:00:00.000Z`);
  const prevStartDateUTC = isAll ? startDateUTC : new Date(`${prevStartDate}T00:00:00.000Z`);

  // Всего пользователей
  const totalUsers = await prisma.user.count();

  // Новых за период
  const newUsers = await prisma.user.count({
    where: { createdAt: { gte: startDateUTC } },
  });

  // Новых за предыдущий период (для сравнения роста)
  const prevNewUsers = await prisma.user.count({
    where: { createdAt: { gte: prevStartDateUTC, lt: startDateUTC } },
  });

  // DAU среднее и MAU из DailySnapshot
  const snapshots = await prisma.dailySnapshot.findMany({
    where: { date: { gte: startDate } },
    select: { dau: true, mau: true },
    orderBy: { date: 'asc' },
  });

  const dauAvg =
    snapshots.length > 0
      ? Math.round(snapshots.reduce((sum, s) => sum + s.dau, 0) / snapshots.length)
      : 0;

  const lastSnapshot = snapshots[snapshots.length - 1];
  const mau = lastSnapshot ? lastSnapshot.mau : 0;

  // Check-ins за период
  const totalCheckins = await prisma.habitLog.count({
    where: { date: { gte: startDate }, completed: true },
  });

  // D7 Retention: % пользователей созданных 7+ дней назад, у которых lastActiveAt >= createdAt+7d
  const usersForD7 = await prisma.user.findMany({
    where: { createdAt: { lte: subDays(now, 7) } },
    select: { createdAt: true, lastActiveAt: true },
  });
  const d7Retained = usersForD7.filter(
    (u) => u.lastActiveAt && differenceInDays(u.lastActiveAt, u.createdAt) >= 7
  ).length;
  const retentionD7 =
    usersForD7.length > 0 ? Math.round((d7Retained / usersForD7.length) * 100) : 0;

  // D30 Retention
  const usersForD30 = await prisma.user.findMany({
    where: { createdAt: { lte: subDays(now, 30) } },
    select: { createdAt: true, lastActiveAt: true },
  });
  const d30Retained = usersForD30.filter(
    (u) => u.lastActiveAt && differenceInDays(u.lastActiveAt, u.createdAt) >= 30
  ).length;
  const retentionD30 =
    usersForD30.length > 0 ? Math.round((d30Retained / usersForD30.length) * 100) : 0;

  // Топ источников
  const sourceGroups = await prisma.user.groupBy({
    by: ['source'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  });
  const topSources: [string, number][] = sourceGroups.map((g) => [g.source, g._count.id]);

  return {
    period,
    totalUsers,
    newUsers,
    prevNewUsers,
    dauAvg,
    mau,
    totalCheckins,
    retentionD7,
    retentionD30,
    topSources,
  };
};

/**
 * Формирует данные ежедневного отчёта для отправки администратору.
 * Использует последний DailySnapshot (за вчера).
 * @returns Данные ежедневного отчёта
 */
export const getDailyReport = async (): Promise<DailyReport> => {
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const now = new Date();

  const snapshot = await prisma.dailySnapshot.findUnique({ where: { date: yesterday } });
  const totalUsers = await prisma.user.count();

  // D7 Retention
  const usersForD7 = await prisma.user.findMany({
    where: { createdAt: { lte: subDays(now, 7) } },
    select: { createdAt: true, lastActiveAt: true },
  });
  const d7Retained = usersForD7.filter(
    (u) => u.lastActiveAt && differenceInDays(u.lastActiveAt, u.createdAt) >= 7
  ).length;
  const retentionD7 =
    usersForD7.length > 0 ? Math.round((d7Retained / usersForD7.length) * 100) : 0;

  return {
    date: yesterday,
    dau: snapshot?.dau ?? 0,
    newUsers: snapshot?.newUsers ?? 0,
    totalUsers,
    totalCheckins: snapshot?.totalCheckins ?? 0,
    retentionD7,
  };
};
