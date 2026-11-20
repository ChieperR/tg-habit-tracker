import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BotContext } from '../../../types/index.js';
import { handleHabitToggle } from './habitCallbacks.js';

const state = vi.hoisted(() => ({
  habit: null as null | { id: number; userId: number; isActive: boolean; deletedDate: string | null; graduated?: boolean; name: string; emoji: string; timesPerDay?: number },
  toggles: [] as unknown[][],
  answers: [] as string[],
  log: null as null | { count: number; target: number; completed: boolean },
}));

vi.mock('../../../services/userService.js', () => ({
  findOrCreateUser: async () => ({ id: 1, telegramId: 100n, timezoneOffset: 180, freezeEnabled: true }),
}));
vi.mock('../../../services/habitService.js', () => ({
  getHabitById: async () => state.habit,
  // Та же арифметика, что в настоящем markHabit, но лог дня — в state.log.
  markHabit: async (habitId: number, timesPerDay: number, tz: number, date: string | undefined, mode: string) => {
    state.toggles.push([habitId, tz, date, mode]);
    const target = state.log?.target ?? timesPerDay;
    const current = state.log?.count ?? 0;
    const wasCompleted = state.log?.completed ?? false;
    const count = mode === 'add' ? (current >= target ? current : current + 1)
      : mode === 'remove' ? Math.max(current - 1, 0)
      : current >= target ? 0 : current + 1;
    // ^ та же формула, что nextMarkCount; сама она проверена в habitService.test.ts
    const completed = count >= target;
    const changed = count !== current || completed !== wasCompleted;
    state.log = { count, target, completed };
    return { count, target, completed, wasCompleted, previousCount: current, changed };
  },
  deleteHabit: async () => true,
  graduateHabit: async () => true,
  getUserHabitsWithTodayStatus: async () => [],
  getUserHabitsWithDateStatus: async () => [],
  getHabitReminders: async () => [],
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
// Побочные эффекты выполненного дня — без настоящей базы.
vi.mock('../../../db/index.js', () => ({
  prisma: {
    habit: { findMany: async () => [] },
    habitLog: { findMany: async () => [] },
    freezeUsage: { findMany: async () => [] },
  },
}));
vi.mock('../../../services/streak/freezeService.js', () => ({
  tryEarnFreezes: async () => ({ kind: 'none' }),
  refundFreeze: async () => undefined,
}));
vi.mock('../../../services/streak/milestoneDelivery.js', () => ({ detectAndSendMilestones: async () => undefined }));
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
    state.log = { count: 1, target: 1, completed: true };
    await handleHabitToggle(ctx, 6, 'habit_reminder');
    expect(state.answers).toEqual(['✅ Уже отмечено']);
    expect(state.log).toEqual({ count: 1, target: 1, completed: true });
    state.log = null;
  });

  it('«↩️ Отменить» в напоминании снимает отметку', async () => {
    state.habit = { id: 6, userId: 1, isActive: true, deletedDate: null, name: 'Чтение', emoji: '📚' };
    state.log = { count: 1, target: 1, completed: true };
    await handleHabitToggle(ctx, 6, 'habit_reminder_undo');
    expect(state.toggles).toEqual([[6, 180, '2026-01-10', 'remove']]);
    expect(state.log).toEqual({ count: 0, target: 1, completed: false });
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
    expect(state.toggles).toEqual([[6, 180, '2026-01-10', 'add']]);
    state.log = null;
  });
});

describe('handleHabitToggle: несколько раз в день', () => {
  beforeEach(() => {
    state.toggles.length = 0;
    state.answers.length = 0;
    state.log = null;
    state.habit = { id: 8, userId: 1, isActive: true, deletedDate: null, name: 'Таблетки', emoji: '💊', timesPerDay: 2 };
  });

  it('два напоминания: каждое «✅ Выполнено» добавляет отметку, третье ничего не меняет', async () => {
    await handleHabitToggle(ctx, 8, 'habit_reminder');
    await handleHabitToggle(ctx, 8, 'habit_reminder');
    await handleHabitToggle(ctx, 8, 'habit_reminder');
    expect(state.answers).toEqual(['☑️ Отмечено 1/2', '✅ Выполнено!', '✅ Уже отмечено']);
    expect(state.log).toEqual({ count: 2, target: 2, completed: true });
  });

  it('«↩️ Отменить» снимает одну отметку', async () => {
    state.log = { count: 2, target: 2, completed: true };
    await handleHabitToggle(ctx, 8, 'habit_reminder_undo');
    expect(state.answers).toEqual(['↩️ Отменено: 1/2']);
    expect(state.log).toEqual({ count: 1, target: 2, completed: false });
  });

  it('кнопка в списке: 0 → 1 → 2 → сброс в 0', async () => {
    await handleHabitToggle(ctx, 8);
    await handleHabitToggle(ctx, 8);
    await handleHabitToggle(ctx, 8);
    expect(state.answers).toEqual(['☑️ Отмечено 1/2', '✅ Выполнено!', '⬜ Отметки сброшены: 0/2']);
    expect(state.log).toEqual({ count: 0, target: 2, completed: false });
  });

  it('у дня уже свой target: смена числа раз на привычке не меняет, сколько нужно за этот день', async () => {
    state.habit = { ...state.habit!, timesPerDay: 3 };
    state.log = { count: 1, target: 2, completed: false };
    await handleHabitToggle(ctx, 8, undefined, '2026-01-09');
    expect(state.log).toEqual({ count: 2, target: 2, completed: true });
  });
});
