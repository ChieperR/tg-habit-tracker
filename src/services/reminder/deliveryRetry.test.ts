import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GrammyError, HttpError } from 'grammy';
import type { Bot } from 'grammy';
import type { BotContext } from '../../types/index.js';
import { checkAndSendHabitReminders } from './scheduler.js';
import { sendMorningReminder, sendEveningReminder } from './senders.js';

const state = vi.hoisted(() => ({
  updateMany: [] as unknown[],
  events: [] as unknown[],
}));

vi.mock('../../db/index.js', () => ({
  prisma: {
    habitLog: { findFirst: async () => null },
    habitReminder: {
      updateMany: async (args: unknown) => {
        state.updateMany.push(args);
        return { count: 1 };
      },
    },
  },
}));
vi.mock('../habitService.js', () => ({
  getHabitsWithReminders: async () => [
    {
      id: 562,
      userId: 7,
      name: 'Бег',
      emoji: '🏃',
      frequencyType: 'daily',
      frequencyDays: 1,
      weekdays: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      isActive: true,
      deletedDate: null,
      user: { telegramId: 100n, timezoneOffset: 180 },
      // 00:00 уже наступило в любой момент суток.
      reminders: [{ id: 1, time: '00:00', lastSentDate: null }],
    },
  ],
  getHabitLog: async () => null,
  getTodayHabits: async () => [{ id: 1, name: 'Бег', emoji: '🏃' }],
  getUserHabitsWithTodayStatus: async () => [{ id: 1, name: 'Бег', emoji: '🏃', isDueToday: true }],
}));
vi.mock('./textBuilder.js', () => ({
  buildPerHabitReminder: async () => 'текст',
  buildMorningReminder: async () => 'утро',
  buildEveningReminder: async () => 'вечер',
}));
vi.mock('../../changelog.js', () => ({ getChangelogBanner: () => null }));
vi.mock('../analyticsService.js', () => ({
  trackEvent: async (...args: unknown[]) => {
    state.events.push(args);
  },
}));


const networkError = (): HttpError =>
  new HttpError(
    "Network request for 'sendMessage' failed!",
    new Error('getaddrinfo EAI_AGAIN api.telegram.org')
  );
const apiError = (description: string, code = 400): GrammyError =>
  new GrammyError(
    `Call to 'sendMessage' failed! (${code}: ${description})`,
    { ok: false, error_code: code, description },
    'sendMessage',
    {}
  );

const botFailingWith = (error: unknown): Bot<BotContext> =>
  ({ api: { sendMessage: async () => { throw error; } } }) as unknown as Bot<BotContext>;

describe('персональное напоминание: сбой отправки', () => {
  beforeEach(() => {
    state.updateMany.length = 0;
    state.events.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('сетевая ошибка — время не помечается отправленным, следующий тик повторит', async () => {
    await checkAndSendHabitReminders(botFailingWith(networkError()));
    expect(state.updateMany).toEqual([]);
  });

  it('таймаут запроса (grammY кидает обычный Error) — тоже повтор', async () => {
    await checkAndSendHabitReminders(botFailingWith(new Error("Request to 'sendMessage' timed out after 500 seconds")));
    expect(state.updateMany).toEqual([]);
  });

  it('ответ Telegram с ошибкой (400) — время помечается, чтобы не слать каждую минуту', async () => {
    await checkAndSendHabitReminders(botFailingWith(apiError("Bad Request: can't parse entities")));
    expect(state.updateMany).toHaveLength(1);
  });

  it('юзер заблокировал бота — время помечается', async () => {
    await checkAndSendHabitReminders(botFailingWith(apiError('Forbidden: bot was blocked by the user', 403)));
    expect(state.updateMany).toHaveLength(1);
  });

  it('успешная отправка — время помечается', async () => {
    const bot = { api: { sendMessage: async () => ({}) } } as unknown as Bot<BotContext>;
    await checkAndSendHabitReminders(bot);
    expect(state.updateMany).toHaveLength(1);
  });
});

describe('утреннее и вечернее напоминание: сбой отправки', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('сетевая ошибка — false: день не помечается, cron повторит', async () => {
    expect(await sendMorningReminder(botFailingWith(networkError()), 100n, 7, 180)).toBe(false);
    expect(await sendEveningReminder(botFailingWith(networkError()), 100n, 7, 180)).toBe(false);
  });

  it('ответ Telegram с ошибкой — true: день помечается, без повтора каждую минуту', async () => {
    expect(await sendMorningReminder(botFailingWith(apiError("Bad Request: can't parse entities")), 100n, 7, 180)).toBe(true);
    expect(await sendEveningReminder(botFailingWith(apiError('Forbidden: bot was blocked by the user', 403)), 100n, 7, 180)).toBe(true);
  });
});
