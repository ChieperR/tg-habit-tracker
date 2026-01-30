/**
 * Обработчики интерактивной недельной статистики
 * @module bot/commands/weekly
 */

import { BotContext } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { getWeeklyData } from '../../services/weeklyService.js';
import { getWeekStartMonday } from '../../utils/date.js';
import { createWeeklyKeyboard } from '../keyboards/index.js';
import { safeEditMessage } from '../../utils/telegram.js';
import { addDays, parse, format } from 'date-fns';

/**
 * Показывает недельную статистику (для команды или callback)
 * @param ctx - Контекст бота
 * @param weekStartMonday - Понедельник недели (YYYY-MM-DD); если не передан — текущая неделя
 */
export const showWeekly = async (
  ctx: BotContext,
  weekStartMonday?: string
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const timezoneOffset = user.timezoneOffset ?? 180;
  const weekStart =
    weekStartMonday ?? getWeekStartMonday(timezoneOffset, 0);

  const { text } = await getWeeklyData(user.id, weekStart, timezoneOffset);
  const keyboard = createWeeklyKeyboard(weekStart);
  const options = { parse_mode: 'Markdown' as const, reply_markup: keyboard };

  try {
    await safeEditMessage(ctx, text, options);
  } catch (err) {
    const cannotEdit =
      err instanceof Error &&
      (err.message.includes("can't be edited") || err.message.includes('message to edit not found'));
    if (cannotEdit && ctx.chat?.id && ctx.msg?.message_id) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.msg.message_id);
      await ctx.reply(text, options);
    } else {
      throw err;
    }
  }
};

/**
 * Возвращает понедельник предыдущей недели относительно переданной даты
 * @param weekStartMonday - Понедельник текущей недели (YYYY-MM-DD)
 * @returns Понедельник предыдущей недели (YYYY-MM-DD)
 */
export const getPrevWeekStart = (weekStartMonday: string): string => {
  const monday = parse(weekStartMonday, 'yyyy-MM-dd', new Date());
  return format(addDays(monday, -7), 'yyyy-MM-dd');
};

/**
 * Возвращает понедельник следующей недели относительно переданной даты
 * @param weekStartMonday - Понедельник текущей недели (YYYY-MM-DD)
 * @returns Понедельник следующей недели (YYYY-MM-DD)
 */
export const getNextWeekStart = (weekStartMonday: string): string => {
  const monday = parse(weekStartMonday, 'yyyy-MM-dd', new Date());
  return format(addDays(monday, 7), 'yyyy-MM-dd');
};
