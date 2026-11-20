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

/** Сколько эмодзи подряд можно поставить привычке. */
const MAX_HABIT_EMOJI_GRAPHEMES = 2;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Пиктограмма, флаг (региональные индикаторы) или кейкап вида 1️⃣. */
const EMOJI_GRAPHEME = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;

/**
 * Проверяет, что ввод — это эмодзи привычки: одна или две эмодзи-графемы
 * без другого текста. Графемы считаются целиком, поэтому проходят эмодзи с
 * вариационным селектором (❤️), с тоном кожи и ZWJ-последовательности (🏋️‍♂️).
 * Общее правило для создания (addHabit) и смены эмодзи (changeHabitEmoji).
 *
 * @returns Эмодзи без пробелов по краям или null, если это не эмодзи.
 */
export const parseHabitEmoji = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  const graphemes = Array.from(graphemeSegmenter.segment(value), (s) => s.segment);
  if (graphemes.length > MAX_HABIT_EMOJI_GRAPHEMES) return null;
  return graphemes.every((g) => EMOJI_GRAPHEME.test(g)) ? value : null;
};
