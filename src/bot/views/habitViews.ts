import { InlineKeyboard } from 'grammy';
import { createHabitDetailsKeyboard, createHabitRemindersKeyboard, createTimesPerDayKeyboard } from '../keyboards/index.js';
import { MAX_TIMES_PER_DAY } from '../../services/habitService.js';
import { formatScheduleText } from '../../utils/format.js';
import { escapeMarkdown } from '../../utils/telegram.js';
import { MAX_HABIT_REMINDERS } from '../../services/reminder/habitReminderSlots.js';

/**
 * Экраны настроек привычки: детали и список напоминаний. Общие для
 * callback-обработчиков (правят сообщение) и диалогов (шлют новое).
 * @module bot/views/habitViews
 */

/** Текст и клавиатура экрана. */
export type HabitView = { text: string; keyboard: InlineKeyboard };

type ViewHabit = {
  id: number;
  name: string;
  emoji: string;
  frequencyType: string;
  frequencyDays: number;
  weekdays: string | null;
  timesPerDay: number;
};

/** Строка про напоминания в деталях привычки. */
const formatReminderLine = (times: string[]): string => {
  if (times.length === 0) return '⏰ Напоминание: _не установлено_';
  if (times.length === 1) return `⏰ Напоминание: *${times[0]}*`;
  return `⏰ Напоминания: *${times.join(', ')}*`;
};

/**
 * Экран деталей привычки: расписание, напоминания и кнопки настроек.
 * @param habit - Привычка
 * @param times - Времена напоминаний по возрастанию
 */
export const buildHabitDetailsView = (habit: ViewHabit, times: string[]): HabitView => ({
  text: [
    `⚙️ *${habit.emoji} ${escapeMarkdown(habit.name)}*`,
    '',
    `📅 Расписание: _${formatScheduleText(habit)}_`,
    formatReminderLine(times),
  ].join('\n'),
  keyboard: createHabitDetailsKeyboard({
    habitId: habit.id,
    reminderCount: times.length,
    timesPerDay: habit.timesPerDay,
  }),
});

/**
 * Экран «сколько раз в день».
 * @param habit - Привычка
 */
export const buildTimesPerDayView = (
  habit: Pick<ViewHabit, 'id' | 'name' | 'emoji' | 'timesPerDay'>
): HabitView => {
  const lines = [
    `🔁 *Сколько раз в день: ${habit.emoji} ${escapeMarkdown(habit.name)}*`,
    '',
    'Если привычку выполняешь несколько раз за день, например таблетки утром и вечером, выбери сколько. Каждое нажатие ✅ добавляет одну отметку, день засчитывается, когда отмечены все.',
    '',
    'Чтобы бот напоминал про каждый раз, поставь несколько напоминаний: кнопка ⏰ в настройках привычки.',
  ];
  return {
    text: lines.join('\n'),
    keyboard: createTimesPerDayKeyboard(habit.id, habit.timesPerDay, MAX_TIMES_PER_DAY),
  };
};

/**
 * Экран списка напоминаний привычки.
 * @param habit - Привычка
 * @param reminders - Напоминания по возрастанию времени
 */
export const buildHabitRemindersView = (
  habit: Pick<ViewHabit, 'id' | 'name' | 'emoji'>,
  reminders: { id: number; time: string }[]
): HabitView => ({
  text: [
    `⏰ *Напоминания: ${habit.emoji} ${escapeMarkdown(habit.name)}*`,
    '',
    `Приходят в эти часы, пока привычка не отмечена за день. Можно до ${MAX_HABIT_REMINDERS} в день.`,
  ].join('\n'),
  keyboard: createHabitRemindersKeyboard(habit.id, reminders, MAX_HABIT_REMINDERS),
});
