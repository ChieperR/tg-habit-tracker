import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BotContext } from '../../../types/index.js';
import { handleHabitToggle } from './habitCallbacks.js';

const state = vi.hoisted(() => ({
  habit: null as null | { id: number; userId: number; isActive: boolean; deletedDate: string | null; graduated?: boolean; name: string; emoji: string },
  toggles: [] as unknown[][],
  answers: [] as string[],
  log: null as null | { completed: boolean },
}));

vi.mock('../../../services/userService.js', () => ({
  findOrCreateUser: async () => ({ id: 1, telegramId: 100n, timezoneOffset: 180, freezeEnabled: true }),
}));
vi.mock('../../../services/habitService.js', () => ({
  getHabitById: async () => state.habit,
  toggleHabitCompletion: async (...args: unknown[]) => {
    state.toggles.push(args);
    return true;
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
