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

/**
 * Экранирует спецсимволы для классического Telegram Markdown (parse_mode='Markdown').
 *
 * Применяется к user-input строкам (habit.name и т.д.) когда они подставляются
 * в шаблоны с `*bold*`, `_italic_`, `[link]`, `\`code\``. Без escape Telegram
 * вернёт `Bad Request: can't parse entities` если у юзера в названии непарный
 * `*` или `_`.
 *
 * Reserved для Markdown V1: `*`, `_`, `` ` ``, `[`.
 *
 * @param text - User input string
 * @returns Строка с экранированными спецсимволами
 */
export const escapeMarkdown = (text: string): string => {
  return text.replace(/([_*[\]`])/g, '\\$1');
};
