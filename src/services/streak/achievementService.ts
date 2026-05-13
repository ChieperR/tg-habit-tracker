/**
 * Учёт milestone-достижений (AchievementEvent) и early-adopter rank.
 *
 * **Идемпотентность:** unique constraint `[userId, scope, habitId, milestone]`
 * гарантирует, что одно и то же достижение нельзя записать дважды (на случай
 * callback retry'я или повторного нажатия кнопки).
 *
 * **Early-adopter rank** считается среди уникальных юзеров через
 * `COUNT(DISTINCT userId) FROM AchievementEvent WHERE scope=X AND habitId=Y
 * AND milestone=Z AND createdAt < this.createdAt`. Если rank ≤ 10, юзер в
 * первой десятке.
 *
 * @module services/streak/achievementService
 */

import { prisma } from '../../db/index.js';
import {
  EARLY_ADOPTER_TARGETS,
  EARLY_ADOPTER_RANK_CUTOFF,
  type MilestoneScope,
} from '../../data/milestoneTexts.js';

/**
 * Регистрирует достижение milestone'а. Идемпотентно — повторный вызов с теми же
 * параметрами не создаёт дубль.
 *
 * @returns true если создан новый AchievementEvent (первое достижение),
 * false если уже был.
 */
export const recordMilestone = async (
  userId: number,
  scope: MilestoneScope,
  habitId: number | null,
  milestone: number
): Promise<boolean> => {
  try {
    await prisma.achievementEvent.create({
      data: { userId, scope, habitId, milestone },
    });
    return true;
  } catch (error: unknown) {
    // Unique constraint violation → уже было достижение, возвращаем false
    const err = error as { code?: string };
    if (err?.code === 'P2002') return false;
    throw error;
  }
};

/**
 * Проверяет, является ли это достижение первым для юзера на (scope, milestone)
 * вне зависимости от habitId. Используется для firstOnly milestone-текстов.
 *
 * Для per-habit milestone'а: проверяет первый ли это раз когда юзер достигает
 * этого milestone'а ВООБЩЕ (с любой привычкой). То есть если на привычке X
 * есть 3-day streak первый раз, а раньше уже был 3-day streak с другой
 * привычкой — это не firstOnly.
 *
 * Для overall: первый ли раз юзер достигает этого overall milestone'а.
 */
export const isFirstAchievementOfMilestone = async (
  userId: number,
  scope: MilestoneScope,
  milestone: number
): Promise<boolean> => {
  const count = await prisma.achievementEvent.count({
    where: { userId, scope, milestone },
  });
  // Если только что записали (count=1) — это первый раз. Если count>1 — уже было.
  return count === 1;
};

/**
 * Проверяет применяется ли early-adopter bonus к данному milestone'у.
 */
export const isEarlyAdopterTarget = (
  scope: MilestoneScope,
  milestone: number
): boolean => {
  return EARLY_ADOPTER_TARGETS.some(
    (t) => t.scope === scope && t.milestone === milestone
  );
};

/**
 * Возвращает rank юзера в early-adopter лидерборде по (scope, milestone). Rank
 * считается среди уникальных юзеров: считаем сколько разных юзеров уже
 * получили это достижение РАНЕЕ + 1 = текущий rank.
 *
 * Должен вызываться сразу после `recordMilestone` (чтобы текущий юзер был учтён
 * как достигший).
 *
 * @returns rank число (1, 2, ..., N). Null если milestone не применим к
 * early-adopter bonus.
 */
export const getEarlyAdopterRank = async (
  userId: number,
  scope: MilestoneScope,
  habitId: number | null,
  milestone: number
): Promise<number | null> => {
  if (!isEarlyAdopterTarget(scope, milestone)) return null;

  // Получаем achievedAt текущего достижения юзера. Используем findFirst, т.к.
  // habitId может быть null (для overall), и compound unique с nullable
  // полем требует extras в типах Prisma.
  const myEvent = await prisma.achievementEvent.findFirst({
    where: { userId, scope, habitId, milestone },
    select: { achievedAt: true },
  });
  if (!myEvent) return null;

  // Считаем число уникальных юзеров которые достигли этого milestone'а РАНЕЕ
  // меня (по scope+milestone, не зависит от habitId — early-adopter трекается
  // глобально по типу milestone'а).
  const earlierEvents = await prisma.achievementEvent.findMany({
    where: {
      scope,
      milestone,
      achievedAt: { lt: myEvent.achievedAt },
      userId: { not: userId },
    },
    select: { userId: true },
    distinct: ['userId'],
  });

  return earlierEvents.length + 1;
};

/**
 * Проверяет rank ≤ EARLY_ADOPTER_RANK_CUTOFF (10).
 */
export const qualifiesForEarlyAdopterBonus = (rank: number | null): boolean => {
  return rank !== null && rank <= EARLY_ADOPTER_RANK_CUTOFF;
};
