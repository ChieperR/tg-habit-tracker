import { format, subDays, differenceInDays } from 'date-fns';
import { prisma } from '../../db/index.js';
import { calculateWindowRetention } from './retention.js';
import { getUserSegments, type SegmentationResult } from './segmentation.js';

/** Период аналитики */
export type AnalyticsPeriod = '7d' | '30d' | '90d' | 'all';

/** Данные аналитики за период */
export type AnalyticsData = {
  period: AnalyticsPeriod;
  totalUsers: number;
  newUsers: number;
  prevNewUsers: number;
  dauAvg: number;
  mau: number;
  totalCheckins: number;
  retentionD7: number;
  retentionD30: number;
  topSources: [string, number][];
  segments?: SegmentationResult;
};

/** Данные для ежедневного отчёта администратору */
export type DailyReport = {
  date: string;
  dau: number;
  newUsers: number;
  totalUsers: number;
  totalCheckins: number;
  retentionD7: number;
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

  const totalUsers = await prisma.user.count();

  const newUsers = await prisma.user.count({
    where: {
      createdAt: { gte: startOfYesterday, lte: endOfYesterday },
    },
  });

  // DAU: уникальные пользователи с check-in за вчера
  const dauGroups = await prisma.habitLog.groupBy({
    by: ['habitId'],
    where: { date: yesterday, completed: true },
  });
  const dauHabitIds = dauGroups.map((g) => g.habitId);
  const dauHabits = dauHabitIds.length > 0
    ? await prisma.habit.findMany({
        where: { id: { in: dauHabitIds } },
        select: { userId: true },
      })
    : [];
  const dau = new Set(dauHabits.map((h) => h.userId)).size;

  // MAU: уникальные пользователи с check-in за последние 30 дней
  const mauGroups = await prisma.habitLog.groupBy({
    by: ['habitId'],
    where: { completed: true, date: { gte: thirtyDaysAgo } },
  });
  const mauHabitIds = mauGroups.map((g) => g.habitId);
  const mauHabits = mauHabitIds.length > 0
    ? await prisma.habit.findMany({
        where: { id: { in: mauHabitIds } },
        select: { userId: true },
      })
    : [];
  const mau = new Set(mauHabits.map((h) => h.userId)).size;

  const totalHabits = await prisma.habit.count();
  const activeHabits = await prisma.habit.count({ where: { isActive: true } });

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
 */
export const getAnalytics = async (period: AnalyticsPeriod): Promise<AnalyticsData> => {
  const now = new Date();

  const isAll = period === 'all';
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0;

  const startDate = isAll ? '2020-01-01' : format(subDays(now, periodDays), 'yyyy-MM-dd');
  const prevStartDate = isAll ? '2020-01-01' : format(subDays(now, periodDays * 2), 'yyyy-MM-dd');

  const startDateUTC = new Date(`${startDate}T00:00:00.000Z`);
  const prevStartDateUTC = isAll ? startDateUTC : new Date(`${prevStartDate}T00:00:00.000Z`);

  const totalUsers = await prisma.user.count();

  const newUsers = await prisma.user.count({
    where: { createdAt: { gte: startDateUTC } },
  });

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

  const totalCheckins = await prisma.habitLog.count({
    where: { date: { gte: startDate }, completed: true },
  });

  // Window-based Retention + Segments
  const [d7Result, d30Result, segments] = await Promise.all([
    calculateWindowRetention(7),
    calculateWindowRetention(30),
    getUserSegments(),
  ]);

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
    retentionD7: d7Result.percent,
    retentionD30: d30Result.percent,
    topSources,
    segments,
  };
};

/**
 * Возвращает аналитические данные за произвольный диапазон дат.
 */
export const getAnalyticsForRange = async (from: string, to: string): Promise<AnalyticsData> => {
  const fromUTC = new Date(`${from}T00:00:00.000Z`);
  const toUTC = new Date(`${to}T23:59:59.999Z`);

  const periodDays = Math.max(1, differenceInDays(toUTC, fromUTC));
  const prevFrom = format(subDays(fromUTC, periodDays), 'yyyy-MM-dd');
  const prevFromUTC = new Date(`${prevFrom}T00:00:00.000Z`);

  const totalUsers = await prisma.user.count({
    where: { createdAt: { lte: toUTC } },
  });

  const newUsers = await prisma.user.count({
    where: { createdAt: { gte: fromUTC, lte: toUTC } },
  });

  const prevNewUsers = await prisma.user.count({
    where: { createdAt: { gte: prevFromUTC, lt: fromUTC } },
  });

  const snapshots = await prisma.dailySnapshot.findMany({
    where: { date: { gte: from, lte: to } },
    select: { dau: true, mau: true },
    orderBy: { date: 'asc' },
  });

  const dauAvg =
    snapshots.length > 0
      ? Math.round(snapshots.reduce((sum, s) => sum + s.dau, 0) / snapshots.length)
      : 0;

  const lastSnapshot = snapshots[snapshots.length - 1];
  const mau = lastSnapshot ? lastSnapshot.mau : 0;

  const totalCheckins = await prisma.habitLog.count({
    where: { date: { gte: from, lte: to }, completed: true },
  });

  const [d7Result, d30Result] = await Promise.all([
    calculateWindowRetention(7),
    calculateWindowRetention(30),
  ]);

  const sourceGroups = await prisma.user.groupBy({
    by: ['source'],
    where: { createdAt: { gte: fromUTC, lte: toUTC } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  });
  const topSources: [string, number][] = sourceGroups.map((g) => [g.source, g._count.id]);

  return {
    period: 'all',
    totalUsers,
    newUsers,
    prevNewUsers,
    dauAvg,
    mau,
    totalCheckins,
    retentionD7: d7Result.percent,
    retentionD30: d30Result.percent,
    topSources,
  };
};

/**
 * Формирует данные ежедневного отчёта для отправки администратору.
 */
export const getDailyReport = async (): Promise<DailyReport> => {
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  const snapshot = await prisma.dailySnapshot.findUnique({ where: { date: yesterday } });
  const totalUsers = await prisma.user.count();

  const d7Result = await calculateWindowRetention(7);

  return {
    date: yesterday,
    dau: snapshot?.dau ?? 0,
    newUsers: snapshot?.newUsers ?? 0,
    totalUsers,
    totalCheckins: snapshot?.totalCheckins ?? 0,
    retentionD7: d7Result.percent,
  };
};
