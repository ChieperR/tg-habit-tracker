import { format, subDays, differenceInDays, addDays } from 'date-fns';
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
  /** Сегментация пользователей */
  segments?: SegmentationResult;
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
export type AnalyticsEventType = 'start' | 'start_returning' | 'checkin' | 'habit_create' | 'habit_delete' | 'reminder_sent' | 'bot_blocked' | 'view_habits' | 'view_stats';

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

/** Сегмент пользователя */
export type UserSegment = 'power' | 'active' | 'dormant' | 'churned' | 'zombie';

/** Результат сегментации */
export type SegmentationResult = {
  power: number;
  active: number;
  dormant: number;
  churned: number;
  zombie: number;
  total: number;
};

/**
 * Сегментирует пользователей по активности.
 * - power: 5+ checkin'ов за последние 7 дней
 * - active: 1-4 checkin'а за последние 7 дней
 * - dormant: последний checkin 8-30 дней назад
 * - churned: последний checkin 30+ дней назад или 0 checkin'ов
 * - zombie: dormant/churned, но напоминания включены
 */
export const getUserSegments = async (): Promise<SegmentationResult> => {
  const now = new Date();
  const date7dAgo = format(subDays(now, 7), 'yyyy-MM-dd');
  const date30dAgo = format(subDays(now, 30), 'yyyy-MM-dd');

  const users = await prisma.user.findMany({
    select: {
      id: true,
      morningEnabled: true,
      eveningEnabled: true,
      habits: {
        where: { isActive: true },
        select: {
          logs: {
            where: { completed: true },
            orderBy: { date: 'desc' as const },
            take: 1,
            select: { date: true },
          },
        },
      },
    },
  });

  // Получаем checkin counts за 7 дней для каждого юзера
  const checkinCounts = await prisma.habitLog.groupBy({
    by: ['habitId'],
    where: { completed: true, date: { gte: date7dAgo } },
    _count: { id: true },
  });

  // Маппим habitId -> userId
  const habitUserMap = new Map<number, number>();
  for (const user of users) {
    for (const habit of user.habits) {
      // Нужен habitId — получим из отдельного запроса
    }
  }

  // Проще: получаем per-user checkin count за 7 дней
  const recentCheckins = await prisma.habitLog.findMany({
    where: { completed: true, date: { gte: date7dAgo } },
    select: { habit: { select: { userId: true } } },
  });

  const userCheckinCount = new Map<number, number>();
  for (const log of recentCheckins) {
    const uid = log.habit.userId;
    userCheckinCount.set(uid, (userCheckinCount.get(uid) ?? 0) + 1);
  }

  const result: SegmentationResult = { power: 0, active: 0, dormant: 0, churned: 0, zombie: 0, total: users.length };

  for (const user of users) {
    const count7d = userCheckinCount.get(user.id) ?? 0;
    const remindersEnabled = user.morningEnabled || user.eveningEnabled;

    // Найти дату последнего checkin'а
    let lastCheckinDate: string | null = null;
    for (const habit of user.habits) {
      const lastLog = habit.logs[0];
      if (lastLog && (!lastCheckinDate || lastLog.date > lastCheckinDate)) {
        lastCheckinDate = lastLog.date;
      }
    }

    if (count7d >= 5) {
      result.power++;
    } else if (count7d >= 1) {
      result.active++;
    } else if (lastCheckinDate && lastCheckinDate >= date30dAgo) {
      // Нет checkin за 7д, но есть за 30д = dormant
      if (remindersEnabled) {
        result.zombie++;
      } else {
        result.dormant++;
      }
    } else {
      // Нет checkin за 30д или вообще нет checkin'ов = churned
      if (remindersEnabled) {
        result.zombie++;
      } else {
        result.churned++;
      }
    }
  }

  return result;
};

/**
 * Считает window-based retention для заданного дня.
 * Юзер retained на Dn = у него есть checkin в окне [Dn-1, Dn+1] после регистрации.
 * @param day - День retention (7 или 30)
 * @returns { total: число юзеров в выборке, retained: число retained, percent: % }
 */
export const calculateWindowRetention = async (
  day: number
): Promise<{ total: number; retained: number; percent: number }> => {
  const now = new Date();

  // Берём юзеров, зарегистрированных минимум day+1 дней назад (чтобы окно [day-1, day+1] уже прошло)
  const users = await prisma.user.findMany({
    where: { createdAt: { lte: subDays(now, day + 1) } },
    select: { id: true, createdAt: true },
  });

  if (users.length === 0) {
    return { total: 0, retained: 0, percent: 0 };
  }

  let retained = 0;

  for (const user of users) {
    const windowStart = format(addDays(user.createdAt, day - 1), 'yyyy-MM-dd');
    const windowEnd = format(addDays(user.createdAt, day + 1), 'yyyy-MM-dd');

    const checkin = await prisma.habitLog.findFirst({
      where: {
        habit: { userId: user.id },
        completed: true,
        date: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true },
    });

    if (checkin) retained++;
  }

  return {
    total: users.length,
    retained,
    percent: users.length > 0 ? Math.round((retained / users.length) * 100) : 0,
  };
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

  // DAU: уникальные пользователи с check-in за вчера (groupBy по userId через Habit relation)
  const dauGroups = await prisma.habitLog.groupBy({
    by: ['habitId'],
    where: { date: yesterday, completed: true },
  });
  // Нужно достать уникальные userId — получаем привычки для этих habitId
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
 * @param from - Начало периода (YYYY-MM-DD)
 * @param to - Конец периода (YYYY-MM-DD)
 * @returns Данные аналитики
 */
export const getAnalyticsForRange = async (from: string, to: string): Promise<AnalyticsData> => {
  const fromUTC = new Date(`${from}T00:00:00.000Z`);
  const toUTC = new Date(`${to}T23:59:59.999Z`);

  const periodDays = Math.max(1, differenceInDays(toUTC, fromUTC));
  const prevFrom = format(subDays(fromUTC, periodDays), 'yyyy-MM-dd');
  const prevFromUTC = new Date(`${prevFrom}T00:00:00.000Z`);

  // Всего пользователей на конец периода
  const totalUsers = await prisma.user.count({
    where: { createdAt: { lte: toUTC } },
  });

  // Новых за период
  const newUsers = await prisma.user.count({
    where: { createdAt: { gte: fromUTC, lte: toUTC } },
  });

  // Новых за предыдущий аналогичный период
  const prevNewUsers = await prisma.user.count({
    where: { createdAt: { gte: prevFromUTC, lt: fromUTC } },
  });

  // DAU среднее и MAU из DailySnapshot
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

  // Check-ins за период
  const totalCheckins = await prisma.habitLog.count({
    where: { date: { gte: from, lte: to }, completed: true },
  });

  // Window-based Retention (глобальный)
  const [d7Result, d30Result] = await Promise.all([
    calculateWindowRetention(7),
    calculateWindowRetention(30),
  ]);

  // Топ источников (за период)
  const sourceGroups = await prisma.user.groupBy({
    by: ['source'],
    where: { createdAt: { gte: fromUTC, lte: toUTC } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  });
  const topSources: [string, number][] = sourceGroups.map((g) => [g.source, g._count.id]);

  return {
    period: 'all', // используем 'all' как тип для кастомного периода
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
 * Использует последний DailySnapshot (за вчера).
 * @returns Данные ежедневного отчёта
 */
export const getDailyReport = async (): Promise<DailyReport> => {
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const now = new Date();

  const snapshot = await prisma.dailySnapshot.findUnique({ where: { date: yesterday } });
  const totalUsers = await prisma.user.count();

  // Window-based D7 Retention
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
