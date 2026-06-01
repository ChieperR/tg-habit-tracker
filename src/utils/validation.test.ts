import { describe, it, expect } from 'vitest';
import { validateHabitName, MAX_HABIT_NAME_LENGTH } from './validation.js';

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
