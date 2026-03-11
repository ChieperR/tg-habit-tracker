import { Keyboard } from 'grammy';
import { BotContext } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { trackEvent } from '../../services/analyticsService.js';
import { createMainMenuKeyboard } from '../keyboards/index.js';

/**
 * Клавиатура запроса геолокации для определения часового пояса
 */
const requestTimezoneKeyboard = () =>
  new Keyboard()
    .requestLocation('📍 Отправить геолокацию')
    .oneTime()
    .resized();

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

  // Парсим source из deep link параметра (/start src_pikabu → source='src_pikabu')
  const startParam = typeof ctx.match === 'string' ? ctx.match.trim() : '';
  const source = startParam.length > 0 ? startParam : 'organic';

  const user = await findOrCreateUser(telegramId, source);
  ctx.session.dbUserId = user.id;

  // Трекаем событие старта только для новых пользователей (fire-and-forget)
  if (user.isNew) {
    void trackEvent(user.id, 'start', { source });
  }

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

  if (user.timezoneOffset === null) {
    ctx.session.awaitingTimezone = true;
    const tzMessage = [
      'Чтобы я мог присылать напоминания вовремя, мне нужно знать твоё время.',
      '',
      'Отправь геолокацию (кнопка ниже) или введи часовой пояс вручную:',
      '• Число от -12 до +14 (например: 3 для Москвы, 0 для Лондона)',
      '• Или в формате UTC+3 / UTC-5',
    ].join('\n');
    await ctx.reply(tzMessage, {
      reply_markup: requestTimezoneKeyboard(),
    });
  }
};
