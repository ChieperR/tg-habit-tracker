import { format, subDays } from 'date-fns';
import { prisma } from '../../db/index.js';

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
          reminderTime: true,
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

  // Получаем per-user checkin count за 7 дней
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
    const hasHabitReminders = user.habits.some((h) => h.reminderTime !== null);
    const remindersEnabled = user.morningEnabled || user.eveningEnabled || hasHabitReminders;

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
