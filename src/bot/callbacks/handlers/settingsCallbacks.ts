import { BotContext } from '../../../types/index.js';
import { safeAnswerCallback } from '../../../utils/telegram.js';
import { findOrCreateUser, updateUserSettings } from '../../../services/userService.js';
import { showSettings } from '../../commands/settings.js';

/**
 * Обрабатывает callbacks настроек
 */
export const handleSettingsCallback = async (ctx: BotContext, data: string): Promise<void> => {
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
