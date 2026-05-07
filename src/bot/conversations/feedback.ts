import { InlineKeyboard } from 'grammy';
import { BotContext, BotConversation } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import {
  createFeedback,
  getFeedbackCooldownSeconds,
} from '../../services/feedbackService.js';
import { notifyAdminAboutFeedback } from '../../services/feedbackTransport.js';
import { trackEvent } from '../../services/analyticsService.js';
import { serializeCallback } from '../../utils/callback.js';

/**
 * Диалог отправки фидбэка
 * @module bot/conversations/feedback
 *
 * Шаги:
 *  1. Бот просит описать мысль/баг/предложение (текст и/или скриншот)
 *  2. Юзер шлёт сообщение (или /cancel)
 *  3. Preview: бот показывает что собрано и спрашивает «отправить или поправить?»
 *     с кнопками ✅ Отправить / ✏️ Редактировать
 *  4. На ✏️ — возвращаемся к шагу 2
 *  5. На ✅ — пишем в БД, шлём админу, юзеру: «спасибо, фидбэк №N отправлен»
 */

const PROMPT =
  '✍️ Опиши свою мысль, баг или предложение одним сообщением. ' +
  'Можно текст, скриншот или текст со скриншотом.\n\n' +
  'Напиши /cancel чтобы отменить.';

const previewKeyboard = (): InlineKeyboard =>
  new InlineKeyboard()
    .text('✅ Отправить', serializeCallback({ type: 'feedback_confirm' }))
    .text('✏️ Редактировать', serializeCallback({ type: 'feedback_edit' }));

type Collected = { text: string; photoFileId: string | null };

/**
 * Слушает следующее пользовательское сообщение и собирает его в `Collected`.
 * Возвращает null если юзер прислал /cancel.
 */
const waitForUserInput = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<Collected | null> => {
  const response = await conversation.waitFor('message');
  const msg = response.message;

  if (msg.text?.startsWith('/cancel')) {
    await ctx.reply('❌ Фидбэк отменён');
    return null;
  }

  // /feedback внутри conversation — рестарт ввода
  if (msg.text?.startsWith('/feedback')) {
    await ctx.reply(PROMPT);
    return waitForUserInput(conversation, ctx);
  }

  const photoFileId =
    msg.photo && msg.photo.length > 0 ? msg.photo[msg.photo.length - 1]!.file_id : null;
  const text = msg.text ?? msg.caption ?? '';

  if (!text && !photoFileId) {
    await ctx.reply(
      '❌ Пустое сообщение. Пришли текст или скриншот, либо /cancel чтобы отменить.'
    );
    return waitForUserInput(conversation, ctx);
  }

  if (text.length > 4000) {
    await ctx.reply('❌ Слишком длинно. Уложись в 4000 символов.');
    return waitForUserInput(conversation, ctx);
  }

  return { text, photoFileId };
};

/**
 * Показывает юзеру preview собранного фидбэка с кнопками confirm/edit.
 * Возвращает 'confirm' | 'edit' | 'cancel'.
 */
const showPreview = async (
  conversation: BotConversation,
  ctx: BotContext,
  collected: Collected
): Promise<'confirm' | 'edit' | 'cancel'> => {
  const previewBody = collected.text || '_(только скриншот, без текста)_';
  const photoNote = collected.photoFileId ? '\n\n📎 *Скриншот прикреплён*' : '';
  const fullText =
    `📋 *Проверь фидбэк перед отправкой:*\n\n${previewBody}${photoNote}`;

  if (collected.photoFileId) {
    await ctx.replyWithPhoto(collected.photoFileId, {
      caption: fullText,
      parse_mode: 'Markdown',
      reply_markup: previewKeyboard(),
    });
  } else {
    await ctx.reply(fullText, {
      parse_mode: 'Markdown',
      reply_markup: previewKeyboard(),
    });
  }

  const choiceCtx = await conversation.waitFor('callback_query:data');
  const data = choiceCtx.callbackQuery.data;

  if (data === serializeCallback({ type: 'feedback_confirm' })) {
    await choiceCtx.answerCallbackQuery();
    return 'confirm';
  }
  if (data === serializeCallback({ type: 'feedback_edit' })) {
    await choiceCtx.answerCallbackQuery();
    return 'edit';
  }
  // прочие callback'и — игнорируем как noise
  await choiceCtx.answerCallbackQuery();
  return 'cancel';
};

export const feedbackConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply('❌ Не удалось определить пользователя');
    return;
  }

  const user = await conversation.external(() => findOrCreateUser(telegramId));

  // Rate-limit
  const cooldown = await conversation.external(() =>
    getFeedbackCooldownSeconds(user.id)
  );
  if (cooldown > 0) {
    const minutes = Math.ceil(cooldown / 60);
    await ctx.reply(
      `⏳ Подожди ${minutes} мин. перед следующим фидбэком — это защита от спама.`
    );
    return;
  }

  await ctx.reply(PROMPT);

  // Цикл «ввод → preview → confirm/edit»
  while (true) {
    const collected = await waitForUserInput(conversation, ctx);
    if (!collected) return; // /cancel

    const choice = await showPreview(conversation, ctx, collected);

    if (choice === 'cancel') {
      await ctx.reply('❌ Фидбэк отменён');
      return;
    }

    if (choice === 'edit') {
      await ctx.reply(PROMPT);
      continue;
    }

    // confirm — сохраняем и шлём админу
    const feedback = await conversation.external(() =>
      createFeedback({
        userId: user.id,
        text: collected.text,
        photoFileId: collected.photoFileId,
      })
    );

    void conversation.external(() =>
      trackEvent(user.id, 'feedback_submitted', { feedbackId: feedback.id })
    );

    void conversation.external(() => notifyAdminAboutFeedback(feedback.id));

    await ctx.reply(
      `✅ Спасибо! Фидбэк №${feedback.id} отправлен.\n\n` +
        'Если что-то нужно будет уточнить — Эмин ответит сюда же.'
    );
    return;
  }
};
