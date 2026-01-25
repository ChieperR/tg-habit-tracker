import { BotContext } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { getUserStats, formatStatsMessage } from '../../services/statsService.js';
import { createStatsKeyboard } from '../keyboards/index.js';

/**
 * Обработчик команды /stats
 * @param ctx - Контекст бота
 */
export const handleStats = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  
  if (!telegramId) {
    await ctx.reply('❌ Не удалось определить пользователя');
    return;
  }

  const user = await findOrCreateUser(telegramId);
  ctx.session.dbUserId = user.id;

  const stats = await getUserStats(user.id, user.timezoneOffset);
  const message = formatStatsMessage(stats);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: createStatsKeyboard(),
  });
};

/**
 * Показывает статистику (для callback)
 * @param ctx - Контекст бота
 */
export const showStats = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  
  if (!telegramId) {
    return;
  }

  const user = await findOrCreateUser(telegramId);
  const stats = await getUserStats(user.id, user.timezoneOffset);
  const message = formatStatsMessage(stats);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: createStatsKeyboard(),
  });
};
