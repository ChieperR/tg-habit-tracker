import { Bot } from 'grammy';
import { BotContext, HabitWithTodayStatus } from '../../types/index.js';
import { getTodayHabits, getUserHabitsWithTodayStatus } from '../habitService.js';
import { createMainMenuKeyboard, createEveningChecklistKeyboard } from '../../bot/keyboards/index.js';
import { getChangelogBanner } from '../../changelog.js';
import { handleDeliveryError, isNetworkError } from './delivery.js';
import { formatScheduleText } from '../../utils/format.js';
import { buildMorningReminder, buildEveningReminder } from './textBuilder.js';

/**
 * Логирует сбой отправки и решает, считать ли напоминание отправленным.
 * Сетевая ошибка — нет (false): cron повторит на следующем тике. Ответ
 * Telegram с ошибкой (блок, 400 и т.п.) — да (true): повтор каждую минуту
 * ничего не изменит, lastReminderDate обновится.
 */
const reportDeliveryFailure = (
  error: unknown,
  telegramId: bigint,
  userId: number,
  kind: 'утреннего' | 'вечернего'
): boolean => {
  if (isNetworkError(error)) {
    console.warn(`[reminder] Сеть недоступна, отправку ${kind} для ${telegramId} повторю на следующем тике: ${(error as Error).message}`);
    return false;
  }
  const handled = handleDeliveryError(error, telegramId, userId);
  if (!handled) {
    console.error(`[reminder] Ошибка отправки ${kind} для ${telegramId}:`, error);
  }
  return true;
};

/**
 * Отправляет утреннее напоминание пользователю
 * @returns true если отправлено или Telegram ответил ошибкой, false при сетевой ошибке (повтор на следующем тике)
 */
export const sendMorningReminder = async (
  bot: Bot<BotContext>,
  telegramId: bigint,
  userId: number,
  timezoneOffset: number,
  lastSeenChangelog: number = 0
): Promise<boolean> => {
  const todayHabits = await getTodayHabits(userId, timezoneOffset);

  if (todayHabits.length === 0) {
    return false;
  }

  let message = await buildMorningReminder(userId, timezoneOffset, todayHabits, (habit) =>
    formatScheduleText(habit)
  );

  const banner = getChangelogBanner({ lastSeenChangelog }, timezoneOffset);
  if (banner) {
    message += banner;
  }

  try {
    await bot.api.sendMessage(telegramId.toString(), message, {
      parse_mode: 'Markdown',
      reply_markup: createMainMenuKeyboard(),
    });
    return true;
  } catch (error) {
    return reportDeliveryFailure(error, telegramId, userId, 'утреннего');
  }
};

/**
 * Отправляет вечернее напоминание пользователю
 * @returns true если отправлено или Telegram ответил ошибкой, false при сетевой ошибке (повтор на следующем тике)
 */
export const sendEveningReminder = async (
  bot: Bot<BotContext>,
  telegramId: bigint,
  userId: number,
  timezoneOffset: number,
  lastSeenChangelog: number = 0
): Promise<boolean> => {
  const habits = await getUserHabitsWithTodayStatus(userId, timezoneOffset);
  const todayHabits: HabitWithTodayStatus[] = habits.filter((h) => h.isDueToday);

  if (todayHabits.length === 0) {
    return false;
  }

  let message = await buildEveningReminder(userId, timezoneOffset, todayHabits);

  const banner = getChangelogBanner({ lastSeenChangelog }, timezoneOffset);
  if (banner) {
    message += banner;
  }

  try {
    await bot.api.sendMessage(telegramId.toString(), message, {
      parse_mode: 'Markdown',
      reply_markup: createEveningChecklistKeyboard(todayHabits),
    });
    return true;
  } catch (error) {
    return reportDeliveryFailure(error, telegramId, userId, 'вечернего');
  }
};
