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

const TIME_RE = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;

/**
 * Разбирает ввод одного или нескольких времён через пробел, запятую или
 * точку с запятой: «9:00», «09:00, 14:00 20:30». Повторы схлопываются.
 *
 * @returns `{ times }` — нормализованные HH:MM по возрастанию, либо `{ error }`.
 */
export const parseReminderTimes = (raw: string): { times: string[] } | { error: string } => {
  const tokens = raw.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 0) return { error: 'Нужно время в формате ЧЧ:ММ.' };
  const times = new Set<string>();
  for (const token of tokens) {
    const m = TIME_RE.exec(token);
    if (!m) return { error: `«${token}» — не время. Нужен формат ЧЧ:ММ, например 07:30.` };
    times.add(`${m[1]!.padStart(2, '0')}:${m[2]}`);
  }
  return { times: [...times].sort((a, b) => a.localeCompare(b)) };
};
