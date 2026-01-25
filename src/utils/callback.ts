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
    case 'habit_toggle':
      return `h:tog:${action.habitId}`;
    case 'habit_delete':
      return `h:del:${action.habitId}`;
    case 'habit_confirm_delete':
      return `h:cdel:${action.habitId}`;
    case 'habit_details':
      return `h:det:${action.habitId}`;
    case 'stats':
      return 's:main';
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
        case 'tog': {
          const habitId = parseInt(parts[2] ?? '', 10);
          if (isNaN(habitId)) return null;
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
    case 's':
      if (parts[1] === 'main') return { type: 'stats' };
      break;
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
