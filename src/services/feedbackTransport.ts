import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../types/index.js';
import { serializeCallback } from '../utils/callback.js';
import {
  FeedbackUserContext,
  getFeedbackUserContext,
} from './feedbackService.js';
import { prisma } from '../db/index.js';

/**
 * Транспорт уведомлений админу + ответов юзеру.
 * @module services/feedbackTransport
 *
 * Singleton: инициализируется один раз в `index.ts` через `initFeedbackBots`,
 * после чего любой код может вызывать `notifyAdminAboutFeedback` /
 * `sendReplyToUser` без передачи ссылок на боты по цепочке.
 *
 * - Уведомления админу шлются от АДМИН-бота (`@adm_SleekHabitTracker_Bot`)
 * - Ответы юзеру шлются от ОСНОВНОГО habit-tracker бота (юзер видит знакомое имя)
 */

let userBot: Bot<BotContext> | null = null;
let adminBot: Bot<BotContext> | null = null;
let adminChatId: number | null = null;

/**
 * Инициализирует транспорт. Вызывать один раз при старте приложения.
 * @param user - Основной бот (юзер-фейс)
 * @param admin - Админ-бот (если null, уведомления админу не будут отправляться)
 * @param chatId - Telegram user_id администратора
 */
export const initFeedbackBots = (
  user: Bot<BotContext>,
  admin: Bot<BotContext> | null,
  chatId: number | null
): void => {
  userBot = user;
  adminBot = admin;
  adminChatId = chatId;
};

/** Включён ли админ-бот (есть токен и chat_id). */
export const isAdminNotifierEnabled = (): boolean =>
  adminBot !== null && adminChatId !== null;

/**
 * Шлёт админу уведомление о новом фидбэке. Если админ-бот не сконфигурен —
 * молча no-op (фидбэк всё равно сохраняется в БД, админ может прочитать
 * руками).
 * @param feedbackId - ID записи `FeedbackMessage`
 */
export const notifyAdminAboutFeedback = async (feedbackId: number): Promise<void> => {
  if (!adminBot || adminChatId === null) {
    console.warn('[feedback] admin bot not configured, skipping notification');
    return;
  }

  const feedback = await prisma.feedbackMessage.findUnique({
    where: { id: feedbackId },
    include: { user: true },
  });
  if (!feedback) return;

  const ctx: FeedbackUserContext = await getFeedbackUserContext(feedback.userId);

  // Достаём username/имя через getChat — юзер мог его обновить, и нет смысла
  // пушить ещё одно поле в БД.
  let displayName = '—';
  try {
    const chat = await adminBot.api.getChat(Number(feedback.user.telegramId));
    if (chat.type === 'private') {
      const username = chat.username ? `@${chat.username}` : '';
      const first = chat.first_name ?? '';
      const last = chat.last_name ?? '';
      const fullName = `${first} ${last}`.trim();
      displayName = [fullName, username].filter(Boolean).join(' ') || '—';
    }
  } catch {
    // не критично — может быть бот ещё не общался с юзером, или приватность
  }

  const header =
    `📬 Новый фидбэк №${feedback.id}\n` +
    `От: ${displayName} (id ${feedback.user.telegramId})\n` +
    `Стаж: ${ctx.daysSinceJoin} дн., ${ctx.activeHabits} привычек, ` +
    `longest streak ${ctx.longestStreak}, чек-инов ${ctx.totalCheckins}`;

  const quoted = feedback.text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

  const fullText = `${header}\n\n${quoted}`;

  const keyboard = new InlineKeyboard()
    .text(
      '💬 Ответить',
      serializeCallback({ type: 'feedback_admin_reply', feedbackId: feedback.id })
    )
    .text(
      '👀 Видел',
      serializeCallback({ type: 'feedback_admin_seen', feedbackId: feedback.id })
    );

  try {
    if (feedback.photoFileId) {
      await adminBot.api.sendPhoto(adminChatId, feedback.photoFileId, {
        caption: fullText,
        reply_markup: keyboard,
      });
    } else {
      await adminBot.api.sendMessage(adminChatId, fullText, {
        reply_markup: keyboard,
      });
    }
  } catch (e) {
    console.error('[feedback] failed to notify admin:', e);
  }
};

/**
 * Отправляет юзеру ответ от админа. Шлёт через основной habit-tracker бот,
 * чтобы юзер видел знакомое имя бота.
 * @param userTelegramId - Telegram ID юзера
 * @param feedbackId - ID фидбэка (для ссылки в сообщении)
 * @param replyText - Текст ответа админа
 */
export const sendReplyToUser = async (
  userTelegramId: bigint,
  feedbackId: number,
  replyText: string
): Promise<boolean> => {
  if (!userBot) {
    console.error('[feedback] userBot not initialized');
    return false;
  }
  const text = `💬 Ответ на твой фидбэк:\n\n${replyText}`;
  try {
    await userBot.api.sendMessage(userTelegramId.toString(), text);
    return true;
  } catch (e) {
    console.error(`[feedback] failed to deliver reply to ${userTelegramId}:`, e);
    return false;
  }
};
