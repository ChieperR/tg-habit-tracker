import { BotContext } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { createSettingsKeyboard } from '../keyboards/index.js';
import { safeEditMessage } from '../../utils/telegram.js';

/**
 * Обработчик команды /settings
 * @param ctx - Контекст бота
 */
export const handleSettings = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  
  if (!telegramId) {
    await ctx.reply('❌ Не удалось определить пользователя');
    return;
  }

  const user = await findOrCreateUser(telegramId);
  ctx.session.dbUserId = user.id;

  const message = formatSettingsMessage(user.timezoneOffset);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: createSettingsKeyboard({
      morningTime: user.morningTime,
      eveningTime: user.eveningTime,
      morningEnabled: user.morningEnabled,
      eveningEnabled: user.eveningEnabled,
      timezoneOffset: user.timezoneOffset,
    }),
  });
};

/**
 * Форматирует сообщение настроек
 */
const formatSettingsMessage = (timezoneOffset: number | null): string => {
  const tzWarning = timezoneOffset === null 
    ? '\n\n⚠️ *Часовой пояс не настроен!* Напоминания не будут работать корректно.' 
    : '';
  
  return `
⚙️ *Настройки*

🔔/🔕 — нажми чтобы включить/выключить
✏️ — нажми чтобы изменить время${tzWarning}
  `.trim();
};

/**
 * Показывает настройки (для callback)
 * @param ctx - Контекст бота
 */
export const showSettings = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  
  if (!telegramId) {
    return;
  }

  const user = await findOrCreateUser(telegramId);
  const message = formatSettingsMessage(user.timezoneOffset);

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createSettingsKeyboard({
      morningTime: user.morningTime,
      eveningTime: user.eveningTime,
      morningEnabled: user.morningEnabled,
      eveningEnabled: user.eveningEnabled,
      timezoneOffset: user.timezoneOffset,
    }),
  });
};
