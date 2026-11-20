import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deleteHabit, nextMarkCount } from './habitService.js';

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

describe('nextMarkCount', () => {
  it('cycle: +1 до полного дня, потом сброс; при одном разе — прежнее отметить/снять', () => {
    expect([0, 1, 2].map((c) => nextMarkCount(c, 2, 'cycle'))).toEqual([1, 2, 0]);
    expect([0, 1].map((c) => nextMarkCount(c, 1, 'cycle'))).toEqual([1, 0]);
  });

  it('add не выходит за target, remove не уходит ниже нуля', () => {
    expect(nextMarkCount(2, 2, 'add')).toBe(2);
    // Цель снизили ниже уже поставленных отметок — добавление их не срезает.
    expect(nextMarkCount(3, 2, 'add')).toBe(3);
    expect(nextMarkCount(1, 2, 'add')).toBe(2);
    expect(nextMarkCount(0, 2, 'remove')).toBe(0);
    expect(nextMarkCount(2, 2, 'remove')).toBe(1);
  });
});
