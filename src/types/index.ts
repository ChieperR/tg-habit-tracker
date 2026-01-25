import { Context, SessionFlavor } from 'grammy';
import { type Conversation, type ConversationFlavor } from '@grammyjs/conversations';

/**
 * Данные сессии пользователя
 * @description Хранит временные данные между запросами
 */
export type SessionData = {
  /** ID пользователя в нашей БД */
  dbUserId?: number;
};

/** Базовый контекст с сессией */
type BaseContext = Context & SessionFlavor<SessionData>;

/**
 * Контекст бота с поддержкой сессий и диалогов
 * @description Расширенный контекст grammY с нашими данными
 */
export type BotContext = BaseContext & ConversationFlavor<BaseContext>;

/**
 * Тип Conversation для нашего контекста
 */
export type BotConversation = Conversation<BotContext, BotContext>;

/**
 * Тип частоты выполнения привычки
 */
export type FrequencyType = 'daily' | 'interval' | 'weekdays';

/**
 * Тип для создания новой привычки
 */
export type CreateHabitInput = {
  /** Название привычки */
  name: string;
  /** Эмодзи */
  emoji: string;
  /** Тип частоты */
  frequencyType: FrequencyType;
  /** Интервал в днях (для interval) */
  frequencyDays?: number;
  /** Дни недели (для weekdays), например "1,3,5" */
  weekdays?: string;
  /** ID пользователя в БД */
  userId: number;
};

/**
 * Привычка с информацией о сегодняшнем выполнении
 */
export type HabitWithTodayStatus = {
  id: number;
  name: string;
  emoji: string;
  frequencyType: FrequencyType;
  frequencyDays: number;
  weekdays: string | null;
  /** Выполнена ли сегодня */
  completedToday: boolean;
  /** Нужно ли выполнять сегодня (по расписанию) */
  isDueToday: boolean;
};

/**
 * Статистика привычки
 */
export type HabitStats = {
  /** ID привычки */
  habitId: number;
  /** Название */
  name: string;
  /** Эмодзи */
  emoji: string;
  /** Всего выполнений */
  totalCompleted: number;
  /** Текущий streak (дней подряд) */
  currentStreak: number;
  /** Максимальный streak */
  maxStreak: number;
  /** Процент выполнения за последние 30 дней */
  completionRate: number;
};

/**
 * Общая статистика пользователя
 */
export type UserStats = {
  /** Всего привычек */
  totalHabits: number;
  /** Активных привычек */
  activeHabits: number;
  /** Всего выполнений */
  totalCompletions: number;
  /** Статистика по каждой привычке */
  habitStats: HabitStats[];
};

/**
 * Настройки пользователя
 */
export type UserSettings = {
  /** Время утреннего напоминания */
  morningTime?: string;
  /** Время вечернего напоминания */
  eveningTime?: string;
  /** Смещение часового пояса в минутах */
  timezoneOffset?: number | null;
  /** Включены ли утренние напоминания */
  morningEnabled?: boolean;
  /** Включены ли вечерние напоминания */
  eveningEnabled?: boolean;
};

/**
 * Callback data для inline кнопок
 */
export type CallbackAction = 
  | { type: 'habits_list' }
  | { type: 'habit_add' }
  | { type: 'habit_toggle'; habitId: number }
  | { type: 'habit_delete'; habitId: number }
  | { type: 'habit_confirm_delete'; habitId: number }
  | { type: 'habit_details'; habitId: number }
  | { type: 'stats' }
  | { type: 'settings' }
  | { type: 'settings_morning'; time: string }
  | { type: 'settings_evening'; time: string }
  | { type: 'settings_reminders_toggle' }
  | { type: 'back_to_menu' }
  | { type: 'save_day' }
  | { type: 'noop' };
