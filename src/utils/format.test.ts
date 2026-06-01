import { describe, it, expect } from 'vitest';
import { formatScheduleText } from './format.js';

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
