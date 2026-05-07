import { Bot, session } from 'grammy';
import type { BotCommand } from 'grammy/types';
import { conversations, createConversation } from '@grammyjs/conversations';
import { BotContext, SessionData } from '../../types/index.js';
import { parseCallback } from '../../utils/callback.js';
import { markFeedbackSeen } from '../../services/feedbackService.js';
import { adminReplyConversation } from './conversations/adminReply.js';
import { handleAdmin } from './commands/admin.js';
import { handleAnalytics, showAnalytics } from './commands/analytics.js';
import { handleFunnel } from './commands/funnel.js';

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
 * Список админ-команд для setMyCommands. Показываются в выпадающем меню
 * админ-бота (его видит только админ — остальные через guard).
 */
export const ADMIN_BOT_COMMANDS: BotCommand[] = [
  { command: 'admin', description: '📊 Статистика бота' },
  { command: 'analytics', description: '📈 Аналитика по периодам' },
  { command: 'funnel', description: '🎯 Воронка + здоровье привычек' },
];

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

  // Access-guard ПЕРВЫМ — чтобы не плодить in-memory session/conversation
  // флавор для случайных посторонних. Закрытый бот, не-админам silent ignore.
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.id !== adminChatId) {
      return;
    }
    await next();
  });

  bot.use(session({ initial: initialSessionData }));
  bot.use(conversations());
  bot.use(createConversation(adminReplyConversation, 'adminReply'));

  // /start text генерируется из ADMIN_BOT_COMMANDS — единственный источник
  // истины, при добавлении новой команды не нужно править два места.
  const startText =
    '👋 Админ-бот habit-tracker. Доступные команды:\n' +
    ADMIN_BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`).join('\n') +
    '\n\nТакже сюда приходят уведомления о фидбэке с inline-кнопками.';
  bot.command('start', async (ctx) => {
    await ctx.reply(startText);
  });

  // Админские команды (раньше жили в основном боте, перенесены в админ-бот)
  bot.command('admin', handleAdmin);
  bot.command('analytics', handleAnalytics);
  bot.command('funnel', handleFunnel);

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

    if (action.type === 'analytics') {
      await showAnalytics(ctx, action.period);
      await ctx.answerCallbackQuery();
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

/** Применяет admin-команды к меню бота. */
export const setAdminCommands = async (bot: Bot<BotContext>): Promise<void> => {
  await bot.api.setMyCommands(ADMIN_BOT_COMMANDS);
};
