import { BotContext } from '../../types/index.js';

/**
 * /feedback — открывает диалог сбора фидбэка от юзера
 * @module bot/commands/feedback
 */
export const handleFeedback = async (ctx: BotContext): Promise<void> => {
  await ctx.conversation.enter('feedback');
};
