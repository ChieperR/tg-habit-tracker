import { BotContext } from '../../types/index.js';
import { parseCallback } from '../../utils/callback.js';
import { safeAnswerCallback } from '../../utils/telegram.js';
import { ADMIN_TELEGRAM_ID } from '../../config.js';
import { showHabitsList } from '../commands/habits.js';
import { showStats } from '../commands/stats.js';
import { showWeekly, getPrevWeekStart, getNextWeekStart } from '../commands/weekly.js';
import { showSettings } from '../commands/settings.js';
import { showAnalytics } from '../commands/analytics.js';
import { handleHabitToggle, handleHabitDeletePrompt, handleHabitConfirmDelete, handleHabitDetails, handleHabitReminderRemove } from './handlers/habitCallbacks.js';
import { handleSettingsCallback } from './handlers/settingsCallbacks.js';
import { showMainMenu } from './handlers/navigationCallbacks.js';

/**
 * Главный обработчик всех callback запросов (тонкий роутер)
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

  // Settings callbacks
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

      case 'analytics':
        if (ctx.from?.id !== ADMIN_TELEGRAM_ID) {
          await ctx.answerCallbackQuery();
          break;
        }
        await showAnalytics(ctx, action.period);
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
