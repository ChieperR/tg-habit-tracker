import { BotContext, BotConversation } from '../../types/index.js';
import { parseCallback } from '../../utils/callback.js';
import { changeHabitEmoji, getHabitById, getHabitReminders } from '../../services/habitService.js';
import { findOrCreateUser } from '../../services/userService.js';
import { createEmojiKeyboard, createHabitDetailsKeyboard, createMainMenuKeyboard } from '../keyboards/index.js';
import { escapeMarkdown } from '../../utils/telegram.js';
import { parseHabitEmoji } from '../../utils/validation.js';
import { CANCEL_CONVERSATION_CB } from './cancelHelper.js';

/**
 * Диалог смены эмодзи привычки. Вызывается из деталей привычки кнопкой
 * «🎨 Сменить эмодзи»; habitId берём из callback_data как в renameHabit.
 * Эмодзи выбирают из той же сетки, что при создании, или присылают свой.
 * @module bot/conversations/changeHabitEmoji
 */

export const changeHabitEmojiConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const callbackData = ctx.callbackQuery?.data;
  const action = callbackData ? parseCallback(callbackData) : null;
  const habitId = action && action.type === 'habit_emoji' ? action.habitId : undefined;
  if (habitId === undefined) {
    await ctx.reply('❌ Не удалось определить привычку', {
      reply_markup: createMainMenuKeyboard(),
    });
    return;
  }

  const user = await conversation.external(() => findOrCreateUser(telegramId));
  const habit = await conversation.external(() => getHabitById(habitId));
  if (!habit || !habit.isActive || habit.userId !== user.id) {
    await ctx.reply('❌ Привычка не найдена', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  const keyboard = createEmojiKeyboard(CANCEL_CONVERSATION_CB);
  await ctx.reply(
    `🎨 Сейчас: ${habit.emoji} *${escapeMarkdown(habit.name)}*\n\nВыбери новый эмодзи или отправь свой:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  let emoji: string;
  while (true) {
    const next = await conversation.wait();
    const data = next.callbackQuery?.data;

    if (data === CANCEL_CONVERSATION_CB) {
      await next.answerCallbackQuery('❌ Отменено');
      try {
        await next.deleteMessage();
      } catch {
        // Сообщение уже удалено или слишком старое — не критично.
      }
      return;
    }

    if (data?.startsWith('emoji:')) {
      emoji = data.slice('emoji:'.length);
      await next.answerCallbackQuery();
      break;
    }

    const text = next.message?.text;
    if (text !== undefined) {
      const parsed = parseHabitEmoji(text);
      if (parsed) {
        emoji = parsed;
        break;
      }
      await ctx.reply('❌ Нужен эмодзи без текста. Выбери из списка или отправь свой:', {
        reply_markup: keyboard,
      });
      continue;
    }

    // Чужие кнопки во время выбора не выполняются — только снимаем «часики».
    if (next.callbackQuery) await next.answerCallbackQuery();
  }

  const ok = await conversation.external(() => changeHabitEmoji(habitId, user.id, emoji));
  if (!ok) {
    await ctx.reply('❌ Привычка не найдена или была удалена.', {
      reply_markup: createMainMenuKeyboard(),
    });
    return;
  }

  // Перечитываем — имя и напоминания могли измениться, пока юзер выбирал.
  const fresh = await conversation.external(() => getHabitById(habitId));
  const reminders = await conversation.external(() => getHabitReminders(habitId));
  await ctx.reply(
    `✅ Новый эмодзи: *${escapeMarkdown(`${emoji} ${fresh?.name ?? habit.name}`)}*`,
    {
      parse_mode: 'Markdown',
      reply_markup: createHabitDetailsKeyboard({ habitId, reminderCount: reminders.length }),
    }
  );
};
