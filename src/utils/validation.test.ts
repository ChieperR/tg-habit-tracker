import { describe, it, expect } from 'vitest';
import { validateHabitName, parseHabitEmoji, parseReminderTimes, MAX_HABIT_NAME_LENGTH } from './validation.js';

describe('validateHabitName', () => {
  it('обрезает пробелы и принимает нормальное имя', () => {
    expect(validateHabitName('  Бег  ')).toEqual({ name: 'Бег' });
  });

  it('пустое (или из пробелов) → ошибка', () => {
    expect(validateHabitName('   ')).toHaveProperty('error');
    expect(validateHabitName('')).toHaveProperty('error');
  });

  it('начинается с / → ошибка (команда)', () => {
    expect(validateHabitName('/start')).toHaveProperty('error');
  });

  it(`длиннее ${MAX_HABIT_NAME_LENGTH} → ошибка`, () => {
    expect(validateHabitName('x'.repeat(MAX_HABIT_NAME_LENGTH + 1))).toHaveProperty('error');
  });

  it(`ровно ${MAX_HABIT_NAME_LENGTH} → ок`, () => {
    const name = 'x'.repeat(MAX_HABIT_NAME_LENGTH);
    expect(validateHabitName(name)).toEqual({ name });
  });
});

describe('parseHabitEmoji', () => {
  it('принимает обычный эмодзи и обрезает пробелы', () => {
    expect(parseHabitEmoji(' 🏃 ')).toBe('🏃');
  });

  it('принимает эмодзи с вариационным селектором, тоном кожи, ZWJ и флаги', () => {
    for (const e of ['❤️', '✍️', '👍🏽', '🏋️‍♂️', '👨‍👩‍👧', '🇷🇺', '1️⃣']) {
      expect(parseHabitEmoji(e)).toBe(e);
    }
  });

  it('принимает два эмодзи подряд', () => {
    expect(parseHabitEmoji('💪🔥')).toBe('💪🔥');
  });

  it('три эмодзи и больше — нет', () => {
    expect(parseHabitEmoji('💪🔥🏃')).toBeNull();
  });

  it('текст, цифры, смесь с текстом и пустой ввод — нет', () => {
    for (const s of ['бег', 'a', '5', '🏃 бег', '🏃a', '', '   ']) {
      expect(parseHabitEmoji(s)).toBeNull();
    }
  });
});

describe('parseReminderTimes', () => {
  it('одно время, нормализует часы', () => {
    expect(parseReminderTimes(' 9:00 ')).toEqual({ times: ['09:00'] });
  });

  it('несколько через запятую и пробелы, сортирует и убирает повторы', () => {
    expect(parseReminderTimes('20:30, 9:00 14:00;09:00')).toEqual({ times: ['09:00', '14:00', '20:30'] });
  });

  it('ошибка на неверном времени и на пустом вводе', () => {
    expect(parseReminderTimes('9:00, 25:00')).toHaveProperty('error');
    expect(parseReminderTimes('завтра')).toHaveProperty('error');
    expect(parseReminderTimes('  ')).toHaveProperty('error');
  });
});
