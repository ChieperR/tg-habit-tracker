import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse } from 'date-fns';
import { getScheduleLabel, wasHabitDueOnDate, computeWeekStates, getWeeklyData } from './weeklyService.js';

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
};
type MockLog = { habitId: number; date: string; completed: boolean };
type HabitWhere = {
  userId: number;
  OR: Array<{ isActive: boolean; deletedDate?: { gte: string } }>;
};

const db = vi.hoisted(() => ({ habits: [] as MockHabit[], logs: [] as MockLog[] }));

const matchesWhere = (h: MockHabit, where: HabitWhere): boolean =>
  h.userId === where.userId &&
  where.OR.some(
    (c) =>
      h.isActive === c.isActive &&
      (!c.deletedDate || (h.deletedDate !== null && h.deletedDate >= c.deletedDate.gte))
  );

vi.mock('../db/index.js', () => ({
  prisma: {
    habit: {
      findMany: async ({ where }: { where: HabitWhere }) => db.habits.filter((h) => matchesWhere(h, where)),
    },
    habitLog: {
      findMany: async ({ where }: { where: { habitId: { in: number[] }; date: { gte: string; lte: string } } }) =>
        db.logs.filter(
          (l) => where.habitId.in.includes(l.habitId) && l.completed && l.date >= where.date.gte && l.date <= where.date.lte
        ),
      groupBy: async ({ where }: { where: { habitId: { in: number[] } } }) =>
        where.habitId.in.map((habitId) => {
          const dates = db.logs.filter((l) => l.habitId === habitId && l.completed).map((l) => l.date).sort();
          return { habitId, _min: { date: dates[0] ?? null } };
        }),
    },
    freezeUsage: { findMany: async () => [] },
  },
}));

const toDate = (s: string): Date => parse(s, 'yyyy-MM-dd', new Date());

describe('getScheduleLabel', () => {
  it('daily → Ежедневно', () => {
    expect(getScheduleLabel({ frequencyType: 'daily', frequencyDays: 1, weekdays: null })).toBe('Ежедневно');
  });

  it('interval раз в 1 день → Ежедневно', () => {
    expect(getScheduleLabel({ frequencyType: 'interval', frequencyDays: 1, weekdays: null })).toBe('Ежедневно');
  });

  it('interval раз в N дней', () => {
    expect(getScheduleLabel({ frequencyType: 'interval', frequencyDays: 3, weekdays: null })).toBe('Раз в 3 дн.');
  });

  it('weekdays → дни недели', () => {
    expect(getScheduleLabel({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: '1,3,5' })).toBe('Пн, Ср, Пт');
  });

  it('weekdays сортирует по возрастанию (Вс=0 первым, в отличие от formatScheduleText)', () => {
    expect(getScheduleLabel({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: '0,1' })).toBe('Вс, Пн');
  });

  it('weekdays без расписания → тире', () => {
    expect(getScheduleLabel({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: null })).toBe('—');
  });
});

describe('wasHabitDueOnDate', () => {
  const dailyHabit = { frequencyType: 'daily', frequencyDays: 1, weekdays: null, createdAt: toDate('2026-01-01') };

  it('daily → всегда true', () => {
    expect(wasHabitDueOnDate(dailyHabit, '2026-01-05', null)).toBe(true);
  });

  it('interval по firstCompletionDate', () => {
    const h = { frequencyType: 'interval', frequencyDays: 3, weekdays: null, createdAt: toDate('2026-01-01') };
    expect(wasHabitDueOnDate(h, '2026-01-04', '2026-01-01')).toBe(true);
    expect(wasHabitDueOnDate(h, '2026-01-03', '2026-01-01')).toBe(false);
  });

  it('interval без firstCompletion использует createdAt как reference', () => {
    const h = { frequencyType: 'interval', frequencyDays: 3, weekdays: null, createdAt: toDate('2026-01-01') };
    expect(wasHabitDueOnDate(h, '2026-01-04', null)).toBe(true);
  });

  it('weekdays по дню недели', () => {
    const h = { frequencyType: 'weekdays', frequencyDays: 1, weekdays: '1', createdAt: toDate('2026-01-01') };
    expect(wasHabitDueOnDate(h, '2026-01-05', null)).toBe(true); // Mon
    expect(wasHabitDueOnDate(h, '2026-01-06', null)).toBe(false); // Tue
  });
});

describe('computeWeekStates: удалённая привычка', () => {
  const habit = {
    frequencyType: 'daily',
    frequencyDays: 1,
    weekdays: null,
    createdAt: toDate('2026-01-01'),
    deletedDate: '2026-01-08' as string | null,
  };

  it('до дня удаления — как обычно, с дня удаления — ⏸️, отметки остаются', () => {
    // неделя 05.01–11.01, удалена в четверг 08.01, в среду и в день удаления отмечена
    const states = computeWeekStates(habit, '2026-01-05', '2026-01-20', new Set(['2026-01-07', '2026-01-08']), new Set(), '2026-01-01');
    expect(states).toEqual(['missed', 'missed', 'done', 'done', 'off', 'off', 'off']);
  });

  it('текущая неделя: дни с дня удаления — ⏸️, а не ⚪', () => {
    const states = computeWeekStates(habit, '2026-01-05', '2026-01-08', new Set(['2026-01-07']), new Set(), '2026-01-01');
    expect(states).toEqual(['missed', 'missed', 'done', 'off', 'off', 'off', 'off']);
  });

  it('у активной привычки дни не обрезаются', () => {
    const states = computeWeekStates({ ...habit, deletedDate: null }, '2026-01-05', '2026-01-20', new Set(), new Set(), null);
    expect(states.every((s) => s === 'missed')).toBe(true);
  });
});

describe('getWeeklyData: удалённые привычки', () => {
  const habit = (id: number, name: string, deletedDate: string | null): MockHabit => ({
    id,
    userId: 1,
    name,
    emoji: '🏃',
    frequencyType: 'daily',
    frequencyDays: 1,
    weekdays: null,
    createdAt: toDate('2026-01-01'),
    isActive: deletedDate === null,
    deletedDate,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-20T09:00:00Z'));
    db.habits = [habit(1, 'Бег', '2026-01-08'), habit(2, 'Чтение', null)];
    db.logs = [{ habitId: 1, date: '2026-01-06', completed: true }];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('в неделе до удаления — строкой «(удалена)» после активных', async () => {
    const { text, rows } = await getWeeklyData(1, '2026-01-05', 180);
    expect(rows.map((r) => [r.name, r.deleted])).toEqual([['Чтение', false], ['Бег', true]]);
    expect(text).toContain('🏃 Бег (удалена)\n`🔴🟢🔴⏸️⏸️⏸️⏸️`');
  });

  it('в неделе после удаления её нет', async () => {
    const { rows } = await getWeeklyData(1, '2026-01-12', 180);
    expect(rows.map((r) => r.name)).toEqual(['Чтение']);
  });

  it('удалена в понедельник без отметки — в этой неделе её нет', async () => {
    db.habits = [habit(1, 'Бег', '2026-01-12'), habit(2, 'Чтение', null)];
    const { rows } = await getWeeklyData(1, '2026-01-12', 180);
    expect(rows.map((r) => r.name)).toEqual(['Чтение']);
  });
});
