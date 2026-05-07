import { Bot } from 'grammy';
import { BotContext } from './types/index.js';
import { createBot, setCommands } from './bot/index.js';
import { createAdminBot, setAdminCommands } from './bot/admin/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { startScheduler, stopScheduler } from './scheduler/cron.js';
import { initFeedbackBots } from './services/feedbackTransport.js';

/**
 * Чистит webhook и pending updates у бота. Транзиентные ошибки TG (502,
 * timeout, rate-limit) НЕ должны валить старт — в худшем случае получим
 * 30-60 сек лаг как было раньше, но процесс стартанёт.
 */
const safeDeleteWebhook = async (b: Bot<BotContext>, name: string): Promise<void> => {
  try {
    await b.api.deleteWebhook({ drop_pending_updates: true });
  } catch (e) {
    console.warn(`⚠️ ${name}: deleteWebhook не удался, продолжаем:`, e);
  }
};

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

  // Опциональный админ-бот для уведомлений о фидбэке. Если ADMIN_BOT_TOKEN
  // не задан — основной бот работает как раньше, /feedback всё равно
  // принимает сообщения и сохраняет их в БД, просто без push'а админу.
  const adminToken = process.env.ADMIN_BOT_TOKEN;
  const adminChatIdRaw = process.env.ADMIN_CHAT_ID;
  const adminChatId = adminChatIdRaw ? parseInt(adminChatIdRaw, 10) : NaN;
  const adminBot =
    adminToken && Number.isFinite(adminChatId) && adminChatId > 0
      ? createAdminBot(adminToken, adminChatId)
      : null;

  if (adminBot) {
    await setAdminCommands(adminBot);
    console.log('🔐 Админ-бот сконфигурен, команды установлены');
  } else {
    console.warn(
      '⚠️ ADMIN_BOT_TOKEN или ADMIN_CHAT_ID не заданы — фидбэк будет ' +
        'сохраняться в БД, но не отправляться админу'
    );
  }

  initFeedbackBots(bot, adminBot, Number.isFinite(adminChatId) ? adminChatId : null);

  // Чистим webhook + накопленные updates перед стартом polling. Если
  // предыдущий процесс упал/был убит, у Telegram остаётся stale getUpdates
  // сессия — без deleteWebhook новый процесс получит updates только через
  // 30-60 секунд. drop_pending_updates=true дополнительно отбрасывает
  // накопившуюся очередь. Параллельно для двух ботов, ошибки гасим.
  await Promise.all([
    safeDeleteWebhook(bot, 'основной бот'),
    ...(adminBot ? [safeDeleteWebhook(adminBot, 'админ-бот')] : []),
  ]);

  // Запускаем планировщик напоминаний
  startScheduler(bot);

  // Обработка graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n📴 Получен сигнал ${signal}, завершение работы...`);

    stopScheduler();
    bot.stop();
    if (adminBot) adminBot.stop();
    await closeDatabase();

    console.log('👋 Бот остановлен');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Запускаем бота
  console.log('✅ Бот запущен и готов к работе!');
  console.log('   Нажми Ctrl+C для остановки\n');

  // Запускаем оба бота параллельно. Падение админ-бота НЕ должно ронять
  // основной — фидбэк всё равно сохраняется в БД, юзер-фейс продолжает
  // работать, админ-нотификации временно теряются (как при пустом токене).
  await Promise.all([
    bot.start(),
    ...(adminBot
      ? [adminBot.start().catch((e) => console.error('💥 Админ-бот упал:', e))]
      : []),
  ]);
};

// Запуск
main().catch((error) => {
  console.error('💥 Критическая ошибка:', error);
  process.exit(1);
});
