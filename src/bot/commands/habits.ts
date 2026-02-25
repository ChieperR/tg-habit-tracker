import { BotContext, HabitWithTodayStatus } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { getUserHabitsWithTodayStatus, getUserHabitsWithDateStatus } from '../../services/habitService.js';
import { createHabitsListKeyboard, createMainMenuKeyboard } from '../keyboards/index.js';
import { safeEditMessage } from '../../utils/telegram.js';
import { getTodayDate, formatDayHeader } from '../../utils/date.js';

/**
 * Собирает текст сообщения со списком привычек
 * @param habits - Привычки со статусом
 * @param dateLabel - Форматированная метка дня для заголовка
 * @param isToday - Просматривается ли сегодняшний день
 * @returns Текст сообщения в Markdown
 */
const buildHabitsMessage = (
  habits: HabitWithTodayStatus[],
  dateLabel: string,
  isToday: boolean
): string => {
  let message = `📝 *Мои привычки — ${dateLabel}*\n\n`;

  if (isToday) {
    message += '💤 — не нужно выполнять сегодня\n';
  } else {
    message += '💤 — не нужно было выполнять\n';
  }
  message += '✅ — выполнено | ⬜ — не выполнено\n\n';

  if (habits.length > 0) {
    for (const habit of habits) {
      const status = habit.completedToday ? '✅' : '⬜';
      const dueIndicator = habit.isDueToday ? '' : ' 💤';
      message += `${status} ${habit.emoji} ${habit.name}${dueIndicator}\n`;
    }
    message += '\n';
  }

  message += 'Нажми на кнопку, чтобы отметить выполнение:';
  return message;
};

/**
 * Обработчик команды /habits — всегда показывает сегодня
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

  const timezoneOffset = user.timezoneOffset ?? 0;
  const todayDate = getTodayDate(timezoneOffset);
  const habits = await getUserHabitsWithTodayStatus(user.id, timezoneOffset);

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

  const dateLabel = formatDayHeader(todayDate, todayDate);
  const message = buildHabitsMessage(habits, dateLabel, true);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: createHabitsListKeyboard(habits, todayDate, todayDate),
  });
};

/**
 * Показывает список привычек (для callback). Поддерживает просмотр за любую дату.
 * @param ctx - Контекст бота
 * @param date - Дата в формате YYYY-MM-DD; если не передана — показывает сегодня
 */
export const showHabitsList = async (ctx: BotContext, date?: string): Promise<void> => {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    return;
  }

  const user = await findOrCreateUser(telegramId);
  const timezoneOffset = user.timezoneOffset ?? 0;
  const todayDate = getTodayDate(timezoneOffset);
  const viewDate = date ?? todayDate;
  const isToday = viewDate === todayDate;

  const habits = isToday
    ? await getUserHabitsWithTodayStatus(user.id, timezoneOffset)
    : await getUserHabitsWithDateStatus(user.id, viewDate);

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

  const dateLabel = formatDayHeader(viewDate, todayDate);
  const message = buildHabitsMessage(habits, dateLabel, isToday);

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createHabitsListKeyboard(habits, viewDate, todayDate),
  });
};
