import { BotContext } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { createMainMenuKeyboard } from '../keyboards/index.js';

/**
 * Обработчик команды /start
 * @param ctx - Контекст бота
 */
export const handleStart = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  
  if (!telegramId) {
    await ctx.reply('❌ Не удалось определить пользователя');
    return;
  }

  // Создаём или находим пользователя
  const user = await findOrCreateUser(telegramId);
  ctx.session.dbUserId = user.id;

  const welcomeMessage = `
🎯 *Привет! Я — твой трекер привычек*

Я помогу тебе:
• 📝 Отслеживать привычки
• ⏰ Напоминать о них утром и вечером
• 📊 Следить за прогрессом

*Как это работает:*
1️⃣ Добавь привычки, которые хочешь отслеживать
2️⃣ Утром я пришлю список на сегодня
3️⃣ Вечером напомню отметить выполненные
4️⃣ Смотри статистику и streak'и 🔥

Начнём? 👇
  `.trim();

  await ctx.reply(welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: createMainMenuKeyboard(),
  });
};
