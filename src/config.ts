/**
 * Конфигурация бота
 * @module config
 */

/**
 * Telegram ID администратора бота. Источник истины — `.env` (`ADMIN_CHAT_ID`),
 * с fallback на исторический хардкод для случая когда env не задан. Один
 * источник, чтобы при смене админа править в одном месте.
 */
export const ADMIN_TELEGRAM_ID = parseInt(
  process.env.ADMIN_CHAT_ID ?? '385304518',
  10
);
