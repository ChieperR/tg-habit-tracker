import { trackEvent } from '../analyticsService.js';

/** Описания ошибок Telegram, при которых не нужно повторять отправку */
const UNDELIVERABLE_ERRORS = [
  'bot was blocked by the user',
  'chat not found',
  'user is deactivated',
  'PEER_ID_INVALID',
  'bot can\'t initiate conversation',
];

/** Множество userId, для которых уже зафиксирован bot_blocked за текущий запуск cron */
const blockedTrackedThisRun = new Set<number>();

/**
 * Сбрасывает дедупликацию bot_blocked (вызывать в начале каждого cron-цикла)
 */
export const resetBlockedTracking = (): void => {
  blockedTrackedThisRun.clear();
};

/**
 * Проверяет, является ли ошибка Telegram штатной (юзер заблокировал/удалился).
 * Если да — тихо логирует вместо полного стектрейса.
 * Трекает bot_blocked максимум раз за cron-цикл на юзера.
 * @returns true если ошибка штатная (обработана), false если неизвестная
 */
export const handleDeliveryError = (error: unknown, telegramId: bigint, userId?: number): boolean => {
  const desc = (error as { description?: string })?.description ?? '';
  const isUndeliverable = UNDELIVERABLE_ERRORS.some((e) => desc.includes(e));

  if (isUndeliverable) {
    console.log(`[reminder] Юзер ${telegramId} недоступен: ${desc}`);
    if (userId && !blockedTrackedThisRun.has(userId)) {
      blockedTrackedThisRun.add(userId);
      void trackEvent(userId, 'bot_blocked', { reason: desc });
    }
    return true;
  }

  return false;
};
