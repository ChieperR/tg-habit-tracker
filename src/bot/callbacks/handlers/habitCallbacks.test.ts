import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BotContext } from '../../../types/index.js';
import { handleHabitToggle } from './habitCallbacks.js';

const state = vi.hoisted(() => ({
  habit: null as null | { id: number; userId: number; isActive: boolean; deletedDate: string | null; graduated?: boolean; name: string; emoji: string },
  toggles: [] as unknown[][],
  answers: [] as string[],
  log: null as null | { completed: boolean },
  timezoneOffset: 180 as number | null,
  toggleResult: true,
}));

vi.mock('../../../services/userService.js', () => ({
  findOrCreateUser: async () => ({ id: 1, telegramId: 100n, timezoneOffset: state.timezoneOffset, freezeEnabled: true }),
}));
vi.mock('../../../services/habitService.js', () => ({
  getHabitById: async () => state.habit,
  toggleHabitCompletion: async (...args: unknown[]) => {
    state.toggles.push(args);
    return state.toggleResult;
  },
  deleteHabit: async () => true,
  graduateHabit: async () => true,
  getUserHabitsWithTodayStatus: async () => [],
  getUserHabitsWithDateStatus: async () => [],
  getHabitReminders: async () => [],
  getHabitLog: async () => state.log,
  removeHabitReminder: async () => null,
}));
vi.mock('../../../utils/telegram.js', () => ({
  safeAnswerCallback: async (_ctx: unknown, text: string) => {
    state.answers.push(text);
  },
  safeEditMessage: async () => undefined,
  escapeMarkdown: (s: string) => s,
}));
vi.mock('../../../services/analyticsService.js', () => ({ trackEvent: async () => undefined }));
vi.mock('../../commands/habits.js', () => ({ showHabitsList: async () => undefined }));

// Сообщение напоминания, отправленное 10.01 в 12:00 по Москве.
const ctx = {
  from: { id: 100 },
  callbackQuery: { message: { date: Date.UTC(2026, 0, 10, 9, 0) / 1000 } },
  answerCallbackQuery: async () => undefined,
} as unknown as BotContext;

describe('handleHabitToggle: удалённая привычка', () => {
  beforeEach(() => {
    state.toggles.length = 0;
    state.answers.length = 0;
  });

  it('за день до удаления (старое напоминание) — не переключается', async () => {
    state.habit = { id: 5, userId: 1, isActive: false, deletedDate: '2026-01-11', name: 'Бег', emoji: '🏃' };
    await handleHabitToggle(ctx, 5, 'habit_reminder');
    expect(state.toggles).toEqual([]);
    expect(state.answers).toEqual(['🗑 Привычка удалена']);
  });

  it('за прошлый день из списка — не переключается', async () => {
    state.habit = { id: 5, userId: 1, isActive: false, deletedDate: '2026-01-11', name: 'Бег', emoji: '🏃' };
    await handleHabitToggle(ctx, 5, undefined, '2026-01-09');
    expect(state.toggles).toEqual([]);
    expect(state.answers).toEqual(['🗑 Привычка удалена']);
  });

  it('«✅ Выполнено» во втором напоминании за день не снимает уже поставленную отметку', async () => {
    state.habit = { id: 6, userId: 1, isActive: true, deletedDate: null, name: 'Чтение', emoji: '📚' };
    state.log = { completed: true };
    await handleHabitToggle(ctx, 6, 'habit_reminder');
    expect(state.toggles).toEqual([]);
    expect(state.answers).toEqual(['✅ Уже отмечено']);
    state.log = null;
  });

  it('«↩️ Отменить» в напоминании снимает отметку', async () => {
    state.habit = { id: 6, userId: 1, isActive: true, deletedDate: null, name: 'Чтение', emoji: '📚' };
    state.log = { completed: true };
    await handleHabitToggle(ctx, 6, 'habit_reminder_undo');
    expect(state.toggles).toEqual([[6, 180, '2026-01-10']]);
    state.log = null;
  });

  it('внедрённая привычка из старого напоминания — не переключается, ответ про внедрение', async () => {
    state.habit = { id: 7, userId: 1, isActive: false, deletedDate: '2026-01-11', graduated: true, name: 'Бег', emoji: '🏃' };
    await handleHabitToggle(ctx, 7, 'habit_reminder');
    expect(state.toggles).toEqual([]);
    expect(state.answers).toEqual(['🏆 Привычка внедрена']);
  });

  it('активная привычка из старого напоминания отмечается за день сообщения', async () => {
    state.habit = { id: 6, userId: 1, isActive: true, deletedDate: null, name: 'Чтение', emoji: '📚' };
    await handleHabitToggle(ctx, 6, 'habit_reminder');
    expect(state.toggles).toEqual([[6, 180, '2026-01-10']]);
  });
});

describe('handleHabitToggle: часовой пояс не указан', () => {
  beforeEach(() => {
    state.toggles.length = 0;
    state.timezoneOffset = null;
    // Без отметки не запускаются фоновые начисления с настоящей базой.
    state.toggleResult = false;
    state.habit = { id: 6, userId: 1, isActive: true, deletedDate: null, name: 'Чтение', emoji: '📚' };
  });
  afterEach(() => {
    state.timezoneOffset = 180;
    state.toggleResult = true;
    vi.useRealTimers();
  });

  it('отметка из напоминания в 00:30 МСК идёт на день сообщения по Москве', async () => {
    // 11.01 00:30 МСК = 10.01 21:30 UTC
    const night = {
      ...ctx,
      callbackQuery: { message: { date: Date.UTC(2026, 0, 10, 21, 30) / 1000 } },
    } as unknown as BotContext;
    await handleHabitToggle(night, 6, 'habit_reminder');
    expect(state.toggles).toEqual([[6, 180, '2026-01-11']]);
  });

  it('отметка из списка считает «сегодня» по Москве', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 10, 21, 30)));
    await handleHabitToggle(ctx, 6);
    expect(state.toggles).toEqual([[6, 180, undefined]]);
  });
});
