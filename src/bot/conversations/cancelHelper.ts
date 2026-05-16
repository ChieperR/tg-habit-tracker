import { InlineKeyboard } from 'grammy';
import type { BotConversation } from '../../types/index.js';

/**
 * Хелперы для conversation'ов чтобы юзер мог отменить ввод текста
 * нажатием кнопки. Иначе он застревает в `waitFor("message")` пока
 * не введёт что-нибудь, и обычные callback кнопки бота не работают.
 *
 * @module bot/conversations/cancelHelper
 */

/** Callback data для кнопки «Отмена» внутри conversation. */
export const CANCEL_CONVERSATION_CB = 'cancel_conv';

/**
 * Клавиатура с одной кнопкой «❌ Отмена», которая закрывает conversation.
 */
export const cancelConversationKeyboard = (): InlineKeyboard =>
  new InlineKeyboard().text('❌ Отмена', CANCEL_CONVERSATION_CB);

/**
 * Ждёт от юзера либо текст (тогда возвращает строку), либо нажатие на
 * кнопку «❌ Отмена» (тогда возвращает null). Прочие update'ы игнорируются
 * — цикл продолжается.
 *
 * Caller сам решает что делать при null (обычно показать главное меню и
 * выйти из conversation).
 *
 * @param conversation grammy conversation
 * @returns текст сообщения или null если юзер отменил
 */
export const waitTextOrCancel = async (
  conversation: BotConversation
): Promise<string | null> => {
  while (true) {
    const next = await conversation.wait();
    if (next.callbackQuery?.data === CANCEL_CONVERSATION_CB) {
      await next.answerCallbackQuery('❌ Отменено');
      // Удаляем сообщение с кнопкой «Отмена», чтобы в истории чата не
      // оставалась мёртвая кнопка после отмены.
      try {
        await next.deleteMessage();
      } catch {
        // Если сообщение уже удалено или слишком старое — Telegram кинет
        // ошибку, не критично.
      }
      return null;
    }
    const text = next.message?.text ?? next.message?.caption;
    if (text !== undefined) {
      return text;
    }
    // Прочие update'ы (стикер, voice, location и т.п.) игнорируем и ждём дальше.
  }
};

