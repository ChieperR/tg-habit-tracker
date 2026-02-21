/**
 * Обработка ввода часового пояса (геолокация или текст после /start)
 * @module bot/handlers/timezoneInput
 */

import { BotContext } from '../../types/index.js';
import { findOrCreateUser, updateUserSettings } from '../../services/userService.js';
import {
  getTimezoneOffsetFromLocation,
  parseTimezoneFromText,
} from '../../utils/timezoneFromLocation.js';

const removeKeyboard: { remove_keyboard: true } = { remove_keyboard: true };

/**
 * Обрабатывает сообщение, когда бот ждёт от пользователя часовой пояс
 * @param ctx - Контекст бота
 * @returns true если сообщение обработано, false если нужно передать дальше
 */
export const handleTimezoneInput = async (ctx: BotContext): Promise<boolean> => {
  if (!ctx.session.awaitingTimezone) {
    return false;
  }

  const telegramId = ctx.from?.id;
  if (!telegramId) {
    return false;
  }

  const user = await findOrCreateUser(telegramId);
  let offsetMinutes: number | null = null;

  if (ctx.message?.location) {
    const { latitude, longitude } = ctx.message.location;
    offsetMinutes = getTimezoneOffsetFromLocation(latitude, longitude);
  } else if (ctx.message?.text) {
    offsetMinutes = parseTimezoneFromText(ctx.message.text);
  }

  if (offsetMinutes === null) {
    await ctx.reply(
      '❌ Не удалось определить часовой пояс. Отправь геолокацию (кнопка ниже) или введи число от -12 до +14 (например: 3 для Москвы).'
    );
    return true;
  }

  await updateUserSettings(user.id, { timezoneOffset: offsetMinutes });
  ctx.session.awaitingTimezone = false;

  const hours = offsetMinutes / 60;
  const sign = hours >= 0 ? '+' : '';
  await ctx.reply(
    `✅ Часовой пояс установлен: *UTC${sign}${hours}*\n\nТеперь напоминания будут приходить вовремя.`,
    {
      parse_mode: 'Markdown',
      reply_markup: removeKeyboard,
    }
  );
  return true;
};
