import { BotContext } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { sendMorningReminder, sendEveningReminder } from '../../services/reminderService.js';

/**
 * Обработчик команды /daily (для тестирования напоминаний)
 * @description Доступна только в DEV режиме (NODE_ENV=development или DEV=true)
 * @param ctx - Контекст бота
 */
export const handleDaily = async (ctx: BotContext): Promise<void> => {
  // Дополнительная проверка на всякий случай
  const isDev = process.env.NODE_ENV === 'development' || process.env.DEV === 'true';
  if (!isDev) {
    await ctx.reply('❌ Эта команда доступна только в режиме разработки');
    return;
  }

  const telegramId = ctx.from?.id;
  
  if (!telegramId) {
    await ctx.reply('❌ Не удалось определить пользователя');
    return;
  }

  const user = await findOrCreateUser(telegramId);
  const timezoneOffset = user.timezoneOffset ?? 0;

  if (timezoneOffset === 0 && user.timezoneOffset === null) {
    await ctx.reply('⚠️ Сначала настрой часовой пояс в /settings');
    return;
  }

  // Создаём объект с api для передачи в функции напоминаний
  const botLike = { api: ctx.api };

  try {
    // Отправляем утреннее напоминание
    await sendMorningReminder(
      botLike as any,
      BigInt(telegramId),
      user.id,
      timezoneOffset
    );

    // Небольшая задержка между сообщениями
    await new Promise(resolve => setTimeout(resolve, 500));

    // Отправляем вечернее напоминание
    await sendEveningReminder(
      botLike as any,
      BigInt(telegramId),
      user.id,
      timezoneOffset
    );
  } catch (error) {
    console.error('Ошибка отправки тестовых напоминаний:', error);
    await ctx.reply('❌ Произошла ошибка при отправке напоминаний');
  }
};
