import { BotContext, BotConversation } from '../../types/index.js';
import { parseCallback } from '../../utils/callback.js';
import { getHabitById, renameHabit } from '../../services/habitService.js';
import { findOrCreateUser } from '../../services/userService.js';
import { createHabitDetailsKeyboard, createMainMenuKeyboard } from '../keyboards/index.js';
import { escapeMarkdown } from '../../utils/telegram.js';
import { validateHabitName } from '../../utils/validation.js';
import { cancelConversationKeyboard, waitTextOrCancel } from './cancelHelper.js';

/**
 * Диалог переименования привычки. Вызывается из деталей привычки кнопкой
 * «✏️ Переименовать»; habitId берём из callback_data как в setHabitReminder.
 * @module bot/conversations/renameHabit
 */

export const renameHabitConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const callbackData = ctx.callbackQuery?.data;
  const action = callbackData ? parseCallback(callbackData) : null;
  const habitId = action && action.type === 'habit_rename' ? action.habitId : undefined;
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

  await ctx.reply(
    `✏️ Текущее название: *${escapeMarkdown(habit.name)}*\n\nВведи новое название:`,
    { parse_mode: 'Markdown', reply_markup: cancelConversationKeyboard() }
  );

  while (true) {
    const input = await waitTextOrCancel(conversation);
    if (input === null) return; // юзер нажал «Отмена» (сообщение уже удалено)

    const validated = validateHabitName(input);
    if ('error' in validated) {
      await ctx.reply(`❌ ${validated.error} Введи ещё раз:`, {
        reply_markup: cancelConversationKeyboard(),
      });
      continue;
    }

    const ok = await conversation.external(() => renameHabit(habitId, user.id, validated.name));
    if (!ok) {
      await ctx.reply('❌ Привычка не найдена или была удалена.', {
        reply_markup: createMainMenuKeyboard(),
      });
      return;
    }

    // Перечитываем привычку — reminderTime мог измениться пока юзер вводил имя.
    const fresh = await conversation.external(() => getHabitById(habitId));
    await ctx.reply(
      `✅ Переименовано: *${escapeMarkdown(`${habit.emoji} ${validated.name}`)}*`,
      {
        parse_mode: 'Markdown',
        reply_markup: createHabitDetailsKeyboard({
          habitId,
          reminderTime: fresh?.reminderTime ?? null,
        }),
      }
    );
    return;
  }
};
