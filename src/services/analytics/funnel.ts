import { format, subDays, differenceInDays, addDays } from 'date-fns';
import { prisma } from '../../db/index.js';

// ── Activation Funnel ──

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
 * /start → создал привычку → первый checkin → checkin на D2-3 → checkin на D7 → активен сейчас
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
    where: { createdAt: { lte: subDays(now, 4) } },
    select: { id: true, createdAt: true },
  });

  // Батч: получаем все checkin даты для eligible юзеров одним запросом
  const allUserIds = allUsers.map((u) => u.id);
  const funnelLogs = allUserIds.length > 0
    ? await prisma.habitLog.findMany({
        where: {
          completed: true,
          habit: { userId: { in: allUserIds } },
        },
        select: { date: true, habit: { select: { userId: true } } },
      })
    : [];

  const funnelUserDates = new Map<number, Set<string>>();
  for (const log of funnelLogs) {
    const uid = log.habit.userId;
    if (!funnelUserDates.has(uid)) funnelUserDates.set(uid, new Set());
    funnelUserDates.get(uid)!.add(log.date);
  }

  let d2Retained = 0;
  let d7Retained = 0;

  for (const user of allUsers) {
    const dates = funnelUserDates.get(user.id);
    if (!dates) continue;

    // D2: checkin в окне [1, 3] дня после регистрации (покрывает interval/weekdays)
    const d2Start = format(addDays(user.createdAt, 1), 'yyyy-MM-dd');
    const d2End = format(addDays(user.createdAt, 3), 'yyyy-MM-dd');
    for (const d of dates) {
      if (d >= d2Start && d <= d2End) {
        d2Retained++;
        break;
      }
    }

    // Шаг 5: checkin на 7й день (окно [6, 8])
    if (differenceInDays(now, user.createdAt) >= 8) {
      const d7Start = format(addDays(user.createdAt, 6), 'yyyy-MM-dd');
      const d7End = format(addDays(user.createdAt, 8), 'yyyy-MM-dd');
      for (const d of dates) {
        if (d >= d7Start && d <= d7End) {
          d7Retained++;
          break;
        }
      }
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
      { name: 'Check-in на D2-3', count: d2Retained, percent: pct(d2Retained) },
      { name: `Check-in на D7 (из ${d7EligibleCount})`, count: d7Retained, percent: d7EligibleCount > 0 ? Math.round((d7Retained / d7EligibleCount) * 100) : 0 },
      { name: 'Активен сейчас', count: activeNowCount, percent: pct(activeNowCount) },
    ],
  };
};

// ── Habit Health ──

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

    // Survival buckets: только для мёртвых привычек, чтобы базы совпадали
    if (!isAlive) {
      const lifespanDays = differenceInDays(new Date(lastCheckin), new Date(firstCheckin));
      if (lifespanDays < 3) diedBefore3d++;
      else if (lifespanDays < 7) diedBefore7d++;
      else survived7d++;

      if (lifespanDays >= 30) survived30d++;
    }
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

// ── Reminder Effectiveness ──

/** Эффективность напоминаний по типу */
export type ReminderEffectiveness = {
  type: string;
  sent: number;
  followedByCheckin: number;
  conversionPercent: number;
};

/**
 * Считает конверсию напоминание → checkin по типам.
 * - morning: информационное — считаем "чекинил ли вообще в этот день"
 * - evening/habit: action-триггер — считаем "чекин в течение 2ч после"
 */
export const getReminderEffectiveness = async (): Promise<ReminderEffectiveness[]> => {
  const date30dAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
  const since = new Date(`${date30dAgo}T00:00:00.000Z`);

  const reminders = await prisma.analyticsEvent.findMany({
    where: { type: 'reminder_sent', createdAt: { gte: since } },
    select: { userId: true, metadata: true, createdAt: true },
  });

  if (reminders.length === 0) return [];

  // Батч: все checkin events за тот же период
  const checkinEvents = await prisma.analyticsEvent.findMany({
    where: { type: 'checkin', createdAt: { gte: since } },
    select: { userId: true, createdAt: true },
  });

  // Для morning: userId+date -> boolean (чекинил ли в этот день)
  const userCheckinDays = new Map<string, true>();
  // Для evening/habit: userId -> отсортированные timestamps
  const userCheckins = new Map<number, number[]>();

  for (const c of checkinEvents) {
    const day = format(c.createdAt, 'yyyy-MM-dd');
    userCheckinDays.set(`${c.userId}:${day}`, true);

    if (!userCheckins.has(c.userId)) userCheckins.set(c.userId, []);
    userCheckins.get(c.userId)!.push(c.createdAt.getTime());
  }
  for (const times of userCheckins.values()) {
    times.sort((a, b) => a - b);
  }

  const typeStats = new Map<string, { sent: number; converted: number }>();

  for (const reminder of reminders) {
    const meta = reminder.metadata ? JSON.parse(reminder.metadata) as Record<string, unknown> : {};
    const rType = (meta.type as string) || 'unknown';

    if (!typeStats.has(rType)) typeStats.set(rType, { sent: 0, converted: 0 });
    const stats = typeStats.get(rType)!;
    stats.sent++;

    if (rType === 'morning') {
      // Morning = информационное: чекинил ли вообще в этот день
      const day = format(reminder.createdAt, 'yyyy-MM-dd');
      if (userCheckinDays.has(`${reminder.userId}:${day}`)) {
        stats.converted++;
      }
    } else {
      // Evening/habit = action-триггер: чекин в течение 2ч
      const after = reminder.createdAt.getTime();
      const deadline = after + 2 * 60 * 60 * 1000;
      const checkins = userCheckins.get(reminder.userId);

      if (checkins) {
        let lo = 0;
        let hi = checkins.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (checkins[mid]! < after) lo = mid + 1;
          else hi = mid;
        }
        if (lo < checkins.length && checkins[lo]! <= deadline) {
          stats.converted++;
        }
      }
    }
  }

  return Array.from(typeStats.entries()).map(([type, stats]) => ({
    type,
    sent: stats.sent,
    followedByCheckin: stats.converted,
    conversionPercent: stats.sent > 0 ? Math.round((stats.converted / stats.sent) * 100) : 0,
  }));
};

// ── Streak Breaks ──

/** Данные о потере стриков (уникальные юзеры) */
export type StreakBreakData = {
  broke3plus: number;
  returned3plus: number;
  broke7plus: number;
  returned7plus: number;
  broke14plus: number;
  returned14plus: number;
};

/**
 * Анализ потери стриков: сколько уникальных юзеров теряли стрики и возвращались ли.
 * Считает по юзерам, а не по привычкам. Берёт худший исход по юзеру.
 */
export const getStreakBreaks = async (): Promise<StreakBreakData> => {
  // Ограничиваем логи 180 днями — глубже смотреть нет смысла для текущих метрик
  const date180dAgo = format(subDays(new Date(), 180), 'yyyy-MM-dd');

  const habits = await prisma.habit.findMany({
    where: { isActive: true },
    select: {
      id: true,
      userId: true,
      frequencyType: true,
      frequencyDays: true,
      weekdays: true,
      logs: {
        where: { completed: true, date: { gte: date180dAgo } },
        orderBy: { date: 'asc' as const },
        select: { date: true },
      },
    },
  });

  // Per-user tracking: userId -> { broke: boolean, returned: boolean } для каждого bucket
  const userBreaks = new Map<number, {
    broke3: boolean; returned3: boolean;
    broke7: boolean; returned7: boolean;
    broke14: boolean; returned14: boolean;
  }>();

  const getOrCreate = (userId: number) => {
    if (!userBreaks.has(userId)) {
      userBreaks.set(userId, {
        broke3: false, returned3: true,
        broke7: false, returned7: true,
        broke14: false, returned14: true,
      });
    }
    return userBreaks.get(userId)!;
  };

  for (const habit of habits) {
    if (habit.logs.length < 2) continue;

    // Максимально допустимый gap для данного типа привычки (всё что больше = break)
    const maxNormalGap = calculateMaxNormalGap(habit);

    const dates = habit.logs.map((l) => l.date);
    let currentStreak = 1;
    const entry = getOrCreate(habit.userId);

    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]!);
      const curr = new Date(dates[i]!);
      const gap = differenceInDays(curr, prev);

      if (gap <= maxNormalGap) {
        currentStreak++;
      } else {
        const returnedWithin7d = gap <= 7;

        if (currentStreak >= 3) {
          entry.broke3 = true;
          if (!returnedWithin7d) entry.returned3 = false;
        }
        if (currentStreak >= 7) {
          entry.broke7 = true;
          if (!returnedWithin7d) entry.returned7 = false;
        }
        if (currentStreak >= 14) {
          entry.broke14 = true;
          if (!returnedWithin7d) entry.returned14 = false;
        }
        currentStreak = 1;
      }
    }

    // Последний стрик — если прервался
    const lastDate = dates[dates.length - 1]!;
    const daysSinceLast = differenceInDays(new Date(), new Date(lastDate));

    if (daysSinceLast > maxNormalGap) {
      if (currentStreak >= 3) { entry.broke3 = true; entry.returned3 = false; }
      if (currentStreak >= 7) { entry.broke7 = true; entry.returned7 = false; }
      if (currentStreak >= 14) { entry.broke14 = true; entry.returned14 = false; }
    }
  }

  // Считаем уникальных юзеров
  let broke3plus = 0, returned3plus = 0;
  let broke7plus = 0, returned7plus = 0;
  let broke14plus = 0, returned14plus = 0;

  for (const entry of userBreaks.values()) {
    if (entry.broke3) { broke3plus++; if (entry.returned3) returned3plus++; }
    if (entry.broke7) { broke7plus++; if (entry.returned7) returned7plus++; }
    if (entry.broke14) { broke14plus++; if (entry.returned14) returned14plus++; }
  }

  return { broke3plus, returned3plus, broke7plus, returned7plus, broke14plus, returned14plus };
};

/**
 * Вычисляет максимально допустимый gap между checkin'ами для типа привычки.
 * Всё что больше этого gap = потеря стрика.
 */
const calculateMaxNormalGap = (habit: {
  frequencyType: string;
  frequencyDays: number;
  weekdays: string | null;
}): number => {
  if (habit.frequencyType === 'weekdays' && habit.weekdays) {
    const days = habit.weekdays.split(',').map(Number).sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < days.length; i++) {
      maxGap = Math.max(maxGap, days[i]! - days[i - 1]!);
    }
    if (days.length > 0) {
      maxGap = Math.max(maxGap, 7 - days[days.length - 1]! + days[0]!);
    }
    return Math.max(maxGap, 1) + 1;
  }

  if (habit.frequencyType === 'interval') {
    return habit.frequencyDays + 1;
  }

  return 1; // daily
};

// ── Bot Blocked ──

/** Счётчик заблокировавших бота */
export type BotBlockedCount = {
  total: number;
  last30d: number;
  last7d: number;
};

/**
 * Считает уникальных юзеров, заблокировавших бота.
 */
export const getBotBlockedCount = async (): Promise<BotBlockedCount> => {
  const now = new Date();
  const date30dAgo = new Date(format(subDays(now, 30), 'yyyy-MM-dd') + 'T00:00:00.000Z');
  const date7dAgo = new Date(format(subDays(now, 7), 'yyyy-MM-dd') + 'T00:00:00.000Z');

  const allBlocked = await prisma.analyticsEvent.findMany({
    where: { type: 'bot_blocked' },
    select: { userId: true, createdAt: true },
  });

  const total = new Set(allBlocked.map((e) => e.userId)).size;
  const last30d = new Set(allBlocked.filter((e) => e.createdAt >= date30dAgo).map((e) => e.userId)).size;
  const last7d = new Set(allBlocked.filter((e) => e.createdAt >= date7dAgo).map((e) => e.userId)).size;

  return { total, last30d, last7d };
};
