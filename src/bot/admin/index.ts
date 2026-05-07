import { Bot, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { BotContext, SessionData } from '../../types/index.js';
import { parseCallback } from '../../utils/callback.js';
import { markFeedbackSeen } from '../../services/feedbackService.js';
import { adminReplyConversation } from './conversations/adminReply.js';

/**
 * Админ-бот (`@adm_SleekHabitTracker_Bot`) — закрытый бот для одного человека.
 * Принимает уведомления о фидбэке и собирает ответы админа, которые
 * пересылаются юзеру через основной habit-tracker бот.
 *
 * Сам по себе ничего не показывает кроме уведомлений и conversation для
 * ответа — `/start` пишется только если очень хочется.
 *
 * @module bot/admin
 */

const initialSessionData = (): SessionData => ({});

/**
 * Создаёт инстанс админ-бота.
 * @param token - Токен админ-бота от BotFather
 * @param adminChatId - Telegram user_id админа (для проверки доступа)
 */
export const createAdminBot = (
  token: string,
  adminChatId: number
): Bot<BotContext> => {
  const bot = new Bot<BotContext>(token);

  bot.use(session({ initial: initialSessionData }));
  bot.use(conversations());
  bot.use(createConversation(adminReplyConversation, 'adminReply'));

  // Любые сообщения от не-админов — silent ignore. Админ-бот закрытый.
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.id !== adminChatId) {
      return;
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '👋 Это админ-бот для habit-tracker. Сюда приходят уведомления о фидбэке. ' +
        'Действия — через inline-кнопки на сообщениях.'
    );
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const action = parseCallback(data);
    if (!action) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (action.type === 'feedback_admin_reply') {
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter('adminReply', action.feedbackId);
      return;
    }

    if (action.type === 'feedback_admin_seen') {
      await markFeedbackSeen(action.feedbackId);
      await ctx.answerCallbackQuery({ text: 'Отмечено как просмотренное' });
      // Снимаем кнопки с сообщения, чтобы не было соблазна жать ещё раз
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        // если caption — fallback на edit caption без markup
        try {
          await ctx.editMessageCaption({
            caption: ctx.callbackQuery.message?.caption ?? '',
            reply_markup: undefined,
          });
        } catch {
          // не критично
        }
      }
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.catch((err) => {
    console.error('Ошибка админ-бота:', err);
  });

  return bot;
};
