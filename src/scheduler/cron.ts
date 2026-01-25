import cron from 'node-cron';
import { Bot } from 'grammy';
import { BotContext } from '../types/index.js';
import { checkAndSendReminders } from '../services/reminderService.js';

/**
 * Планировщик задач для отправки напоминаний
 * @module scheduler/cron
 */

/**
 * Запускает планировщик напоминаний
 * @param bot - Инстанс бота
 * @description Проверяет каждую минуту, нужно ли отправить напоминания
 */
export const startScheduler = (bot: Bot<BotContext>): void => {
  // Проверяем каждую минуту
  cron.schedule('* * * * *', async () => {
    try {
      // Проверяем утренние напоминания
      await checkAndSendReminders(bot, 'morning');
      
      // Проверяем вечерние напоминания
      await checkAndSendReminders(bot, 'evening');
    } catch (error) {
      console.error('Ошибка в планировщике напоминаний:', error);
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
