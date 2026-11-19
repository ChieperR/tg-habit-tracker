import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeCompletionRate, renderActivityGraph, getUserStats } from './statsService.js';

type MockHabit = {
  id: number;
  userId: number;
  name: string;
  emoji: string;
  frequencyType: string;
  frequencyDays: number;
  weekdays: string | null;
  createdAt: Date;
  isActive: boolean;
};
type MockLog = { habitId: number; date: string; completed: boolean };

const db = vi.hoisted(() => ({ habits: [] as MockHabit[], logs: [] as MockLog[] }));

vi.mock('../db/index.js', () => ({
  prisma: {
    user: { findUnique: async () => ({ freezeCount: 0, freezeEnabled: true }) },
    habit: { findMany: async () => db.habits },
    habitLog: { findMany: async () => db.logs },
    freezeUsage: { findMany: async () => [] },
  },
}));

describe('computeCompletionRate', () => {
  const days10 = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);

  it('daily: 5 из 10 → 50%', () => {
    const logs = days10.slice(0, 5).map((d) => ({ date: d, completed: true }));
    expect(computeCompletionRate(logs, 1, days10)).toBe(50);
  });

  it('interval раз в 2 дня: ожидается 5, выполнено 5 → 100%', () => {
    const logs = days10.slice(0, 5).map((d) => ({ date: d, completed: true }));
    expect(computeCompletionRate(logs, 2, days10)).toBe(100);
  });

  it('переотметка может дать > 100%', () => {
    const logs = days10.map((d) => ({ date: d, completed: true }));
    expect(computeCompletionRate(logs, 2, days10)).toBe(200);
  });

  it('пустое окно → 100%', () => {
    expect(computeCompletionRate([], 1, [])).toBe(100);
  });

  it('completion вне окна не учитывается', () => {
    const logs = [{ date: '2025-12-01', completed: true }];
    expect(computeCompletionRate(logs, 1, days10)).toBe(0);
  });

  it('невыполненные логи не считаются', () => {
    const logs = days10.map((d) => ({ date: d, completed: false }));
    expect(computeCompletionRate(logs, 1, days10)).toBe(0);
  });
});

describe('renderActivityGraph', () => {
  it('содержит заголовок и легенду', () => {
    const graph = renderActivityGraph(new Set(), '2026-01-15');
    expect(graph).toContain('Активность');
    expect(graph).toContain('🟩 — выполнено');
  });

  // Легенда всегда содержит один 🟩 — поэтому считаем вхождения, а не наличие.
  const countGreen = (s: string): number => (s.match(/🟩/gu) ?? []).length;

  it('активная дата добавляет 🟩 в сетку (сверх легенды)', () => {
    const empty = countGreen(renderActivityGraph(new Set(), '2026-01-15'));
    const withActive = countGreen(renderActivityGraph(new Set(['2026-01-15']), '2026-01-15'));
    expect(empty).toBe(1); // только легенда
    expect(withActive).toBeGreaterThan(empty);
  });

  it('без активных дат сетка состоит из ⬜', () => {
    expect(renderActivityGraph(new Set(), '2026-01-15')).toContain('⬜');
  });
});

describe('getUserStats: удалённые привычки', () => {
  const habit = (id: number, isActive: boolean): MockHabit => ({
    id,
    userId: 1,
    name: `h${id}`,
    emoji: '🏃',
    frequencyType: 'daily',
    frequencyDays: 1,
    weekdays: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    isActive,
  });
  const done = (habitId: number, date: string): MockLog => ({ habitId, date, completed: true });
  const countGreen = (s: string): number => (s.match(/🟩/gu) ?? []).length - 1;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T09:00:00Z'));
    db.habits = [];
    db.logs = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('отметки удалённой привычки красят свои дни в графике', async () => {
    db.habits = [habit(1, false), habit(2, true)];
    db.logs = [done(1, '2026-01-12'), done(1, '2026-01-13'), done(2, '2026-01-14')];
    const stats = await getUserStats(1, 180);
    expect(countGreen(stats.activityGraph)).toBe(3);
  });

  it('удалённая привычка не попадает в список привычек статистики', async () => {
    db.habits = [habit(1, false), habit(2, true)];
    db.logs = [done(1, '2026-01-14')];
    const stats = await getUserStats(1, 180);
    expect(stats.habitStats.map((h) => h.habitId)).toEqual([2]);
    expect(stats.activeHabits).toBe(1);
  });

  it('общий стрик держится на отметках удалённой привычки', async () => {
    db.habits = [habit(1, false)];
    db.logs = [done(1, '2026-01-13'), done(1, '2026-01-14'), done(1, '2026-01-15')];
    const stats = await getUserStats(1, 180);
    expect(stats.overallStreak).toBe(3);
    expect(stats.totalCompletions).toBe(3);
  });
});
