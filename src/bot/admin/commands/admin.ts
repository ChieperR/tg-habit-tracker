import { BotContext } from '../../../types/index.js';
import { getBotStats } from '../../../services/adminService.js';
import { getUserSegments } from '../../../services/analyticsService.js';

/**
 * Обработчик команды /admin — статистика бота. Команда зарегистрирована
 * в админ-боте, доступ ограничен middleware-guard в `bot/admin/index.ts`.
 * @module bot/admin/commands/admin
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
 * Обработчик команды /admin (админ-бот, guard в middleware)
 * @param ctx - Контекст бота
 */
export const handleAdmin = async (ctx: BotContext): Promise<void> => {
  try {
    const [stats, segments] = await Promise.all([getBotStats(), getUserSegments()]);
    let message = formatAdminMessage(stats);

    message += '\n\n🎯 *Сегментация*\n';
    message += `• Power (5+/7д): *${segments.power}*\n`;
    message += `• Active (1-4/7д): *${segments.active}*\n`;
    message += `• Dormant (8-30д): *${segments.dormant}*\n`;
    message += `• Churned (30д+): *${segments.churned}*\n`;
    message += `• Zombie (неактивен + напоминания): *${segments.zombie}*`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[admin] Ошибка получения статистики:', err);
    await ctx.reply('❌ Не удалось получить статистику');
  }
};
