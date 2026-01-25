import { BotContext } from '../types/index.js';

/**
 * Утилиты для работы с Telegram API
 * @module utils/telegram
 */

/**
 * Безопасно редактирует сообщение
 * @description Игнорирует ошибку "message is not modified" которая возникает
 * когда пытаемся отредактировать сообщение на такое же содержимое
 * @param ctx - Контекст бота
 * @param text - Текст сообщения
 * @param options - Опции сообщения
 */
export const safeEditMessage = async (
  ctx: BotContext,
  text: string,
  options?: Parameters<typeof ctx.editMessageText>[1]
): Promise<void> => {
  try {
    await ctx.editMessageText(text, options);
  } catch (error) {
    // Игнорируем ошибку "message is not modified"
    const isNotModifiedError = 
      error instanceof Error && 
      error.message.includes('message is not modified');
    
    if (!isNotModifiedError) {
      throw error;
    }
  }
};

/**
 * Безопасно отвечает на callback query
 * @description Игнорирует ошибку "query is too old" которая возникает
 * когда callback query устарел
 * @param ctx - Контекст бота
 * @param text - Текст уведомления (опционально)
 */
export const safeAnswerCallback = async (
  ctx: BotContext,
  text?: string
): Promise<void> => {
  try {
    await ctx.answerCallbackQuery(text);
  } catch (error) {
    // Игнорируем ошибку устаревшего callback
    const isOldQueryError = 
      error instanceof Error && 
      error.message.includes('query is too old');
    
    if (!isOldQueryError) {
      throw error;
    }
  }
};
