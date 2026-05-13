import { Bot } from 'grammy';
import { BotContext, HabitWithTodayStatus } from '../../types/index.js';
import { getTodayHabits, getUserHabitsWithTodayStatus } from '../habitService.js';
import { createMainMenuKeyboard, createEveningChecklistKeyboard } from '../../bot/keyboards/index.js';
import { getChangelogBanner } from '../../changelog.js';
import { handleDeliveryError } from './delivery.js';
import { formatScheduleText } from '../../utils/format.js';
import { buildMorningReminder, buildEveningReminder } from './textBuilder.js';

/**
 * Отправляет утреннее напоминание пользователю
 * @returns true если отправлено или ошибка обработана (blocked), false при неизвестной ошибке
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
    const handled = handleDeliveryError(error, telegramId, userId);
    if (!handled) {
      console.error(`[reminder] Ошибка отправки утреннего для ${telegramId}:`, error);
    }
    // Если юзер заблокировал — возвращаем true чтобы lastReminderDate обновился
    // и cron не повторял отправку каждую минуту
    return handled;
  }
};

/**
 * Отправляет вечернее напоминание пользователю
 * @returns true если отправлено или ошибка обработана (blocked), false при неизвестной ошибке
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
    const handled = handleDeliveryError(error, telegramId, userId);
    if (!handled) {
      console.error(`[reminder] Ошибка отправки вечернего для ${telegramId}:`, error);
    }
    // Если юзер заблокировал — возвращаем true чтобы lastReminderDate обновился
    return handled;
  }
};
