import { BotContext } from '../../../types/index.js';
import { safeEditMessage } from '../../../utils/telegram.js';
import { createMainMenuKeyboard } from '../../keyboards/index.js';

/**
 * Показывает главное меню
 */
export const showMainMenu = async (ctx: BotContext): Promise<void> => {
  const message = `
🏠 *Главное меню*

Выбери действие:
  `.trim();

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createMainMenuKeyboard(),
  });
};
