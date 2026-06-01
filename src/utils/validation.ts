/**
 * Валидация пользовательского ввода.
 * @module utils/validation
 */

/** Максимальная длина названия привычки. Общая для создания и переименования. */
export const MAX_HABIT_NAME_LENGTH = 100;

/**
 * Валидирует и нормализует название привычки. Единое правило для создания
 * (addHabit) и переименования (renameHabit), чтобы нельзя было создать имя,
 * которое потом нельзя ввести при ренейме.
 *
 * @returns `{ name }` с обрезанным именем, либо `{ error }` с текстом причины.
 */
export const validateHabitName = (raw: string): { name: string } | { error: string } => {
  const name = raw.trim();
  if (!name) return { error: 'Название не должно быть пустым.' };
  if (name.startsWith('/')) return { error: 'Название не может начинаться с «/» — это команда.' };
  if (name.length > MAX_HABIT_NAME_LENGTH) {
    return { error: `Слишком длинное название (макс ${MAX_HABIT_NAME_LENGTH} символов).` };
  }
  return { name };
};
