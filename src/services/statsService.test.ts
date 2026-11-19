import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeCompletionRate, renderActivityGraph, getUserStats, formatStatsMessage, computeGraduatedStats } from './statsService.js';

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
  deletedDate: string | null;
  graduated?: boolean;
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
    deletedDate: isActive ? null : '2026-01-15',
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

  it('все привычки удалены: /stats показывает историю с зелёными днями', async () => {
    db.habits = [habit(1, false)];
    db.logs = [done(1, '2026-01-13'), done(1, '2026-01-14')];
    const msg = formatStatsMessage(await getUserStats(1, 180));
    expect(msg).not.toContain('Добавь первую');
    expect(msg).toContain('Активных привычек: *0*');
    expect(msg).toContain('Всего выполнений: *2*');
    expect(msg).toContain('Общий стрик активности: *2*');
    expect(msg).not.toContain('━━━');
    expect(countGreen(msg)).toBe(2);
  });

  it.each([
    ['привычек не было', [], []],
    ['удалённая без отметок', [habit(1, false)], []],
    ['удалённая только со снятой отметкой', [habit(1, false)], [{ habitId: 1, date: '2026-01-14', completed: false }]],
  ] as const)('нет выполнений (%s) → «Добавь первую»', async (_name, habits, logs) => {
    db.habits = [...habits];
    db.logs = [...logs];
    expect(formatStatsMessage(await getUserStats(1, 180))).toContain('Добавь первую');
  });

  it('общий стрик держится на отметках удалённой привычки', async () => {
    db.habits = [habit(1, false)];
    db.logs = [done(1, '2026-01-13'), done(1, '2026-01-14'), done(1, '2026-01-15')];
    const stats = await getUserStats(1, 180);
    expect(stats.overallStreak).toBe(3);
    expect(stats.totalCompletions).toBe(3);
  });
});


describe('внедрённая привычка', () => {
  const habit = {
    id: 9, userId: 1, name: 'Бег', emoji: '🏃', frequencyType: 'daily', frequencyDays: 1, weekdays: null,
    createdAt: new Date('2026-01-01T10:00:00Z'), isActive: false, deletedDate: '2026-01-12', graduated: true,
  };
  // 1–10 января, кроме 5-го.
  const logs = Array.from({ length: 10 }, (_, i) => i + 1)
    .filter((d) => d !== 5)
    .map((d) => ({ habitId: 9, date: `2026-01-${String(d).padStart(2, '0')}`, completed: true }));

  it('итог: выполнения, лучшая серия до дня завершения, дни в списке', () => {
    expect(computeGraduatedStats(habit, logs, [])).toEqual({
      name: 'Бег', emoji: '🏃', graduatedDate: '2026-01-12', totalCompleted: 9, maxStreak: 5, days: 12,
    });
  });

  it('заморозка в день завершения не удлиняет рекорд', () => {
    const lastFive = logs.filter((l) => l.date >= '2026-01-06');
    // 6–10 января подряд, 11-е заморожено, 12-го — завершение без отметки.
    expect(computeGraduatedStats({ ...habit, deletedDate: '2026-01-12' }, lastFive, [{ date: '2026-01-12' }]).maxStreak).toBe(5);
  });

  it('/stats показывает её в разделе «Внедрённые», не среди активных', async () => {
    db.habits = [habit];
    db.logs = logs;
    const stats = await getUserStats(1, 180);
    expect(stats.activeHabits).toBe(0);
    expect(stats.habitStats).toEqual([]);
    const text = formatStatsMessage(stats);
    expect(text).toContain('🏆 *Внедрённые*');
    expect(text).toContain('🏃 *Бег* — внедрена 12.01.2026, выполнений: 9, рекорд: 5 дн.');
  });
});
