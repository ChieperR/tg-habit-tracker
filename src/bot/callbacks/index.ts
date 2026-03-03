import { BotContext } from '../../types/index.js';
import { parseCallback } from '../../utils/callback.js';
import { safeEditMessage, safeAnswerCallback } from '../../utils/telegram.js';
import { findOrCreateUser, updateUserSettings } from '../../services/userService.js';
import { toggleHabitCompletion, deleteHabit, getHabitById, getUserHabitsWithTodayStatus, updateHabitReminder } from '../../services/habitService.js';
import { showHabitsList } from '../commands/habits.js';
import { showStats } from '../commands/stats.js';
import { showWeekly, getPrevWeekStart, getNextWeekStart } from '../commands/weekly.js';
import { showSettings } from '../commands/settings.js';
import { createMainMenuKeyboard, createDeleteConfirmKeyboard, createEveningChecklistKeyboard, createHabitDetailsKeyboard } from '../keyboards/index.js';

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

      case 'habits_day':
        await showHabitsList(ctx, action.date);
        await ctx.answerCallbackQuery();
        break;

      case 'habit_toggle':
        await handleHabitToggle(ctx, action.habitId, action.source, action.date);
        break;

      case 'habit_details':
        await handleHabitDetails(ctx, action.habitId);
        break;

      case 'habit_delete':
        await handleHabitDeletePrompt(ctx, action.habitId);
        break;

      case 'habit_confirm_delete':
        await handleHabitConfirmDelete(ctx, action.habitId);
        break;

      case 'habit_reminder_set':
        await ctx.answerCallbackQuery();
        await ctx.conversation.enter('setHabitReminder');
        break;

      case 'habit_reminder_remove':
        await handleHabitReminderRemove(ctx, action.habitId);
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
 * @param source - Источник вызова ('evening_reminder' или undefined для списка привычек)
 * @param date - Дата переключения (YYYY-MM-DD); если не передана — сегодня
 */
const handleHabitToggle = async (
  ctx: BotContext,
  habitId: number,
  source?: 'evening_reminder',
  date?: string
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const habit = await getHabitById(habitId);

  if (!habit || habit.userId !== user.id) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  const timezoneOffset = user.timezoneOffset ?? 0;
  const newStatus = await toggleHabitCompletion(habitId, timezoneOffset, date);
  const statusText = newStatus ? '✅ Выполнено!' : '⬜ Отменено';

  await safeAnswerCallback(ctx, statusText);

  if (source === 'evening_reminder') {
    const habits = await getUserHabitsWithTodayStatus(user.id, timezoneOffset);
    const todayHabits = habits.filter((h) => h.isDueToday);
    const allCompleted = todayHabits.every((h) => h.completedToday);

    let message = '🌙 *Время подвести итоги дня!*\n\n';
    if (allCompleted) {
      message += '🎉 Все привычки выполнены! Так держать! 💪\n\n';
    } else {
      message += 'Отметь выполненные привычки:\n\n';
    }
    for (const h of todayHabits) {
      const status = h.completedToday ? '✅' : '⬜';
      message += `${status} ${h.emoji} ${h.name}\n`;
    }

    await safeEditMessage(ctx, message, {
      parse_mode: 'Markdown',
      reply_markup: createEveningChecklistKeyboard(todayHabits),
    });
    return;
  }

  await showHabitsList(ctx, date);
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

/** Названия дней недели */
const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Форматирует расписание привычки
 */
const formatScheduleText = (habit: { frequencyType: string; frequencyDays: number; weekdays: string | null }): string => {
  switch (habit.frequencyType) {
    case 'daily':
      return 'ежедневно';
    case 'interval':
      return `раз в ${habit.frequencyDays} дн.`;
    case 'weekdays': {
      if (!habit.weekdays) return '';
      const days = habit.weekdays.split(',').map(Number);
      const sorted = [...days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
      return sorted.map((d) => WEEKDAY_NAMES[d]).join(', ');
    }
    default:
      return '';
  }
};

/**
 * Показывает детали привычки
 */
const handleHabitDetails = async (ctx: BotContext, habitId: number): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const habit = await getHabitById(habitId);

  if (!habit || habit.userId !== user.id) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  await ctx.answerCallbackQuery();

  const schedule = formatScheduleText(habit);
  const reminderLine = habit.reminderTime
    ? `⏰ Напоминание: *${habit.reminderTime}*`
    : '⏰ Напоминание: _не установлено_';

  const message = `
⚙️ *${habit.emoji} ${habit.name}*

📅 Расписание: _${schedule}_
${reminderLine}
  `.trim();

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createHabitDetailsKeyboard({
      habitId: habit.id,
      reminderTime: habit.reminderTime,
    }),
  });
};

/**
 * Удаляет напоминание привычки
 */
const handleHabitReminderRemove = async (ctx: BotContext, habitId: number): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const habit = await getHabitById(habitId);

  if (!habit || habit.userId !== user.id) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  await updateHabitReminder(habitId, null);
  await ctx.answerCallbackQuery('🔕 Напоминание удалено');

  const schedule = formatScheduleText(habit);
  const message = `
⚙️ *${habit.emoji} ${habit.name}*

📅 Расписание: _${schedule}_
⏰ Напоминание: _не установлено_
  `.trim();

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createHabitDetailsKeyboard({
      habitId: habit.id,
      reminderTime: null,
    }),
  });
};
