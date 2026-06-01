import { describe, it, expect } from 'vitest';
import { parse } from 'date-fns';
import {
  evaluateMorningTrigger,
  evaluateEveningTrigger,
  evaluatePerHabitTrigger,
  type EvaluatorContext,
} from './triggerEvaluator.js';
import type { StreakHabit, StreakHabitLog, StreakFreezeUsage } from './calculator.js';

const toDate = (s: string): Date => parse(s, 'yyyy-MM-dd', new Date());

const daily = (id: number, createdAt: string, isActive = true): StreakHabit => ({
  id,
  frequencyType: 'daily',
  frequencyDays: 1,
  weekdays: null,
  createdAt: toDate(createdAt),
  isActive,
});

const log = (habitId: number, date: string, completed = true): StreakHabitLog => ({ habitId, date, completed });
const freeze = (date: string): StreakFreezeUsage => ({ date });

const ctxOf = (over: Partial<EvaluatorContext>): EvaluatorContext => ({
  habits: [],
  logs: [],
  freezeUsages: [],
  todayDate: '2026-01-10',
  currentFreezeCount: 0,
  ...over,
});

describe('evaluatePerHabitTrigger', () => {
  const h = daily(1, '2026-01-01');

  it('вчера на due-дне выполнено → normal', () => {
    expect(evaluatePerHabitTrigger(h, [log(1, '2026-01-09')], '2026-01-10')).toBe('normal');
  });

  it('вчера пропущено → habit_missed_1_day', () => {
    expect(evaluatePerHabitTrigger(h, [log(1, '2026-01-08')], '2026-01-10')).toBe('habit_missed_1_day');
  });

  it('два дня пропущено → habit_missed_n_days', () => {
    expect(evaluatePerHabitTrigger(h, [log(1, '2026-01-07')], '2026-01-10')).toBe('habit_missed_n_days');
  });
});

describe('evaluateMorningTrigger', () => {
  it('freeze вчера → normal + overlay freeze_used', () => {
    const ctx = ctxOf({
      habits: [daily(1, '2026-01-01')],
      freezeUsages: [freeze('2026-01-09')],
      currentFreezeCount: 2,
    });
    const result = evaluateMorningTrigger(ctx);
    expect(result.replacing).toBe('normal');
    expect(result.overlays).toContainEqual({ kind: 'freeze_used', remainingCount: 2 });
  });

  it('пропущенные дни дают missed-bucket', () => {
    const ctx = ctxOf({
      habits: [daily(1, '2026-01-01')],
      logs: [log(1, '2026-01-07')], // 01-09, 01-08 пропущены
    });
    expect(evaluateMorningTrigger(ctx).replacing).toBe('missed_2_days');
  });

  it('normal + near_milestone_overall когда стрик в шаге от рубежа', () => {
    // overall стрик на вчера = 2 → near 3 (OVERALL_MILESTONES содержит 3)
    const ctx = ctxOf({
      habits: [daily(1, '2026-01-01')],
      logs: [log(1, '2026-01-08'), log(1, '2026-01-09')],
    });
    const result = evaluateMorningTrigger(ctx);
    expect(result.replacing).toBe('normal');
    expect(result.overlays).toContainEqual({ kind: 'near_milestone_overall', milestone: 3 });
  });

  it('perfect_week_ahead overlay когда 6 дней подряд perfect', () => {
    const ctx = ctxOf({
      habits: [daily(1, '2026-01-01')],
      logs: [
        log(1, '2026-01-04'), log(1, '2026-01-05'), log(1, '2026-01-06'),
        log(1, '2026-01-07'), log(1, '2026-01-08'), log(1, '2026-01-09'),
      ],
    });
    const result = evaluateMorningTrigger(ctx);
    expect(result.overlays).toContainEqual({ kind: 'perfect_week_ahead' });
  });
});

describe('evaluateEveningTrigger', () => {
  it('все due сегодня выполнены → all_completed', () => {
    const ctx = ctxOf({
      habits: [daily(1, '2026-01-01')],
      logs: [log(1, '2026-01-10')],
    });
    expect(evaluateEveningTrigger(ctx).replacing).toBe('all_completed');
  });

  it('не все выполнены, вчера ок → normal', () => {
    const ctx = ctxOf({
      habits: [daily(1, '2026-01-01')],
      logs: [log(1, '2026-01-09')], // сегодня не отмечено
    });
    expect(evaluateEveningTrigger(ctx).replacing).toBe('normal');
  });

  it('freeze_used overlay НЕ показывается в evening', () => {
    const ctx = ctxOf({
      habits: [daily(1, '2026-01-01')],
      freezeUsages: [freeze('2026-01-09')],
      currentFreezeCount: 2,
    });
    const result = evaluateEveningTrigger(ctx);
    expect(result.overlays.some((o) => o.kind === 'freeze_used')).toBe(false);
  });

  it('пропущенные дни → missed-bucket', () => {
    const ctx = ctxOf({
      habits: [daily(1, '2026-01-01')],
      logs: [log(1, '2026-01-06')], // 01-09,08,07 пропущены = 3
    });
    expect(evaluateEveningTrigger(ctx).replacing).toBe('missed_3_days');
  });
});
