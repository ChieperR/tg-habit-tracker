import { BotContext, BotConversation } from '../../types/index.js';
import { findOrCreateUser, updateUserSettings } from '../../services/userService.js';
import { createMainMenuKeyboard, createSettingsKeyboard } from '../keyboards/index.js';
import { safeEditMessage } from '../../utils/telegram.js';

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
 * Conversation для изменения часового пояса
 */
export const setTimezoneConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await conversation.external(() => findOrCreateUser(telegramId));
  const currentOffset = user.timezoneOffset / 60;
  const sign = currentOffset >= 0 ? '+' : '';

  await ctx.reply(
    `🌍 *Часовой пояс*\n\nТекущий: *UTC${sign}${currentOffset}*\n\nВведи свой часовой пояс:\n• Число от -12 до +14\n• Например: +3 (Москва), +0 (Лондон), -5 (Нью-Йорк)`,
    { parse_mode: 'Markdown' }
  );

  const response = await conversation.waitFor('message:text');
  const input = response.message.text.trim().replace(',', '.');

  if (input.startsWith('/')) {
    await ctx.reply('❌ Отменено', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  const offset = parseFloat(input);
  
  if (isNaN(offset) || offset < -12 || offset > 14) {
    await ctx.reply(
      '❌ Неверный часовой пояс. Введи число от -12 до +14',
      { reply_markup: createMainMenuKeyboard() }
    );
    return;
  }

  const offsetMinutes = Math.round(offset * 60);
  await conversation.external(() => 
    updateUserSettings(user.id, { timezoneOffset: offsetMinutes })
  );

  const newSign = offset >= 0 ? '+' : '';
  await ctx.reply(
    `✅ Часовой пояс установлен: *UTC${newSign}${offset}*`,
    { parse_mode: 'Markdown', reply_markup: createMainMenuKeyboard() }
  );
};
