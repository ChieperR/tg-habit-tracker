import { BotContext, BotConversation } from '../../types/index.js';
import { parseCallback } from '../../utils/callback.js';
import { getHabitById, renameHabit } from '../../services/habitService.js';
import { createHabitDetailsKeyboard, createMainMenuKeyboard } from '../keyboards/index.js';
import { escapeMarkdown } from '../../utils/telegram.js';
import { cancelConversationKeyboard, waitTextOrCancel } from './cancelHelper.js';

/**
 * Диалог переименования привычки. Вызывается из деталей привычки кнопкой
 * «✏️ Переименовать»; habitId берём из callback_data как в setHabitReminder.
 * @module bot/conversations/renameHabit
 */

const MAX_NAME_LENGTH = 100;

export const renameHabitConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const callbackData = ctx.callbackQuery?.data;
  const action = callbackData ? parseCallback(callbackData) : null;
  const habitId = action && action.type === 'habit_rename' ? action.habitId : undefined;
  if (habitId === undefined) {
    await ctx.reply('❌ Не удалось определить привычку', {
      reply_markup: createMainMenuKeyboard(),
    });
    return;
  }

  const habit = await conversation.external(() => getHabitById(habitId));
  if (!habit) {
    await ctx.reply('❌ Привычка не найдена', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  await ctx.reply(
    `✏️ Текущее название: *${escapeMarkdown(habit.name)}*\n\nВведи новое название:`,
    { parse_mode: 'Markdown', reply_markup: cancelConversationKeyboard() }
  );

  while (true) {
    const input = await waitTextOrCancel(conversation);
    if (input === null) return; // юзер нажал «Отмена» (сообщение уже удалено)

    const name = input.trim();
    if (!name || name.startsWith('/')) {
      await ctx.reply('❌ Название не должно быть пустым. Введи ещё раз:', {
        reply_markup: cancelConversationKeyboard(),
      });
      continue;
    }
    if (name.length > MAX_NAME_LENGTH) {
      await ctx.reply(`❌ Слишком длинное (макс ${MAX_NAME_LENGTH} символов). Введи короче:`, {
        reply_markup: cancelConversationKeyboard(),
      });
      continue;
    }

    await conversation.external(() => renameHabit(habitId, name));
    await ctx.reply(
      `✅ Переименовано: *${escapeMarkdown(`${habit.emoji} ${name}`)}*`,
      {
        parse_mode: 'Markdown',
        reply_markup: createHabitDetailsKeyboard({ habitId, reminderTime: habit.reminderTime }),
      }
    );
    return;
  }
};
