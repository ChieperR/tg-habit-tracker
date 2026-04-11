import { Bot } from 'grammy';
import { BotContext, HabitWithTodayStatus } from '../../types/index.js';
import { getTodayHabits, getUserHabitsWithTodayStatus } from '../habitService.js';
import { createMainMenuKeyboard, createEveningChecklistKeyboard } from '../../bot/keyboards/index.js';
import { getChangelogBanner } from '../../changelog.js';
import { handleDeliveryError } from './delivery.js';
import { formatScheduleText } from '../../utils/format.js';

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

  let message = '🌅 *Доброе утро!*\n\n';
  message += 'Вот твои привычки на сегодня:\n\n';

  for (const habit of todayHabits) {
    const scheduleText = formatScheduleText(habit);
    message += `• ${habit.emoji} ${habit.name} _(${scheduleText})_\n`;
  }

  message += '\nУдачного дня! 🍀';

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
  const todayHabits = habits.filter((h) => h.isDueToday);

  if (todayHabits.length === 0) {
    return false;
  }

  const allCompleted = todayHabits.every((h) => h.completedToday);

  let message = '🌙 *Время подвести итоги дня!*\n\n';
  if (allCompleted) {
    message += '🎉 Все привычки выполнены! Так держать! 💪\n\n';
  } else {
    message += 'Отметь выполненные привычки:\n\n';
  }
  for (const habit of todayHabits) {
    const status = habit.completedToday ? '✅' : '⬜';
    message += `${status} ${habit.emoji} ${habit.name}\n`;
  }

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
