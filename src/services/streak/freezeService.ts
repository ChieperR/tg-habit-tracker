/**
 * Логика заморозок стрика: earn/spend/refund.
 *
 * **Правила (одобрено Эмином 2026-05-13):**
 * - Стартовый запас: 0
 * - Earn: +1 за каждые 5 дней overall-стрика (checkpoint: 5, 10, 15, ...)
 * - Max в инвентаре: 2 (на cap'е новый earn не доставляет уведомление, не
 *   инкрементирует, но обновляет checkpoint чтобы следующий earn ждал нового
 *   roll'а по 5)
 * - Spend (auto): при пропуске вчерашнего due-дня в утреннем cron'е
 * - Refund: при backdating ранее замороженного дня
 *
 * @module services/streak/freezeService
 */

import { prisma } from '../../db/index.js';

/** Максимум заморозок в инвентаре. */
export const FREEZE_CAP = 2;

/** Интервал в днях overall-стрика для earn'а одной заморозки. */
export const FREEZE_EARN_INTERVAL_DAYS = 5;

/** Результат вызова `tryEarnFreezes`. */
export type EarnResult =
  | { kind: 'earned'; newCount: number }
  | { kind: 'cap_reached'; currentCount: number }
  | { kind: 'no_earn' };

/**
 * Получает количество freeze в инвентаре юзера.
 */
export const getFreezeCount = async (userId: number): Promise<number> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { freezeCount: true },
  });
  return user?.freezeCount ?? 0;
};

/**
 * Пытается начислить freeze на основании текущего overall-стрика юзера.
 *
 * Логика:
 * - Если overall стрик пересек очередной checkpoint (lastFreezeEarnStreakDay +
 *   FREEZE_EARN_INTERVAL_DAYS), пытаемся начислить.
 * - Если на cap'е (freezeCount >= FREEZE_CAP) — checkpoint обновляется (чтобы
 *   ждать следующего roll'а), но инкремента и уведомления нет.
 * - Иначе freezeCount++ и checkpoint обновляется до текущего стрика.
 *
 * Должна вызываться после успешного habit_toggle, когда overall streak
 * пересчитан и зафиксирован.
 *
 * @param userId ID юзера в БД
 * @param currentOverallStreak Текущий overall стрик (после новой отметки)
 * @returns Результат с типом 'earned' / 'cap_reached' / 'no_earn'
 */
export const tryEarnFreezes = async (
  userId: number,
  currentOverallStreak: number
): Promise<EarnResult> => {
  // Всё read-modify-write в одной транзакции, чтобы избежать race condition
  // между параллельными callback'ами/cron'ом (SQLite single-writer обычно
  // защищает, но Prisma может interleave на JS-уровне).
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { freezeCount: true, lastFreezeEarnStreakDay: true },
    });
    if (!user) return { kind: 'no_earn' } as EarnResult;

    // Если стрик упал ниже последнего checkpoint'а — стрик был сломан.
    // Сбрасываем checkpoint в 0, чтобы новый цикл из 5 дней снова мог
    // давать freeze.
    let effectiveCheckpoint = user.lastFreezeEarnStreakDay;
    if (currentOverallStreak < effectiveCheckpoint) {
      effectiveCheckpoint = 0;
      await tx.user.update({
        where: { id: userId },
        data: { lastFreezeEarnStreakDay: 0 },
      });
    }

    const nextCheckpoint = effectiveCheckpoint + FREEZE_EARN_INTERVAL_DAYS;
    if (currentOverallStreak < nextCheckpoint) {
      return { kind: 'no_earn' } as EarnResult;
    }

    // Последний достигнутый checkpoint (кратный 5 и не выше текущего streak'а).
    const achievedCheckpoint =
      Math.floor(currentOverallStreak / FREEZE_EARN_INTERVAL_DAYS) * FREEZE_EARN_INTERVAL_DAYS;

    if (user.freezeCount >= FREEZE_CAP) {
      // На cap'е — обновляем checkpoint без инкремента и без уведомления.
      await tx.user.update({
        where: { id: userId },
        data: { lastFreezeEarnStreakDay: achievedCheckpoint },
      });
      return { kind: 'cap_reached', currentCount: user.freezeCount } as EarnResult;
    }

    const newCount = user.freezeCount + 1;
    await tx.user.update({
      where: { id: userId },
      data: {
        freezeCount: newCount,
        lastFreezeEarnStreakDay: achievedCheckpoint,
      },
    });
    return { kind: 'earned', newCount } as EarnResult;
  });
};

/**
 * Auto-spend freeze для покрытия пропущенного дня. Создаёт FreezeUsage запись и
 * декрементирует freezeCount. Идемпотентно: если на эту дату уже есть FreezeUsage
 * для юзера — ничего не делает.
 *
 * @returns Объект с newCount (freeze в инвентаре после списания) или null если
 * списание не произошло (нет freeze или дата уже покрыта).
 */
export const autoSpendFreeze = async (
  userId: number,
  date: string
): Promise<{ newCount: number } | null> => {
  // Read-modify-write в одной транзакции (avoid race с параллельным cron'ом).
  return prisma.$transaction(async (tx) => {
    const existing = await tx.freezeUsage.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (existing) return null;

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { freezeCount: true },
    });
    if (!user || user.freezeCount <= 0) return null;

    const newCount = user.freezeCount - 1;
    await tx.user.update({
      where: { id: userId },
      data: { freezeCount: newCount },
    });
    await tx.freezeUsage.create({
      data: { userId, date, reason: 'auto_miss' },
    });
    return { newCount };
  });
};

/**
 * Возвращает freeze в инвентарь при backdating ранее замороженного дня.
 * Удаляет FreezeUsage запись и инкрементит freezeCount (с cap'ом).
 *
 * @returns true если refund произошёл (был frozen day и удалён), иначе false.
 */
export const refundFreeze = async (userId: number, date: string): Promise<boolean> => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.freezeUsage.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!existing) return false;

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { freezeCount: true },
    });
    if (!user) return false;

    // Cap при refund'е: если уже на cap'е — freeze не возвращается (теряется,
    // но FreezeUsage всё равно удаляется, чтоб день стал ✅).
    // На практике редкий кейс: cap=2, юзер сделал backdating дня, но недавно
    // успел заработать новые freeze'ы. Так задизайнено — cap есть cap.
    const newCount = Math.min(user.freezeCount + 1, FREEZE_CAP);

    await tx.freezeUsage.delete({
      where: { userId_date: { userId, date } },
    });
    await tx.user.update({
      where: { id: userId },
      data: { freezeCount: newCount },
    });
    return true;
  });
};

/**
 * Получает все FreezeUsage записи юзера. Для использования в calculator.
 */
export const getUserFreezeUsages = async (
  userId: number
): Promise<{ date: string }[]> => {
  return prisma.freezeUsage.findMany({
    where: { userId },
    select: { date: true },
  });
};
