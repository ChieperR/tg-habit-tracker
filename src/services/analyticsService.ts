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

/** Шаг воронки активации */
export type FunnelStep = {
  name: string;
  count: number;
  percent: number;
};

/** Результат воронки активации */
export type ActivationFunnelResult = {
  steps: FunnelStep[];
};

/**
 * Строит воронку активации: на каком шаге отваливаются юзеры.
 * /start → создал привычку → первый checkin → checkin на 2й день → checkin на 7й день → активен сейчас
 */
export const getActivationFunnel = async (): Promise<ActivationFunnelResult> => {
  const now = new Date();
  const date7dAgo = format(subDays(now, 7), 'yyyy-MM-dd');

  // Шаг 1: все юзеры (/start)
  const totalUsers = await prisma.user.count();

  // Шаг 2: создали хотя бы 1 привычку
  const usersWithHabits = await prisma.user.count({
    where: { habits: { some: {} } },
  });

  // Шаг 3: сделали хотя бы 1 checkin
  const usersWithCheckins = await prisma.habitLog.findMany({
    where: { completed: true },
    select: { habit: { select: { userId: true } } },
    distinct: ['habitId'],
  });
  const uniqueCheckinUsers = new Set(usersWithCheckins.map((l) => l.habit.userId)).size;

  // Шаг 4: checkin на 2й день после регистрации (были активны на следующий день)
  const allUsers = await prisma.user.findMany({
    where: { createdAt: { lte: subDays(now, 2) } },
    select: { id: true, createdAt: true },
  });

  let d2Retained = 0;
  let d7Retained = 0;

  for (const user of allUsers) {
    const d2Date = format(addDays(user.createdAt, 1), 'yyyy-MM-dd');
    const d2Checkin = await prisma.habitLog.findFirst({
      where: { habit: { userId: user.id }, completed: true, date: d2Date },
      select: { id: true },
    });
    if (d2Checkin) d2Retained++;

    // Шаг 5: checkin на 7й день (окно [6, 8])
    if (differenceInDays(now, user.createdAt) >= 8) {
      const d7Start = format(addDays(user.createdAt, 6), 'yyyy-MM-dd');
      const d7End = format(addDays(user.createdAt, 8), 'yyyy-MM-dd');
      const d7Checkin = await prisma.habitLog.findFirst({
        where: { habit: { userId: user.id }, completed: true, date: { gte: d7Start, lte: d7End } },
        select: { id: true },
      });
      if (d7Checkin) d7Retained++;
    }
  }

  // Шаг 6: активен сейчас (checkin за последние 7 дней)
  const activeNow = await prisma.habitLog.findMany({
    where: { completed: true, date: { gte: date7dAgo } },
    select: { habit: { select: { userId: true } } },
    distinct: ['habitId'],
  });
  const activeNowCount = new Set(activeNow.map((l) => l.habit.userId)).size;

  const pct = (n: number) => totalUsers > 0 ? Math.round((n / totalUsers) * 100) : 0;

  const d7EligibleCount = allUsers.filter((u) => differenceInDays(now, u.createdAt) >= 8).length;

  return {
    steps: [
      { name: '/start', count: totalUsers, percent: 100 },
      { name: 'Создал привычку', count: usersWithHabits, percent: pct(usersWithHabits) },
      { name: 'Первый check-in', count: uniqueCheckinUsers, percent: pct(uniqueCheckinUsers) },
      { name: 'Check-in на 2й день', count: d2Retained, percent: pct(d2Retained) },
      { name: `Check-in на D7 (из ${d7EligibleCount})`, count: d7Retained, percent: d7EligibleCount > 0 ? Math.round((d7Retained / d7EligibleCount) * 100) : 0 },
      { name: 'Активен сейчас', count: activeNowCount, percent: pct(activeNowCount) },
    ],
  };
};

/** Метрики здоровья привычек */
export type HabitHealthMetrics = {
  totalActive: number;
  alive: number;
  dead: number;
  stillborn: number;
  totalDeleted: number;
  survivalBuckets: {
    diedBefore3d: number;
    diedBefore7d: number;
    survived7d: number;
    survived30d: number;
  };
  byType: {
    type: string;
    total: number;
    alive: number;
    alivePercent: number;
  }[];
};

/**
 * Метрики по привычкам: живые/мёртвые/мертворождённые, survival buckets, по типам.
 */
export const getHabitHealthMetrics = async (): Promise<HabitHealthMetrics> => {
  const date7dAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
  const date30dAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const habits = await prisma.habit.findMany({
    where: { isActive: true },
    select: {
      id: true,
      frequencyType: true,
      createdAt: true,
      logs: {
        where: { completed: true },
        orderBy: { date: 'desc' as const },
        select: { date: true },
      },
    },
  });

  const totalDeleted = await prisma.habit.count({ where: { isActive: false } });

  let alive = 0;
  let dead = 0;
  let stillborn = 0;
  let diedBefore3d = 0;
  let diedBefore7d = 0;
  let survived7d = 0;
  let survived30d = 0;

  const typeStats = new Map<string, { total: number; alive: number }>();

  for (const habit of habits) {
    const type = habit.frequencyType;
    if (!typeStats.has(type)) typeStats.set(type, { total: 0, alive: 0 });
    const ts = typeStats.get(type)!;
    ts.total++;

    if (habit.logs.length === 0) {
      stillborn++;
      continue;
    }

    const lastCheckin = habit.logs[0]!.date;
    const firstCheckin = habit.logs[habit.logs.length - 1]!.date;
    const isAlive = lastCheckin >= date7dAgo;

    if (isAlive) {
      alive++;
      ts.alive++;
    } else {
      dead++;
    }

    // Survival: сколько дней привычка прожила (от первого до последнего checkin)
    const lifespanDays = differenceInDays(new Date(lastCheckin), new Date(firstCheckin));

    if (!isAlive) {
      if (lifespanDays < 3) diedBefore3d++;
      else if (lifespanDays < 7) diedBefore7d++;
    }

    if (lifespanDays >= 7) survived7d++;
    if (lifespanDays >= 30) survived30d++;
  }

  const byType = Array.from(typeStats.entries()).map(([type, stats]) => ({
    type,
    total: stats.total,
    alive: stats.alive,
    alivePercent: stats.total > 0 ? Math.round((stats.alive / stats.total) * 100) : 0,
  }));

  return {
    totalActive: habits.length,
    alive,
    dead,
    stillborn,
    totalDeleted,
    survivalBuckets: { diedBefore3d, diedBefore7d, survived7d, survived30d },
    byType,
  };
};

/** Эффективность напоминаний по типу */
export type ReminderEffectiveness = {
  type: string;
  sent: number;
  followedByCheckin: number;
  conversionPercent: number;
};

/**
 * Считает конверсию напоминание → checkin по типам.
 * Считает checkin в течение 24 часов после reminder_sent.
 */
export const getReminderEffectiveness = async (): Promise<ReminderEffectiveness[]> => {
  const date30dAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  // Получаем все reminder_sent за последние 30 дней с metadata
  const reminders = await prisma.analyticsEvent.findMany({
    where: {
      type: 'reminder_sent',
      createdAt: { gte: new Date(`${date30dAgo}T00:00:00.000Z`) },
    },
    select: { userId: true, metadata: true, createdAt: true },
  });

  const typeStats = new Map<string, { sent: number; converted: number }>();

  for (const reminder of reminders) {
    const meta = reminder.metadata ? JSON.parse(reminder.metadata) as Record<string, unknown> : {};
    const rType = (meta.type as string) || 'unknown';

    if (!typeStats.has(rType)) typeStats.set(rType, { sent: 0, converted: 0 });
    const stats = typeStats.get(rType)!;
    stats.sent++;

    // Проверяем: был ли checkin от этого юзера в течение 24 часов после напоминания
    const after = reminder.createdAt;
    const deadline = new Date(after.getTime() + 24 * 60 * 60 * 1000);

    const checkin = await prisma.analyticsEvent.findFirst({
      where: {
        userId: reminder.userId,
        type: 'checkin',
        createdAt: { gte: after, lte: deadline },
      },
      select: { id: true },
    });

    if (checkin) stats.converted++;
  }

  return Array.from(typeStats.entries()).map(([type, stats]) => ({
    type,
    sent: stats.sent,
    followedByCheckin: stats.converted,
    conversionPercent: stats.sent > 0 ? Math.round((stats.converted / stats.sent) * 100) : 0,
  }));
};

/** Данные о потере стриков */
export type StreakBreakData = {
  /** Потеряли стрик 3+ дней */
  broke3plus: number;
  /** Из них вернулись (checkin в течение 7 дней после потери) */
  returned3plus: number;
  /** Потеряли стрик 7+ дней */
  broke7plus: number;
  /** Из них вернулись */
  returned7plus: number;
  /** Потеряли стрик 14+ дней */
  broke14plus: number;
  /** Из них вернулись */
  returned14plus: number;
};

/**
 * Анализ потери стриков: сколько юзеров теряли стрики и возвращались ли.
 * Стрик считается потерянным когда юзер пропускает день после N+ дней подряд.
 */
export const getStreakBreaks = async (): Promise<StreakBreakData> => {
  // Получаем все привычки с логами
  const habits = await prisma.habit.findMany({
    where: { isActive: true },
    select: {
      id: true,
      userId: true,
      logs: {
        where: { completed: true },
        orderBy: { date: 'asc' as const },
        select: { date: true },
      },
    },
  });

  let broke3plus = 0, returned3plus = 0;
  let broke7plus = 0, returned7plus = 0;
  let broke14plus = 0, returned14plus = 0;

  for (const habit of habits) {
    if (habit.logs.length < 2) continue;

    const dates = habit.logs.map((l) => l.date);
    let currentStreak = 1;

    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]!);
      const curr = new Date(dates[i]!);
      const gap = differenceInDays(curr, prev);

      if (gap === 1) {
        currentStreak++;
      } else if (gap > 1) {
        // Стрик прервался
        if (currentStreak >= 3) {
          broke3plus++;
          // Вернулся = следующий checkin существует (curr — это возвращение)
          returned3plus++;
        }
        if (currentStreak >= 7) {
          broke7plus++;
          returned7plus++;
        }
        if (currentStreak >= 14) {
          broke14plus++;
          returned14plus++;
        }
        currentStreak = 1;
      }
    }

    // Проверяем последний стрик — если он прервался (нет checkin сегодня/вчера)
    const lastDate = dates[dates.length - 1]!;
    const daysSinceLast = differenceInDays(new Date(), new Date(lastDate));

    if (daysSinceLast > 1 && currentStreak >= 3) {
      broke3plus++;
      // Не вернулся — последний стрик, юзер ушёл
    }
    if (daysSinceLast > 1 && currentStreak >= 7) {
      broke7plus++;
    }
    if (daysSinceLast > 1 && currentStreak >= 14) {
      broke14plus++;
    }
  }

  return { broke3plus, returned3plus, broke7plus, returned7plus, broke14plus, returned14plus };
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
