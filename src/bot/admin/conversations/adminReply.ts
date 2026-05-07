import { BotContext, BotConversation } from '../../../types/index.js';
import {
  getFeedbackById,
  replyToFeedback,
} from '../../../services/feedbackService.js';
import { sendReplyToUser } from '../../../services/feedbackTransport.js';

/**
 * Conversation в админ-боте: после нажатия «💬 Ответить» собирает текст
 * ответа админа и пересылает юзеру через основной habit-tracker бот.
 *
 * `feedbackId` передаётся как третий аргумент через `conversation.enter`.
 * Через `ctx.session` нельзя — conversation реплеится с нуля и session
 * к этому моменту может быть пустым / undefined.
 *
 * @module bot/admin/conversations/adminReply
 */
export const adminReplyConversation = async (
  conversation: BotConversation,
  ctx: BotContext,
  feedbackId: number
): Promise<void> => {
  if (typeof feedbackId !== 'number') {
    await ctx.reply('❌ Что-то пошло не так — feedbackId потерян. Жми «💬 Ответить» снова.');
    return;
  }

  const feedback = await conversation.external(() => getFeedbackById(feedbackId));
  if (!feedback) {
    await ctx.reply(`❌ Фидбэк №${feedbackId} не найден в БД.`);
    return;
  }

  await ctx.reply(
    `✍️ Введи текст ответа на фидбэк №${feedbackId} одним сообщением.\n\n` +
      'Напиши /cancel чтобы отменить.'
  );

  const response = await conversation.waitFor('message:text');
  const replyText = response.message.text;

  if (replyText.startsWith('/cancel')) {
    await ctx.reply('❌ Ответ отменён');
    return;
  }
  if (!replyText.trim()) {
    await ctx.reply('❌ Пустое сообщение');
    return;
  }

  const delivered = await conversation.external(() =>
    sendReplyToUser(feedback.user.telegramId, feedbackId, replyText)
  );

  if (!delivered) {
    await ctx.reply(
      '⚠️ Не удалось доставить ответ юзеру (возможно он заблокировал бота). ' +
        'В БД ответ всё равно сохранён.'
    );
  }

  await conversation.external(() => replyToFeedback(feedbackId, replyText));

  if (delivered) {
    await ctx.reply(`✅ Ответ на фидбэк №${feedbackId} отправлен юзеру`);
  }
};
