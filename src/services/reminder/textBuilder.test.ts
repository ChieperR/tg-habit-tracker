import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HabitWithTodayStatus } from '../../types/index.js';
import { buildEveningReminder, buildMorningReminder } from './textBuilder.js';

const db = vi.hoisted(() => ({
  user: { freezeCount: 0, morningEnabled: true },
  freezeDates: [] as string[],
}));

vi.mock('../../db/index.js', () => ({
  prisma: {
    habit: {
      findMany: async () => [
        {
          id: 1,
          name: 'Бег',
          emoji: '🏃',
          frequencyType: 'daily',
          frequencyDays: 1,
          weekdays: null,
          createdAt: new Date('2026-11-01T00:00:00Z'),
          isActive: true,
          deletedDate: null,
        },
      ],
    },
    habitLog: { findMany: async () => [] },
    freezeUsage: { findMany: async () => db.freezeDates.map((date) => ({ date })) },
    // Отдаём только выбранные поля, как Prisma.
    user: {
      findUnique: async ({ select }: { select: Record<string, boolean> }) =>
        Object.fromEntries(Object.entries(db.user).filter(([key]) => select[key])),
    },
  },
}));

const todayHabits: HabitWithTodayStatus[] = [
  {
    id: 1,
    name: 'Бег',
    emoji: '🏃',
    frequencyType: 'daily',
    frequencyDays: 1,
    weekdays: null,
    completedToday: false,
    isDueToday: true,
    reminderTimes: [],
  },
];

const MSK = 180;
const FREEZE_LINE = '🧊';

describe('строка о вчерашней заморозке', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 28.11 01:30 МСК (в UTC ещё 27.11), вчера (27.11) закрыто заморозкой
    vi.setSystemTime(new Date('2026-11-27T22:30:00Z'));
    db.freezeDates = ['2026-11-27'];
    db.user = { freezeCount: 0, morningEnabled: true };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [0, 'заморозок больше нет'],
    [1, 'осталась всего одна заморозка'],
  ])('утро выключено, осталось %i → в вечернем «%s»', async (freezeCount, suffix) => {
    db.user = { freezeCount, morningEnabled: false };
    const text = await buildEveningReminder(1, MSK, todayHabits);
    expect(text).toContain(FREEZE_LINE);
    expect(text).toContain(suffix);
  });

  it('утро включено → в вечернем нет, в утреннем есть', async () => {
    const evening = await buildEveningReminder(1, MSK, todayHabits);
    expect(evening).not.toContain(FREEZE_LINE);
    const morning = await buildMorningReminder(1, MSK, todayHabits, () => 'каждый день');
    expect(morning).toContain(FREEZE_LINE);
  });

  it('вчера без заморозки → нет ни утром, ни вечером', async () => {
    db.freezeDates = [];
    db.user = { freezeCount: 0, morningEnabled: false };
    expect(await buildEveningReminder(1, MSK, todayHabits)).not.toContain(FREEZE_LINE);
    expect(await buildMorningReminder(1, MSK, todayHabits, () => 'каждый день')).not.toContain(FREEZE_LINE);
  });

  it('сегодня начислена новая и их снова две → строки нет ни утром, ни вечером', async () => {
    db.user = { freezeCount: 2, morningEnabled: false };
    expect(await buildEveningReminder(1, MSK, todayHabits)).not.toContain(FREEZE_LINE);
    expect(await buildMorningReminder(1, MSK, todayHabits, () => 'каждый день')).not.toContain(FREEZE_LINE);
  });
});
