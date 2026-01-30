import { InlineKeyboard } from 'grammy';
import { HabitWithTodayStatus } from '../../types/index.js';
import { serializeCallback } from '../../utils/callback.js';

/**
 * Клавиатуры для бота
 * @module bot/keyboards
 */

/**
 * Создаёт главное меню бота
 * @returns Inline клавиатура главного меню
 */
export const createMainMenuKeyboard = (): InlineKeyboard => {
  return new InlineKeyboard()
    .text('📝 Мои привычки', serializeCallback({ type: 'habits_list' }))
    .text('➕ Добавить', serializeCallback({ type: 'habit_add' }))
    .row()
    .text('📊 Статистика', serializeCallback({ type: 'stats' }))
    .text('⚙️ Настройки', serializeCallback({ type: 'settings' }));
};

/**
 * Создаёт клавиатуру со списком привычек
 * @param habits - Массив привычек со статусом
 * @returns Inline клавиатура
 */
export const createHabitsListKeyboard = (habits: HabitWithTodayStatus[]): InlineKeyboard => {
  const keyboard = new InlineKeyboard();

  for (const habit of habits) {
    const status = habit.completedToday ? '✅' : '⬜';
    const dueIndicator = habit.isDueToday ? '' : ' 💤';
    
    // На кнопке только статус и эмодзи, полное название уже в тексте сообщения
    keyboard
      .text(
        `${status} ${habit.emoji}${dueIndicator}`,
        serializeCallback({ type: 'habit_toggle', habitId: habit.id })
      )
      .text('🗑', serializeCallback({ type: 'habit_delete', habitId: habit.id }))
      .row();
  }

  keyboard
    .text('➕ Добавить привычку', serializeCallback({ type: 'habit_add' }))
    .row()
    .text('◀️ Назад', serializeCallback({ type: 'back_to_menu' }));

  return keyboard;
};

/**
 * Создаёт клавиатуру подтверждения удаления
 * @param habitId - ID привычки для удаления
 * @returns Inline клавиатура
 */
export const createDeleteConfirmKeyboard = (habitId: number): InlineKeyboard => {
  return new InlineKeyboard()
    .text('✅ Да, удалить', serializeCallback({ type: 'habit_confirm_delete', habitId }))
    .text('❌ Отмена', serializeCallback({ type: 'habits_list' }));
};

/**
 * Создаёт клавиатуру для вечернего чек-листа
 * @param habits - Массив привычек на сегодня
 * @returns Inline клавиатура
 */
export const createEveningChecklistKeyboard = (habits: HabitWithTodayStatus[]): InlineKeyboard => {
  const keyboard = new InlineKeyboard();

  for (const habit of habits) {
    const status = habit.completedToday ? '✅' : '⬜';
    // На кнопке только статус и эмодзи, полное название уже в тексте сообщения
    keyboard
      .text(
        `${status} ${habit.emoji}`,
        serializeCallback({ type: 'habit_toggle', habitId: habit.id })
      )
      .row();
  }

  keyboard.text('💾 Готово', serializeCallback({ type: 'back_to_menu' }));

  return keyboard;
};

/**
 * Параметры для клавиатуры настроек
 */
export type SettingsKeyboardParams = {
  morningTime: string;
  eveningTime: string;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  timezoneOffset: number | null;
};

/**
 * Создаёт клавиатуру настроек
 * @param params - Параметры настроек
 * @returns Inline клавиатура
 */
export const createSettingsKeyboard = (params: SettingsKeyboardParams): InlineKeyboard => {
  const { morningTime, eveningTime, morningEnabled, eveningEnabled, timezoneOffset } = params;
  
  const morningStatus = morningEnabled ? '🔔' : '🔕';
  const eveningStatus = eveningEnabled ? '🔔' : '🔕';
  const tzDisplay = timezoneOffset !== null 
    ? `UTC${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset / 60}` 
    : 'не указан';
  
  return new InlineKeyboard()
    .text(`${morningStatus} Утро: ${morningTime}`, 'settings:morning_toggle')
    .text('✏️', 'settings:morning_time')
    .row()
    .text(`${eveningStatus} Вечер: ${eveningTime}`, 'settings:evening_toggle')
    .text('✏️', 'settings:evening_time')
    .row()
    .text(`🌍 Часовой пояс: ${tzDisplay}`, 'settings:timezone')
    .row()
    .text('◀️ Назад', serializeCallback({ type: 'back_to_menu' }));
};

/**
 * Создаёт клавиатуру статистики
 * @returns Inline клавиатура
 */
export const createStatsKeyboard = (): InlineKeyboard => {
  return new InlineKeyboard()
    .text('📅 Неделя', serializeCallback({ type: 'weekly_show' }))
    .row()
    .text('◀️ Назад', serializeCallback({ type: 'back_to_menu' }));
};

/**
 * Создаёт клавиатуру недельной статистики (пагинация по неделям)
 * @param weekStartMonday - Понедельник текущей отображаемой недели (YYYY-MM-DD)
 * @returns Inline клавиатура
 */
export const createWeeklyKeyboard = (weekStartMonday: string): InlineKeyboard => {
  return new InlineKeyboard()
    .text('◀ Пред', serializeCallback({ type: 'weekly_prev', weekStart: weekStartMonday }))
    .text('След ▶', serializeCallback({ type: 'weekly_next', weekStart: weekStartMonday }))
    .row()
    .text('◀️ Назад', serializeCallback({ type: 'stats' }));
};

/**
 * Создаёт клавиатуру выбора типа частоты
 * @returns Inline клавиатура
 */
export const createFrequencyTypeKeyboard = (): InlineKeyboard => {
  return new InlineKeyboard()
    .text('📅 Ежедневно', 'freqtype:daily')
    .row()
    .text('🔄 Раз в N дней', 'freqtype:interval')
    .row()
    .text('📆 Определённые дни недели', 'freqtype:weekdays')
    .row()
    .text('❌ Отмена', serializeCallback({ type: 'back_to_menu' }));
};

/** Названия дней недели */
const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Создаёт клавиатуру выбора дней недели
 * @param selectedDays - Массив выбранных дней (0-6, где 0=Вс)
 * @returns Inline клавиатура
 */
export const createWeekdaysKeyboard = (selectedDays: number[]): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  
  // Первый ряд: Пн-Чт (1-4)
  for (let day = 1; day <= 4; day++) {
    const isSelected = selectedDays.includes(day);
    const label = isSelected ? `✅ ${WEEKDAY_NAMES[day]}` : `⬜ ${WEEKDAY_NAMES[day]}`;
    keyboard.text(label, `weekday:${day}`);
  }
  keyboard.row();
  
  // Второй ряд: Пт-Вс (5, 6, 0)
  for (const day of [5, 6, 0]) {
    const isSelected = selectedDays.includes(day);
    const label = isSelected ? `✅ ${WEEKDAY_NAMES[day]}` : `⬜ ${WEEKDAY_NAMES[day]}`;
    keyboard.text(label, `weekday:${day}`);
  }
  keyboard.row();
  
  keyboard
    .text('💾 Готово', 'weekdays:done')
    .row()
    .text('❌ Отмена', serializeCallback({ type: 'back_to_menu' }));

  return keyboard;
};

/**
 * Создаёт клавиатуру выбора эмодзи
 * @returns Inline клавиатура
 */
export const createEmojiKeyboard = (): InlineKeyboard => {
  return new InlineKeyboard()
    .text('💪', 'emoji:💪')
    .text('📚', 'emoji:📚')
    .text('🏃', 'emoji:🏃')
    .text('🧘', 'emoji:🧘')
    .text('💧', 'emoji:💧')
    .row()
    .text('🍎', 'emoji:🍎')
    .text('😴', 'emoji:😴')
    .text('✍️', 'emoji:✍️')
    .text('🎯', 'emoji:🎯')
    .text('🐜', 'emoji:🐜')
    .row()
    .text('✨', 'emoji:✨')
    .text('🌱', 'emoji:🌱')
    .text('💊', 'emoji:💊')
    .text('🧹', 'emoji:🧹')
    .text('📱', 'emoji:📱')
    .row()
    .text('❌ Отмена', serializeCallback({ type: 'back_to_menu' }));
};
