import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { FeedbackMessage, User } from '@prisma/client';
import { BotContext } from '../types/index.js';
import { serializeCallback } from '../utils/callback.js';
import {
  FeedbackUserContext,
  getFeedbackUserContext,
} from './feedbackService.js';

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
 * @param feedback - Запись `FeedbackMessage` с подгруженным `user`
 */
export const notifyAdminAboutFeedback = async (
  feedback: FeedbackMessage & { user: User }
): Promise<void> => {
  if (!adminBot || adminChatId === null) {
    console.warn('[feedback] admin bot not configured, skipping notification');
    return;
  }

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
    `чек-инов ${ctx.totalCheckins}`;

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

  // ВАЖНО: file_id в TG привязан к боту, который его получил. Тот же
  // file_id, переданный в другой бот, валится 400 «wrong file identifier».
  // Решение — getFile через основной бот → URL TG-файла → re-upload через
  // админ-бот как InputFile.
  let photoSent = false;
  if (feedback.photoFileId && userBot) {
    try {
      const file = await userBot.api.getFile(feedback.photoFileId);
      if (file.file_path) {
        const url = `https://api.telegram.org/file/bot${userBot.token}/${file.file_path}`;
        await adminBot.api.sendPhoto(adminChatId, new InputFile(new URL(url)), {
          caption: fullText,
          reply_markup: keyboard,
        });
        photoSent = true;
      }
    } catch (e) {
      console.error('[feedback] failed to re-upload photo for admin:', e);
    }
  }

  if (!photoSent) {
    const text = feedback.photoFileId
      ? `${fullText}\n\n⚠️ К фидбэку был приложен скриншот, но переслать его не удалось.`
      : fullText;
    try {
      await adminBot.api.sendMessage(adminChatId, text, {
        reply_markup: keyboard,
      });
    } catch (e) {
      console.error('[feedback] failed to notify admin:', e);
    }
  }
};

/**
 * Шлёт админу произвольное сообщение через админ-бот (или через основной
 * как fallback, если админ-бот не сконфигурен). Используется для daily
 * report'ов и любых будущих админских уведомлений — единая точка входа.
 *
 * @param text - Текст сообщения
 * @param options - parse_mode, reply_markup и другие sendMessage-опции
 */
export const sendAdminMessage = async (
  text: string,
  options?: { parse_mode?: 'Markdown' | 'HTML' | 'MarkdownV2' }
): Promise<void> => {
  if (adminChatId === null) {
    console.warn('[admin] ADMIN_CHAT_ID не задан, пропускаю админское сообщение');
    return;
  }
  // Предпочитаем админ-бот, fallback на основной — чтобы при пустом
  // ADMIN_BOT_TOKEN админские уведомления не терялись совсем.
  const target = adminBot ?? userBot;
  if (!target) {
    console.error('[admin] ни adminBot, ни userBot не инициализированы');
    return;
  }
  try {
    await target.api.sendMessage(adminChatId, text, options);
  } catch (e) {
    console.error('[admin] failed to send admin message:', e);
  }
};

/**
 * Отправляет юзеру ответ от админа. Шлёт через основной habit-tracker бот,
 * чтобы юзер видел знакомое имя бота.
 * @param userTelegramId - Telegram ID юзера
 * @param replyText - Текст ответа админа
 */
export const sendReplyToUser = async (
  userTelegramId: bigint,
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
