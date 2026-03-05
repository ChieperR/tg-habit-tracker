import { BotContext } from '../../types/index.js';
import { ADMIN_TELEGRAM_ID } from '../../config.js';
import { getBotStats } from '../../services/adminService.js';

/**
 * Обработчик команды /admin — статистика бота (только для администратора)
 * @module bot/commands/admin
 */

/**
 * Форматирует статистику бота в читаемое сообщение
 * @param stats - Объект статистики
 * @returns Отформатированная строка для Telegram (Markdown)
 */
const formatAdminMessage = (stats: Awaited<ReturnType<typeof getBotStats>>): string => {
  const emojiLine =
    stats.topEmoji.length > 0
      ? stats.topEmoji.map(([e, c]) => `${e} ×${c}`).join('  ')
      : '_нет данных_';

  return [
    `🤖 *Статистика бота*`,
    ``,
    `👥 *Пользователи*`,
    `• Всего: *${stats.totalUsers}*`,
    `• Активных (7д): *${stats.activeUsers7d}*`,
    `• Активных (30д): *${stats.activeUsers30d}*`,
    ``,
    `📋 *Привычки*`,
    `• Всего: *${stats.totalHabits}* (активных: *${stats.activeHabits}*)`,
    `• Daily: *${stats.dailyHabits}* | Interval: *${stats.intervalHabits}* | Weekdays: *${stats.weekdaysHabits}*`,
    `• С личными напоминаниями: *${stats.habitsWithReminder}*`,
    ``,
    `✅ *Сегодня*`,
    `• Выполнений: *${stats.completionsToday}*`,
    `• Напоминаний отправлено: *${stats.remindersSentToday}*`,
    ``,
    `🏆 *Топ эмодзи*`,
    emojiLine,
  ].join('\n');
};

/**
 * Обработчик команды /admin
 * Доступна только администратору (ADMIN_TELEGRAM_ID)
 * @param ctx - Контекст бота
 */
export const handleAdmin = async (ctx: BotContext): Promise<void> => {
  const fromId = ctx.from?.id;

  if (!fromId || fromId !== ADMIN_TELEGRAM_ID) {
    // Silently ignore — не раскрываем существование команды
    return;
  }

  try {
    const stats = await getBotStats();
    const message = formatAdminMessage(stats);

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[admin] Ошибка получения статистики:', err);
    await ctx.reply('❌ Не удалось получить статистику');
  }
};
