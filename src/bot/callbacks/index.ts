import { BotContext } from '../../types/index.js';
import { parseCallback } from '../../utils/callback.js';
import { safeEditMessage, safeAnswerCallback } from '../../utils/telegram.js';
import { findOrCreateUser, updateUserSettings } from '../../services/userService.js';
import { toggleHabitCompletion, deleteHabit, getHabitById, getUserHabitsWithTodayStatus } from '../../services/habitService.js';
import { showHabitsList } from '../commands/habits.js';
import { showStats } from '../commands/stats.js';
import { showWeekly, getPrevWeekStart, getNextWeekStart } from '../commands/weekly.js';
import { showSettings } from '../commands/settings.js';
import { createMainMenuKeyboard, createDeleteConfirmKeyboard, createHabitsListKeyboard } from '../keyboards/index.js';

/**
 * Обработчик callback запросов
 * @module bot/callbacks
 */

/**
 * Главный обработчик всех callback запросов
 * @param ctx - Контекст бота
 */
export const handleCallback = async (ctx: BotContext): Promise<void> => {
  const data = ctx.callbackQuery?.data;
  
  if (!data) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Игнорируем callbacks для conversation (emoji, frequency, weekdays)
  if (
    data.startsWith('emoji:') || 
    data.startsWith('freqtype:') || 
    data.startsWith('weekday:') || 
    data.startsWith('weekdays:')
  ) {
    return; // conversation обработает
  }

  // Обрабатываем settings callbacks отдельно
  if (data.startsWith('settings:')) {
    await handleSettingsCallback(ctx, data);
    return;
  }

  const action = parseCallback(data);
  
  if (!action) {
    await ctx.answerCallbackQuery('❓ Неизвестное действие');
    return;
  }

  try {
    switch (action.type) {
      case 'habits_list':
        await showHabitsList(ctx);
        await ctx.answerCallbackQuery();
        break;

      case 'habit_add':
        await ctx.answerCallbackQuery();
        await ctx.conversation.enter('addHabit');
        break;

      case 'habit_toggle':
        await handleHabitToggle(ctx, action.habitId);
        break;

      case 'habit_delete':
        await handleHabitDeletePrompt(ctx, action.habitId);
        break;

      case 'habit_confirm_delete':
        await handleHabitConfirmDelete(ctx, action.habitId);
        break;

      case 'stats':
        await showStats(ctx);
        await ctx.answerCallbackQuery();
        break;

      case 'weekly_show':
        await showWeekly(ctx, action.weekStart);
        await ctx.answerCallbackQuery();
        break;

      case 'weekly_prev':
        await showWeekly(ctx, getPrevWeekStart(action.weekStart));
        await ctx.answerCallbackQuery();
        break;

      case 'weekly_next':
        await showWeekly(ctx, getNextWeekStart(action.weekStart));
        await ctx.answerCallbackQuery();
        break;

      case 'settings':
        await showSettings(ctx);
        await ctx.answerCallbackQuery();
        break;

      case 'back_to_menu':
        await showMainMenu(ctx);
        await ctx.answerCallbackQuery();
        break;

      case 'noop':
        await ctx.answerCallbackQuery();
        break;

      case 'save_day':
        await ctx.answerCallbackQuery('✅ Сохранено!');
        await showMainMenu(ctx);
        break;

      default:
        await ctx.answerCallbackQuery();
    }
  } catch (error) {
    console.error('Ошибка обработки callback:', error);
    await safeAnswerCallback(ctx, '❌ Произошла ошибка');
  }
};

/**
 * Обрабатывает callbacks настроек
 */
const handleSettingsCallback = async (ctx: BotContext, data: string): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const action = data.replace('settings:', '');

  try {
    switch (action) {
      case 'morning_toggle': {
        const newValue = !user.morningEnabled;
        await updateUserSettings(user.id, { morningEnabled: newValue });
        await ctx.answerCallbackQuery(newValue ? '🔔 Утренние вкл' : '🔕 Утренние выкл');
        await showSettings(ctx);
        break;
      }

      case 'evening_toggle': {
        const newValue = !user.eveningEnabled;
        await updateUserSettings(user.id, { eveningEnabled: newValue });
        await ctx.answerCallbackQuery(newValue ? '🔔 Вечерние вкл' : '🔕 Вечерние выкл');
        await showSettings(ctx);
        break;
      }

      case 'morning_time':
        await ctx.answerCallbackQuery();
        await ctx.conversation.enter('setMorningTime');
        break;

      case 'evening_time':
        await ctx.answerCallbackQuery();
        await ctx.conversation.enter('setEveningTime');
        break;

      case 'timezone':
        await ctx.answerCallbackQuery();
        await ctx.conversation.enter('setTimezone');
        break;

      default:
        await ctx.answerCallbackQuery();
    }
  } catch (error) {
    console.error('Ошибка обработки settings callback:', error);
    await safeAnswerCallback(ctx, '❌ Произошла ошибка');
  }
};

/**
 * Показывает главное меню
 */
const showMainMenu = async (ctx: BotContext): Promise<void> => {
  const message = `
🏠 *Главное меню*

Выбери действие:
  `.trim();

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createMainMenuKeyboard(),
  });
};

/**
 * Переключает статус выполнения привычки
 */
const handleHabitToggle = async (ctx: BotContext, habitId: number): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const habit = await getHabitById(habitId);

  if (!habit || habit.userId !== user.id) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  const timezoneOffset = user.timezoneOffset ?? 0;
  const newStatus = await toggleHabitCompletion(habitId, timezoneOffset);
  const statusText = newStatus ? '✅ Выполнено!' : '⬜ Отменено';
  
  await safeAnswerCallback(ctx, statusText);

  const habits = await getUserHabitsWithTodayStatus(user.id, timezoneOffset);
  
  let message = '📝 *Мои привычки*\n\n';
  message += '💤 — не нужно выполнять сегодня\n';
  message += '✅ — выполнено | ⬜ — не выполнено\n\n';
  
  // Добавляем список привычек с полными названиями
  if (habits.length > 0) {
    message += '*Список привычек:*\n';
    for (const habit of habits) {
      const status = habit.completedToday ? '✅' : '⬜';
      const dueIndicator = habit.isDueToday ? '' : ' 💤';
      message += `${status} ${habit.emoji} ${habit.name}${dueIndicator}\n`;
    }
    message += '\n';
  }
  
  message += 'Нажми на кнопку ниже, чтобы отметить выполнение:';

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createHabitsListKeyboard(habits),
  });
};

/**
 * Показывает подтверждение удаления
 */
const handleHabitDeletePrompt = async (ctx: BotContext, habitId: number): Promise<void> => {
  const habit = await getHabitById(habitId);

  if (!habit) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  await ctx.answerCallbackQuery();
  
  const message = `
🗑 *Удаление привычки*

Ты уверен, что хочешь удалить привычку "${habit.emoji} ${habit.name}"?

Это действие нельзя отменить.
  `.trim();

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: createDeleteConfirmKeyboard(habitId),
  });
};

/**
 * Подтверждает удаление привычки
 */
const handleHabitConfirmDelete = async (ctx: BotContext, habitId: number): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const habit = await getHabitById(habitId);

  if (!habit || habit.userId !== user.id) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  await deleteHabit(habitId);
  await ctx.answerCallbackQuery('🗑 Привычка удалена');
  await showHabitsList(ctx);
};
