import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deleteHabit } from './habitService.js';

const calls = vi.hoisted(() => ({ updateMany: [] as unknown[] }));

vi.mock('../db/index.js', () => ({
  prisma: {
    habit: {
      updateMany: async (args: unknown) => {
        calls.updateMany.push(args);
        return { count: 1 };
      },
    },
  },
}));

describe('deleteHabit', () => {
  beforeEach(() => {
    calls.updateMany.length = 0;
    vi.useFakeTimers();
    // 22:30 UTC = уже следующий день в UTC+3
    vi.setSystemTime(new Date('2026-01-14T22:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('пишет день удаления в часовом поясе юзера и не трогает уже удалённую', async () => {
    expect(await deleteHabit(7, 180)).toBe(true);
    expect(calls.updateMany).toEqual([
      { where: { id: 7, isActive: true }, data: { isActive: false, deletedDate: '2026-01-15' } },
    ]);
  });
});
