import { BotContext } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { getUserHabitsWithTodayStatus } from '../../services/habitService.js';
import { createHabitsListKeyboard, createMainMenuKeyboard } from '../keyboards/index.js';
import { safeEditMessage } from '../../utils/telegram.js';

/**
 * Обработчик команды /habits
 * @param ctx - Контекст бота
 */
export const handleHabits = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  
  if (!telegramId) {
    await ctx.reply('❌ Не удалось определить пользователя');
    return;
  }

  const user = await findOrCreateUser(telegramId);
  ctx.session.dbUserId = user.id;

  const habits = await getUserHabitsWithTodayStatus(user.id, user.timezoneOffset ?? 0);

  if (habits.length === 0) {
    await ctx.reply(
      '📝 *Мои привычки*\n\nУ тебя пока нет привычек.\nДобавь первую! ✨',
      {
        parse_mode: 'Markdown',
        reply_markup: createMainMenuKeyboard(),
      }
    );
    return;
  }

  let message = '📝 *Мои привычки*\n\n';
  message += '💤 — не нужно выполнять сегодня\n';
  message += '✅ — выполнено | ⬜ — не выполнено\n\n';
  message += 'Нажми на привычку, чтобы отметить выполнение:';

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: createHabitsListKeyboard(habits),
  });
};

/**
 * Показывает список привычек (для callback)
 * @param ctx - Контекст бота
 */
export const showHabitsList = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  
  if (!telegramId) {
    return;
  }

  const user = await findOrCreateUser(telegramId);
  const habits = await getUserHabitsWithTodayStatus(user.id, user.timezoneOffset ?? 0);

  if (habits.length === 0) {
    await safeEditMessage(
      ctx,
      '📝 *Мои привычки*\n\nУ тебя пока нет привычек.\nДобавь первую! ✨',
      {
        parse_mode: 'Markdown',
        reply_markup: createMainMenuKeyboard(),
      }
    );
    return;
  }

  let message = '📝 *Мои привычки*\n\n';
  message += '💤 — не нужно выполнять сегодня\n';
  message += '✅ — выполнено | ⬜ — не выполнено\n\n';
  message += 'Нажми на привычку, чтобы отметить выполнение:';

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createHabitsListKeyboard(habits),
  });
};
