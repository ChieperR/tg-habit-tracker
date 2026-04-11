import { format, subDays, addDays } from 'date-fns';
import { prisma } from '../../db/index.js';

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

  // Вычисляем окна для каждого юзера и общий диапазон дат
  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';
  const userWindows = new Map<number, { start: string; end: string }>();

  for (const user of users) {
    const start = format(addDays(user.createdAt, day - 1), 'yyyy-MM-dd');
    const end = format(addDays(user.createdAt, day + 1), 'yyyy-MM-dd');
    userWindows.set(user.id, { start, end });
    if (start < minDate) minDate = start;
    if (end > maxDate) maxDate = end;
  }

  // Один запрос: все completed логи в общем диапазоне дат для всех юзеров
  const logs = await prisma.habitLog.findMany({
    where: {
      completed: true,
      date: { gte: minDate, lte: maxDate },
      habit: { userId: { in: users.map((u) => u.id) } },
    },
    select: { date: true, habit: { select: { userId: true } } },
  });

  // userId -> Set<date>
  const userDates = new Map<number, Set<string>>();
  for (const log of logs) {
    const uid = log.habit.userId;
    if (!userDates.has(uid)) userDates.set(uid, new Set());
    userDates.get(uid)!.add(log.date);
  }

  let retained = 0;
  for (const user of users) {
    const window = userWindows.get(user.id)!;
    const dates = userDates.get(user.id);
    if (!dates) continue;

    for (const d of dates) {
      if (d >= window.start && d <= window.end) {
        retained++;
        break;
      }
    }
  }

  return {
    total: users.length,
    retained,
    percent: users.length > 0 ? Math.round((retained / users.length) * 100) : 0,
  };
};
