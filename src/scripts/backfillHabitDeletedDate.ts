/**
 * Разовый бэкфилл `Habit.deletedDate` для привычек, удалённых до появления поля.
 *
 * Источник дня удаления по приоритету:
 *  1. первое событие `habit_delete` этой привычки в AnalyticsEvent (повторные —
 *     нажатия старой кнопки) — день в часовом поясе юзера;
 *  2. дата последней отметки привычки;
 *  3. день создания привычки (удалена без единой отметки).
 *
 * Трогает только `isActive = false AND deletedDate IS NULL`, повторный запуск
 * ничего не меняет.
 *
 * Запуск: `tsx src/scripts/backfillHabitDeletedDate.ts [--dry-run]`
 *
 * @module scripts/backfillHabitDeletedDate
 */
import { prisma } from '../db/index.js';
import { DEFAULT_TIMEZONE_OFFSET, formatYMDUtc } from '../utils/date.js';

const localDate = (at: Date, timezoneOffset: number): string =>
  formatYMDUtc(new Date(at.getTime() + timezoneOffset * 60000));

const parseHabitId = (metadata: string | null): number | null => {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (typeof parsed === 'object' && parsed !== null && 'habitId' in parsed) {
      const id = (parsed as { habitId: unknown }).habitId;
      return typeof id === 'number' ? id : null;
    }
  } catch {
    return null;
  }
  return null;
};

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');

  const habits = await prisma.habit.findMany({
    where: { isActive: false, deletedDate: null },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      user: { select: { timezoneOffset: true } },
      logs: {
        where: { completed: true },
        orderBy: { date: 'desc' },
        take: 1,
        select: { date: true },
      },
    },
  });

  const events = await prisma.analyticsEvent.findMany({
    where: { type: 'habit_delete', userId: { in: [...new Set(habits.map((h) => h.userId))] } },
    select: { userId: true, metadata: true, createdAt: true },
  });
  const firstDeleteEvent = new Map<string, Date>();
  for (const e of events) {
    const habitId = parseHabitId(e.metadata);
    if (habitId === null) continue;
    const key = `${e.userId}:${habitId}`;
    const prev = firstDeleteEvent.get(key);
    if (!prev || e.createdAt < prev) firstDeleteEvent.set(key, e.createdAt);
  }

  const bySource = { event: 0, lastLog: 0, createdAt: 0 };
  for (const habit of habits) {
    const timezoneOffset = habit.user.timezoneOffset ?? DEFAULT_TIMEZONE_OFFSET;
    const eventAt = firstDeleteEvent.get(`${habit.userId}:${habit.id}`);
    let deletedDate: string;
    if (eventAt) {
      deletedDate = localDate(eventAt, timezoneOffset);
      bySource.event++;
    } else if (habit.logs[0]) {
      deletedDate = habit.logs[0].date;
      bySource.lastLog++;
    } else {
      deletedDate = localDate(habit.createdAt, timezoneOffset);
      bySource.createdAt++;
    }

    if (!dryRun) {
      await prisma.habit.updateMany({
        where: { id: habit.id, isActive: false, deletedDate: null },
        data: { deletedDate },
      });
    }
  }

  console.log(
    `[backfillHabitDeletedDate] ${dryRun ? 'dry-run, ' : ''}привычек: ${habits.length} ` +
      `(событие удаления: ${bySource.event}, последняя отметка: ${bySource.lastLog}, ` +
      `день создания: ${bySource.createdAt})`
  );
};

main()
  .catch((err) => {
    console.error('[backfillHabitDeletedDate] ошибка:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
