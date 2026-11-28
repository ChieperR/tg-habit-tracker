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
    habitLog: { findMany: async () => [{ habitId: 1, date: '2026-11-26', completed: true }] },
    freezeUsage: { findMany: async () => db.freezeDates.map((date) => ({ date })) },
    user: { findUnique: async () => db.user },
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
    // 28.11 18:00 МСК, вчера (27.11) закрыто заморозкой
    vi.setSystemTime(new Date('2026-11-28T15:00:00Z'));
    db.freezeDates = ['2026-11-27'];
    db.user = { freezeCount: 0, morningEnabled: true };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('утро выключено → в вечернем есть, с остатком заморозок', async () => {
    db.user = { freezeCount: 0, morningEnabled: false };
    const text = await buildEveningReminder(1, MSK, todayHabits);
    expect(text).toContain(FREEZE_LINE);
    expect(text).toContain('заморозок больше нет');
  });

  it('утро выключено, осталась одна → «осталась всего одна заморозка»', async () => {
    db.user = { freezeCount: 1, morningEnabled: false };
    const text = await buildEveningReminder(1, MSK, todayHabits);
    expect(text).toContain('осталась всего одна заморозка');
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

  it('сегодня начислена новая и их снова две → строки нет', async () => {
    db.user = { freezeCount: 2, morningEnabled: false };
    expect(await buildEveningReminder(1, MSK, todayHabits)).not.toContain(FREEZE_LINE);
  });
});
