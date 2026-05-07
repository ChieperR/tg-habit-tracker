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
import { safeAnswerCallback } from '../../utils/telegram.js';

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
    .row()
    .text('✏️ Редактировать', serializeCallback({ type: 'feedback_edit' }))
    .text('❌ Отмена', serializeCallback({ type: 'feedback_cancel' }));

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

/** Эскейпит спецсимволы HTML в строке (`&`, `<`, `>`). */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Показывает юзеру preview собранного фидбэка с кнопками confirm/edit.
 * Возвращает 'confirm' | 'edit' | 'cancel'.
 *
 * Текст юзера может содержать произвольный markdown/HTML, поэтому шапка
 * рендерится как HTML, а тело юзера эскейпится — иначе незакрытые `*`/`_`/`<`
 * валят `400: can't parse entities` и conversation крашится.
 */
const showPreview = async (
  conversation: BotConversation,
  ctx: BotContext,
  collected: Collected
): Promise<'confirm' | 'edit' | 'cancel'> => {
  const previewBody = collected.text
    ? escapeHtml(collected.text)
    : '<i>(только скриншот, без текста)</i>';
  const photoNote = collected.photoFileId ? '\n\n📎 <b>Скриншот прикреплён</b>' : '';
  const fullText =
    `📋 <b>Проверь фидбэк перед отправкой:</b>\n\n${previewBody}${photoNote}`;

  if (collected.photoFileId) {
    await ctx.replyWithPhoto(collected.photoFileId, {
      caption: fullText,
      parse_mode: 'HTML',
      reply_markup: previewKeyboard(),
    });
  } else {
    await ctx.reply(fullText, {
      parse_mode: 'HTML',
      reply_markup: previewKeyboard(),
    });
  }

  const choiceCtx = await conversation.waitFor('callback_query:data');
  const data = choiceCtx.callbackQuery.data;

  if (data === serializeCallback({ type: 'feedback_confirm' })) {
    await safeAnswerCallback(choiceCtx);
    return 'confirm';
  }
  if (data === serializeCallback({ type: 'feedback_edit' })) {
    await safeAnswerCallback(choiceCtx);
    return 'edit';
  }
  if (data === serializeCallback({ type: 'feedback_cancel' })) {
    await safeAnswerCallback(choiceCtx);
    return 'cancel';
  }
  // прочие callback'и — игнорируем как noise, считаем за отмену
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

    // confirm — сохраняем и шлём админу. Все side-effects запихиваем в ОДИН
    // `conversation.external`: grammy/conversations не разрешает nested или
    // concurrent external-calls (replay-engine ругается «Cannot perform
    // nested or concurrent calls to external»). Исключения внутри гасим,
    // чтобы провал notify/track не сломал юзеру UX.
    await conversation.external(async () => {
      const created = await createFeedback({
        userId: user.id,
        text: collected.text,
        photoFileId: collected.photoFileId,
      });
      try {
        await trackEvent(user.id, 'feedback_submitted', { feedbackId: created.id });
      } catch (e) {
        console.error('[feedback] trackEvent failed:', e);
      }
      try {
        await notifyAdminAboutFeedback(created);
      } catch (e) {
        console.error('[feedback] notifyAdminAboutFeedback failed:', e);
      }
    });

    await ctx.reply(
      '✅ Спасибо! Фидбэк отправлен.\n\n' +
        'При необходимости автор пришлёт ответ через этого же бота.'
    );
    return;
  }
};
