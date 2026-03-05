import { BotContext } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { prisma } from '../../db/index.js';
import { CHANGELOG, LATEST_CHANGELOG_ID } from '../../changelog.js';

/**
 * Обработчик команды /changelog — показывает новые обновления бота
 * @module bot/commands/changelog
 */

/**
 * Показывает список новых обновлений бота с момента последнего просмотра.
 * После показа обновляет lastSeenChangelog пользователя.
 * @param ctx - Контекст бота
 */
export const handleChangelog = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply('❌ Не удалось определить пользователя');
    return;
  }

  const user = await findOrCreateUser(telegramId);
  const allNew = CHANGELOG.filter((e) => e.id > user.lastSeenChangelog).reverse();
  const newEntries = allNew.slice(0, 10);
  const hasMore = allNew.length > 10;

  let message: string;
  if (newEntries.length === 0) {
    message = 'Ты в курсе всех обновлений! ✅\n\nПрошлые обновления ищи по #changelog ⬆️';
  } else {
    message = '📋 *Обновления бота:*\n\n';
    for (const entry of newEntries) {
      const [y, m, d] = entry.date.split('-');
      message += `• ${entry.text} _${d}.${m}.${y}_\n`;
    }
    if (hasMore) {
      message += `\n_...и ещё ${allNew.length - 10} обновлений_\n`;
    }
    message += '\n#changelog';
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });

  // Обновляем lastSeenChangelog (только если есть новые записи)
  if (newEntries.length > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenChangelog: LATEST_CHANGELOG_ID },
    });
  }
};
