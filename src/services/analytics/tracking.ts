import { prisma } from '../../db/index.js';

/** Типы аналитических событий */
export type AnalyticsEventType = 'start' | 'start_returning' | 'checkin' | 'habit_create' | 'habit_delete' | 'reminder_sent' | 'bot_blocked' | 'view_habits' | 'view_stats';

/**
 * Записывает аналитическое событие и обновляет lastActiveAt пользователя.
 * Обрабатывает ошибки внутри — безопасно вызывать без await (fire-and-forget).
 * @param userId - ID пользователя в БД
 * @param type - Тип события
 * @param metadata - Дополнительные данные
 */
export const trackEvent = async (
  userId: number,
  type: AnalyticsEventType,
  metadata?: Record<string, unknown>
): Promise<void> => {
  try {
    // bot_blocked и reminder_sent — не пользовательские действия, не обновляем lastActiveAt
    const isPassiveEvent = type === 'bot_blocked' || type === 'reminder_sent';

    const ops = [
      prisma.analyticsEvent.create({
        data: {
          userId,
          type,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      }),
      ...(!isPassiveEvent
        ? [prisma.user.update({
            where: { id: userId },
            data: { lastActiveAt: new Date() },
          })]
        : []),
    ];

    await prisma.$transaction(ops);
  } catch (err) {
    console.error('[analytics] trackEvent error:', err);
  }
};
