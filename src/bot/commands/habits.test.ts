import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BotContext } from '../../types/index.js';
import { handleHabits, showHabitsList } from './habits.js';

const state = vi.hoisted(() => ({
  habitsTz: [] as unknown[],
  keyboardDates: [] as unknown[][],
}));

vi.mock('../../services/userService.js', () => ({
  findOrCreateUser: async () => ({ id: 1, telegramId: 100n, timezoneOffset: null, lastSeenChangelog: 0 }),
}));
vi.mock('../../services/habitService.js', () => ({
  getUserHabitsWithTodayStatus: async (_userId: number, tz: number) => {
    state.habitsTz.push(tz);
    return [{ id: 6, name: 'Чтение', emoji: '📚', completedToday: false, isDueToday: true, reminderTimes: [] }];
  },
  getUserHabitsWithDateStatus: async () => [],
}));
vi.mock('../keyboards/index.js', () => ({
  createHabitsListKeyboard: (_habits: unknown, viewDate: string, todayDate: string) => {
    state.keyboardDates.push([viewDate, todayDate]);
    return {};
  },
  createMainMenuKeyboard: () => ({}),
}));
vi.mock('../../utils/telegram.js', () => ({
  safeEditMessage: async () => undefined,
  escapeMarkdown: (s: string) => s,
}));
vi.mock('../../changelog.js', () => ({ getChangelogBanner: () => null }));
vi.mock('../../services/analyticsService.js', () => ({ trackEvent: async () => undefined }));

const ctx = {
  from: { id: 100 },
  session: {},
  reply: async () => undefined,
} as unknown as BotContext;

describe('список привычек: часовой пояс не указан', () => {
  beforeEach(() => {
    state.habitsTz.length = 0;
    state.keyboardDates.length = 0;
    vi.useFakeTimers();
    // 11.01 00:30 МСК = 10.01 21:30 UTC
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 10, 21, 30)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['/habits', handleHabits],
    ['список из кнопки', showHabitsList],
  ])('%s показывает сегодня по Москве', async (_name, show) => {
    await show(ctx);
    expect(state.habitsTz).toEqual([180]);
    expect(state.keyboardDates).toEqual([['2026-01-11', '2026-01-11']]);
  });
});
