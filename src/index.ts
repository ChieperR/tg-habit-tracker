import { createBot, setCommands } from './bot/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { startScheduler, stopScheduler } from './scheduler/cron.js';

/**
 * Точка входа приложения
 * @module index
 */

/**
 * Главная функция запуска бота
 */
const main = async (): Promise<void> => {
  // Проверяем наличие токена
  const token = process.env.BOT_TOKEN;

  if (!token) {
    console.error('❌ Ошибка: BOT_TOKEN не задан в переменных окружения');
    console.error('   Создайте файл .env и добавьте BOT_TOKEN=ваш_токен');
    process.exit(1);
  }

  console.log('🚀 Запуск бота...');

  // Инициализируем базу данных
  await initDatabase();

  // Создаём бота
  const bot = createBot(token);

  // Устанавливаем команды в меню
  await setCommands(bot);
  console.log('📋 Команды бота установлены');

  // Запускаем планировщик напоминаний
  startScheduler(bot);

  // Обработка graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n📴 Получен сигнал ${signal}, завершение работы...`);
    
    stopScheduler();
    bot.stop();
    await closeDatabase();
    
    console.log('👋 Бот остановлен');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Запускаем бота
  console.log('✅ Бот запущен и готов к работе!');
  console.log('   Нажми Ctrl+C для остановки\n');
  
  await bot.start();
};

// Запуск
main().catch((error) => {
  console.error('💥 Критическая ошибка:', error);
  process.exit(1);
});
