import { describe, it, expect } from 'vitest';
import { formatScheduleText, formatTimesPerDay, formatDayProgress } from './format.js';

describe('formatScheduleText', () => {
  it('daily → ежедневно', () => {
    expect(formatScheduleText({ frequencyType: 'daily', frequencyDays: 1, weekdays: null })).toBe('ежедневно');
  });

  it('interval → раз в N дн.', () => {
    expect(formatScheduleText({ frequencyType: 'interval', frequencyDays: 3, weekdays: null })).toBe('раз в 3 дн.');
  });

  it('weekdays → дни через запятую', () => {
    expect(formatScheduleText({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: '1,3,5' })).toBe('Пн, Ср, Пт');
  });

  it('weekdays — воскресенье (0) сортируется в конец недели', () => {
    expect(formatScheduleText({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: '0,1' })).toBe('Пн, Вс');
  });

  it('weekdays без расписания → пустая строка', () => {
    expect(formatScheduleText({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: null })).toBe('');
  });

  it('неизвестный тип → пустая строка', () => {
    expect(formatScheduleText({ frequencyType: 'whatever', frequencyDays: 1, weekdays: null })).toBe('');
  });
});

describe('несколько раз в день', () => {
  it('formatTimesPerDay склоняет', () => {
    expect(formatTimesPerDay(2)).toBe('2 раза в день');
    expect(formatTimesPerDay(5)).toBe('5 раз в день');
  });

  it('formatDayProgress пустой для одного раза', () => {
    expect(formatDayProgress(1, 1)).toBe('');
    expect(formatDayProgress(1, 2)).toBe('1/2');
  });

  it('formatScheduleText дописывает число раз', () => {
    expect(formatScheduleText({ frequencyType: 'daily', frequencyDays: 1, weekdays: null, timesPerDay: 2 })).toBe('ежедневно, 2 раза в день');
    expect(formatScheduleText({ frequencyType: 'daily', frequencyDays: 1, weekdays: null, timesPerDay: 1 })).toBe('ежедневно');
  });
});
