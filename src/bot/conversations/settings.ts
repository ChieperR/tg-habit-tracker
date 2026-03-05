import { InlineKeyboard, Keyboard } from 'grammy';
import { BotContext, BotConversation } from '../../types/index.js';
import { findOrCreateUser, updateUserSettings } from '../../services/userService.js';
import { getHabitById, updateHabitReminder } from '../../services/habitService.js';
import {
  getTimezoneOffsetFromLocation,
  parseTimezoneFromText,
} from '../../utils/timezoneFromLocation.js';
import { createMainMenuKeyboard, createSettingsKeyboard, createHabitDetailsKeyboard } from '../keyboards/index.js';
import { parseCallback } from '../../utils/callback.js';
import { formatSettingsMessage } from '../commands/settings.js';
import { safeEditMessage } from '../../utils/telegram.js';

const removeKeyboard: { remove_keyboard: true } = { remove_keyboard: true };

/** Callback для отмены ввода часового пояса (обрабатывается внутри диалога) */
const TZ_CANCEL_CALLBACK = 'settings:tz_cancel';

/**
 * Диалог изменения утреннего времени
 * @module bot/conversations/settings
 */

/**
 * Валидирует время в формате HH:MM
 * @param time - Строка времени
 * @returns true если формат корректный
 */
const isValidTime = (time: string): boolean => {
  const regex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
  return regex.test(time);
};

/**
 * Нормализует время в формат HH:MM
 * @param time - Строка времени
 * @returns Нормализованное время
 */
const normalizeTime = (time: string): string => {
  const [hours, minutes] = time.split(':');
  return `${hours?.padStart(2, '0')}:${minutes?.padStart(2, '0')}`;
};

/**
 * Conversation для изменения утреннего времени
 */
export const setMorningTimeConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await conversation.external(() => findOrCreateUser(telegramId));

  await ctx.reply(
    `🌅 *Утреннее напоминание*\n\nТекущее время: *${user.morningTime}*\n\nВведи новое время в формате ЧЧ:ММ\n(например: 07:30 или 9:00)`,
    { parse_mode: 'Markdown' }
  );

  const response = await conversation.waitFor('message:text');
  const input = response.message.text.trim();

  if (input.startsWith('/')) {
    await ctx.reply('❌ Отменено', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  if (!isValidTime(input)) {
    await ctx.reply(
      '❌ Неверный формат времени. Используй ЧЧ:ММ (например: 07:30)',
      { reply_markup: createMainMenuKeyboard() }
    );
    return;
  }

  const normalizedTime = normalizeTime(input);
  await conversation.external(() => 
    updateUserSettings(user.id, { morningTime: normalizedTime })
  );

  await ctx.reply(
    `✅ Утреннее напоминание установлено на *${normalizedTime}*`,
    { parse_mode: 'Markdown', reply_markup: createMainMenuKeyboard() }
  );
};

/**
 * Conversation для изменения вечернего времени
 */
export const setEveningTimeConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await conversation.external(() => findOrCreateUser(telegramId));

  await ctx.reply(
    `🌙 *Вечернее напоминание*\n\nТекущее время: *${user.eveningTime}*\n\nВведи новое время в формате ЧЧ:ММ\n(например: 21:30 или 22:00)`,
    { parse_mode: 'Markdown' }
  );

  const response = await conversation.waitFor('message:text');
  const input = response.message.text.trim();

  if (input.startsWith('/')) {
    await ctx.reply('❌ Отменено', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  if (!isValidTime(input)) {
    await ctx.reply(
      '❌ Неверный формат времени. Используй ЧЧ:ММ (например: 21:30)',
      { reply_markup: createMainMenuKeyboard() }
    );
    return;
  }

  const normalizedTime = normalizeTime(input);
  await conversation.external(() => 
    updateUserSettings(user.id, { eveningTime: normalizedTime })
  );

  await ctx.reply(
    `✅ Вечернее напоминание установлено на *${normalizedTime}*`,
    { parse_mode: 'Markdown', reply_markup: createMainMenuKeyboard() }
  );
};

/**
 * Conversation для изменения часового пояса (геолокация или ввод вручную)
 */
export const setTimezoneConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await conversation.external(() => findOrCreateUser(telegramId));
  const currentOffset = (user.timezoneOffset ?? 180) / 60;
  const sign = currentOffset >= 0 ? '+' : '';

  const cancelKeyboard = new InlineKeyboard().text('❌ Отмена', TZ_CANCEL_CALLBACK);
  const replyKeyboard = new Keyboard()
    .requestLocation('📍 Определить по геолокации')
    .oneTime()
    .resized();

  await ctx.reply(
    `🌍 *Часовой пояс*\n\nТекущий: *UTC${sign}${currentOffset}*\n\nОтправь геолокацию (второе сообщение ниже) или введи вручную:\n• Число от -12 до +14 (например: 3, +0, -5)\n• Или в формате UTC+3 / UTC-5`,
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard }
  );
  await ctx.reply('Или нажми кнопку ниже для геолокации:', {
    reply_markup: replyKeyboard,
  });

  const response = await conversation.wait();
  if (response.callbackQuery?.data === TZ_CANCEL_CALLBACK) {
    await response.answerCallbackQuery('❌ Отменено');
    const freshUser = await conversation.external(() => findOrCreateUser(telegramId!));
    await ctx.reply('↩️ Возврат в настройки', { reply_markup: removeKeyboard });
    await ctx.reply(formatSettingsMessage(freshUser.timezoneOffset), {
      parse_mode: 'Markdown',
      reply_markup: createSettingsKeyboard({
        morningTime: freshUser.morningTime,
        eveningTime: freshUser.eveningTime,
        morningEnabled: freshUser.morningEnabled,
        eveningEnabled: freshUser.eveningEnabled,
        timezoneOffset: freshUser.timezoneOffset,
      }),
    });
    return;
  }

  const msg = response.message;
  if (!msg) {
    await ctx.reply('Отправь геолокацию или введи часовой пояс.', {
      reply_markup: removeKeyboard,
    });
    return;
  }

  if (msg.text?.startsWith('/')) {
    await ctx.reply('❌ Отменено', { reply_markup: removeKeyboard });
    return;
  }

  let offsetMinutes: number | null = null;

  if (msg.location) {
    offsetMinutes = getTimezoneOffsetFromLocation(
      msg.location.latitude,
      msg.location.longitude
    );
  } else if (msg.text) {
    offsetMinutes = parseTimezoneFromText(msg.text);
  }

  if (offsetMinutes === null) {
    await ctx.reply(
      '❌ Не удалось определить часовой пояс. Отправь геолокацию (кнопка ниже) или введи число от -12 до +14.'
    );
    return;
  }

  await conversation.external(() =>
    updateUserSettings(user.id, { timezoneOffset: offsetMinutes })
  );

  const hours = offsetMinutes / 60;
  const newSign = hours >= 0 ? '+' : '';
  await ctx.reply(
    `✅ Часовой пояс установлен: *UTC${newSign}${hours}*`,
    {
      parse_mode: 'Markdown',
      reply_markup: removeKeyboard,
    }
  );
};

/**
 * Conversation для установки персонального напоминания привычки
 */
export const setHabitReminderConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const callbackData = ctx.callbackQuery?.data;
  const action = callbackData ? parseCallback(callbackData) : null;
  const habitId = action && action.type === 'habit_reminder_set' ? action.habitId : undefined;

  if (!habitId) {
    await ctx.reply('❌ Привычка не найдена', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  const habit = await conversation.external(() => getHabitById(habitId));
  if (!habit) {
    await ctx.reply('❌ Привычка не найдена', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  const currentTime = habit.reminderTime;
  const currentLabel = currentTime ? `Текущее: *${currentTime}*\n\n` : '';

  await ctx.reply(
    `⏰ *Напоминание для ${habit.emoji} ${habit.name}*\n\n${currentLabel}Введи время в формате ЧЧ:ММ\n(например: 07:30 или 9:00)`,
    { parse_mode: 'Markdown' }
  );

  const response = await conversation.waitFor('message:text');
  const input = response.message.text.trim();

  if (input.startsWith('/')) {
    await ctx.reply('❌ Отменено', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  if (!isValidTime(input)) {
    await ctx.reply(
      '❌ Неверный формат времени. Используй ЧЧ:ММ (например: 07:30)',
      { reply_markup: createMainMenuKeyboard() }
    );
    return;
  }

  const normalizedTime = normalizeTime(input);
  await conversation.external(() => updateHabitReminder(habitId, normalizedTime));

  await ctx.reply(
    `✅ Напоминание для ${habit.emoji} *${habit.name}* установлено на *${normalizedTime}*`,
    {
      parse_mode: 'Markdown',
      reply_markup: createHabitDetailsKeyboard({
        habitId: habit.id,
        reminderTime: normalizedTime,
      }),
    }
  );
};
