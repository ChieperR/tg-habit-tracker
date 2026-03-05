import cron from 'node-cron';
import { Bot } from 'grammy';
import { BotContext } from '../types/index.js';
import { checkAndSendReminders, checkAndSendHabitReminders } from '../services/reminderService.js';

/**
 * Планировщик задач для отправки напоминаний
 * @module scheduler/cron
 */

let isRunning = false;

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

  console.log('⏰ Планировщик напоминаний запущен');
};

/**
 * Останавливает все запланированные задачи
 */
export const stopScheduler = (): void => {
  cron.getTasks().forEach((task) => task.stop());
  console.log('⏰ Планировщик остановлен');
};
