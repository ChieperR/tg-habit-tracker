import cron from 'node-cron';
import { Bot } from 'grammy';
import { BotContext } from '../types/index.js';
import { checkAndSendReminders, checkAndSendHabitReminders } from '../services/reminderService.js';
import { takeDailySnapshot, getDailyReport } from '../services/analyticsService.js';
import { ADMIN_TELEGRAM_ID } from '../config.js';

/**
 * Планировщик задач для отправки напоминаний и аналитики
 * @module scheduler/cron
 */

let isRunning = false;

/**
 * Форматирует ежедневный отчёт для отправки администратору
 */
const formatDailyReportMessage = (report: Awaited<ReturnType<typeof getDailyReport>>): string => {
  return [
    `📅 *Ежедневный отчёт* — ${report.date}`,
    ``,
    `• DAU: *${report.dau}*`,
    `• Новых юзеров: *${report.newUsers}*`,
    `• Всего юзеров: *${report.totalUsers}*`,
    `• Check-in'ов: *${report.totalCheckins}*`,
    `• D7 Retention: *${report.retentionD7}%*`,
  ].join('\n');
};

/**
 * Запускает планировщик напоминаний
 * @param bot - Инстанс бота
 * @description Проверяет каждую минуту, нужно ли отправить напоминания.
 * Mutex-флаг предотвращает параллельный запуск при длительной обработке.
 */
export const startScheduler = (bot: Bot<BotContext>): void => {
  cron.schedule('* * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      await checkAndSendReminders(bot, 'morning');
      await checkAndSendReminders(bot, 'evening');
      await checkAndSendHabitReminders(bot);
    } catch (error) {
      console.error('Ошибка в планировщике напоминаний:', error);
    } finally {
      isRunning = false;
    }
  });

  // Ежедневный снапшот аналитики в 00:05 UTC
  cron.schedule('5 0 * * *', async () => {
    try {
      await takeDailySnapshot();
      const report = await getDailyReport();
      const message = formatDailyReportMessage(report);
      await bot.api.sendMessage(ADMIN_TELEGRAM_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('[analytics] Ошибка ежедневного снапшота:', error);
    }
  });

  console.log('⏰ Планировщик напоминаний запущен');
};

/**
 * Останавливает все запланированные задачи
 */
export const stopScheduler = (): void => {
  cron.getTasks().forEach((task) => task.stop());
  console.log('⏰ Планировщик остановлен');
};
