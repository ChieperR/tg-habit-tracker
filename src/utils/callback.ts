import { CallbackAction } from '../types/index.js';

/**
 * Утилиты для работы с callback data
 * @module utils/callback
 */

/**
 * Сериализует действие в строку callback data
 * @param action - Объект действия
 * @returns Строка для callback_data
 */
export const serializeCallback = (action: CallbackAction): string => {
  switch (action.type) {
    case 'habits_list':
      return 'h:list';
    case 'habit_add':
      return 'h:add';
    case 'habits_day':
      return `h:day:${action.date}`;
    case 'habit_toggle':
      if (action.source === 'evening_reminder') return `h:tog:${action.habitId}:er`;
      if (action.date) return `h:tog:${action.habitId}:${action.date}`;
      return `h:tog:${action.habitId}`;
    case 'habit_delete':
      return `h:del:${action.habitId}`;
    case 'habit_confirm_delete':
      return `h:cdel:${action.habitId}`;
    case 'habit_details':
      return `h:det:${action.habitId}`;
    case 'stats':
      return 's:main';
    case 'weekly_show':
      return action.weekStart ? `s:week:${action.weekStart}` : 's:week';
    case 'weekly_prev':
      return `s:week:prev:${action.weekStart}`;
    case 'weekly_next':
      return `s:week:next:${action.weekStart}`;
    case 'settings':
      return 'set:main';
    case 'settings_morning':
      return `set:mor:${action.time}`;
    case 'settings_evening':
      return `set:eve:${action.time}`;
    case 'settings_reminders_toggle':
      return 'set:rem';
    case 'back_to_menu':
      return 'menu';
    case 'save_day':
      return 'save';
    case 'noop':
      return 'noop';
  }
};

/**
 * Десериализует строку callback data в действие
 * @param data - Строка callback_data
 * @returns Объект действия или null если не распознано
 */
export const parseCallback = (data: string): CallbackAction | null => {
  const parts = data.split(':');
  const prefix = parts[0];

  switch (prefix) {
    case 'h': {
      const subAction = parts[1];
      switch (subAction) {
        case 'list':
          return { type: 'habits_list' };
        case 'add':
          return { type: 'habit_add' };
        case 'day': {
          const date = parts[2];
          if (!date) return null;
          return { type: 'habits_day', date };
        }
        case 'tog': {
          const habitId = parseInt(parts[2] ?? '', 10);
          if (isNaN(habitId)) return null;
          const extra = parts[3];
          if (extra === 'er') return { type: 'habit_toggle', habitId, source: 'evening_reminder' as const };
          if (extra?.includes('-')) return { type: 'habit_toggle', habitId, date: extra };
          return { type: 'habit_toggle', habitId };
        }
        case 'del': {
          const habitId = parseInt(parts[2] ?? '', 10);
          if (isNaN(habitId)) return null;
          return { type: 'habit_delete', habitId };
        }
        case 'cdel': {
          const habitId = parseInt(parts[2] ?? '', 10);
          if (isNaN(habitId)) return null;
          return { type: 'habit_confirm_delete', habitId };
        }
        case 'det': {
          const habitId = parseInt(parts[2] ?? '', 10);
          if (isNaN(habitId)) return null;
          return { type: 'habit_details', habitId };
        }
      }
      break;
    }
    case 's': {
      const sub = parts[1];
      if (sub === 'main') return { type: 'stats' };
      if (sub === 'week') {
        const dir = parts[2];
        const weekStart = parts[3];
        if (dir === 'prev' && weekStart) return { type: 'weekly_prev', weekStart };
        if (dir === 'next' && weekStart) return { type: 'weekly_next', weekStart };
        const weekStartArg = parts[2];
        if (weekStartArg && weekStartArg !== 'prev' && weekStartArg !== 'next') {
          return { type: 'weekly_show', weekStart: weekStartArg };
        }
        return { type: 'weekly_show' };
      }
      break;
    }
    case 'set': {
      const subAction = parts[1];
      switch (subAction) {
        case 'main':
          return { type: 'settings' };
        case 'mor':
          return { type: 'settings_morning', time: parts[2] ?? '08:00' };
        case 'eve':
          return { type: 'settings_evening', time: parts[2] ?? '21:00' };
        case 'rem':
          return { type: 'settings_reminders_toggle' };
      }
      break;
    }
    case 'menu':
      return { type: 'back_to_menu' };
    case 'save':
      return { type: 'save_day' };
    case 'noop':
      return { type: 'noop' };
  }

  return null;
};
