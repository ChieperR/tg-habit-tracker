import { describe, it, expect } from 'vitest';
import { parse } from 'date-fns';
import { getScheduleLabel, wasHabitDueOnDate } from './weeklyService.js';

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
