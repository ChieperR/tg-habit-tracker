import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isFirstAchievementOfMilestone } from './achievementService.js';

type Event = { userId: number; scope: string; habitId: number | null; milestone: number };
const { events } = vi.hoisted(() => ({ events: [] as Event[] }));

vi.mock('../../db/index.js', () => ({
  prisma: {
    achievementEvent: {
      findMany: async ({ where }: { where: { userId: number; scope: string; milestone: { gte: number } } }) =>
        events
          .filter((e) => e.userId === where.userId && e.scope === where.scope && e.milestone >= where.milestone.gte)
          .map((e) => ({ milestone: e.milestone })),
    },
  },
}));

const add = (scope: string, milestone: number, habitId: number | null = null, userId = 1) =>
  events.push({ userId, scope, habitId, milestone });

describe('isFirstAchievementOfMilestone', () => {
  beforeEach(() => { events.length = 0; });

  it('только что записанный рубеж, других нет → первый', async () => {
    add('overall', 3);
    expect(await isFirstAchievementOfMilestone(1, 'overall', 3)).toBe(true);
  });

  it('рубеж 3 не записан, но были 5–100 → «3 дня» после перерыва не первые', async () => {
    for (const m of [5, 7, 14, 30, 60, 100]) add('overall', m);
    add('overall', 3);
    expect(await isFirstAchievementOfMilestone(1, 'overall', 3)).toBe(false);
  });

  it('per-habit: рубеж 3 уже был у другой привычки → не первый', async () => {
    add('habit', 3, 10);
    add('habit', 3, 11);
    expect(await isFirstAchievementOfMilestone(1, 'habit', 3)).toBe(false);
  });

  it('per-habit: у другой привычки был рубеж выше → не первый', async () => {
    add('habit', 15, 10);
    add('habit', 5, 11);
    expect(await isFirstAchievementOfMilestone(1, 'habit', 5)).toBe(false);
  });

  it('рубежи другой scope и другого юзера не мешают', async () => {
    add('habit', 30, 10);
    add('overall', 60, null, 2);
    add('overall', 7);
    expect(await isFirstAchievementOfMilestone(1, 'overall', 7)).toBe(true);
  });
});
