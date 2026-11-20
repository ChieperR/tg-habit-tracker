import { InlineKeyboard, Keyboard } from 'grammy';
import { BotContext, BotConversation } from '../../types/index.js';
import { findOrCreateUser, updateUserSettings } from '../../services/userService.js';
import {
  addHabitReminders,
  changeHabitReminderTime,
  getHabitById,
  getHabitReminderById,
  getHabitReminders,
} from '../../services/habitService.js';
import { MAX_HABIT_REMINDERS } from '../../services/reminder/habitReminderSlots.js';
import { parseReminderTimes } from '../../utils/validation.js';
import { buildHabitRemindersView } from '../views/habitViews.js';
import {
  getTimezoneOffsetFromLocation,
  parseTimezoneFromText,
} from '../../utils/timezoneFromLocation.js';
import { createMainMenuKeyboard, createSettingsKeyboard } from '../keyboards/index.js';
import { parseCallback } from '../../utils/callback.js';
import { formatSettingsMessage } from '../commands/settings.js';
import { safeEditMessage, escapeMarkdown } from '../../utils/telegram.js';
import { cancelConversationKeyboard, waitTextOrCancel } from './cancelHelper.js';

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
    { parse_mode: 'Markdown', reply_markup: cancelConversationKeyboard() }
  );

  const text = await waitTextOrCancel(conversation);
  if (text === null) {
    return;
  }
  const input = text.trim();

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
    { parse_mode: 'Markdown', reply_markup: cancelConversationKeyboard() }
  );

  const text = await waitTextOrCancel(conversation);
  if (text === null) {
    return;
  }
  const input = text.trim();

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
  const replyKbMsg = await ctx.reply('Или нажми кнопку ниже для геолокации:', {
    reply_markup: replyKeyboard,
  });

  // Удаляет два sticky-сообщения wizard'а и снимает reply keyboard через
  // ZWSP-flash сообщение, после которого ничего видимого в чате не остаётся.
  const cleanupStickyMessages = async (cancelMsgId: number | null): Promise<void> => {
    if (cancelMsgId !== null) {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, cancelMsgId);
      } catch {
        /* ignore */
      }
    }
    try {
      await ctx.api.deleteMessage(replyKbMsg.chat.id, replyKbMsg.message_id);
    } catch {
      /* ignore */
    }
    try {
      const flash = await ctx.reply('​', { reply_markup: removeKeyboard });
      await ctx.api.deleteMessage(flash.chat.id, flash.message_id);
    } catch {
      /* ignore */
    }
  };

  let offsetMinutes: number | null = null;
  let cancelInlineMsgId: number | null = null;

  // Цикл попыток ввода: повторяем пока юзер не введёт валидный TZ или не отменит.
  while (true) {
    const response = await conversation.wait();
    if (response.callbackQuery?.data === TZ_CANCEL_CALLBACK) {
      await response.answerCallbackQuery('❌ Отменено');
      const inlineMsgId = response.callbackQuery.message?.message_id ?? null;
      await cleanupStickyMessages(inlineMsgId);
      return;
    }

    const msg = response.message;
    if (!msg) continue;

    if (msg.text?.startsWith('/')) {
      await cleanupStickyMessages(cancelInlineMsgId);
      return;
    }

    if (msg.location) {
      offsetMinutes = getTimezoneOffsetFromLocation(
        msg.location.latitude,
        msg.location.longitude
      );
    } else if (msg.text) {
      offsetMinutes = parseTimezoneFromText(msg.text);
    }

    if (offsetMinutes !== null) break;

    const retryMsg = await ctx.reply(
      '❌ Не удалось определить часовой пояс. Отправь геолокацию (кнопка ниже) или введи число от -12 до +14.',
      { reply_markup: cancelKeyboard }
    );
    cancelInlineMsgId = retryMsg.message_id;
  }

  // Валидный TZ — сохраняем, чистим sticky-сообщения, шлём подтверждение.
  await conversation.external(() =>
    updateUserSettings(user.id, { timezoneOffset: offsetMinutes })
  );
  await cleanupStickyMessages(cancelInlineMsgId);

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

/** Сообщение об ошибке ввода времени + просьба ввести ещё раз. */
const askAgain = async (ctx: BotContext, error: string): Promise<void> => {
  await ctx.reply(`❌ ${error} Введи ещё раз:`, { reply_markup: cancelConversationKeyboard() });
};

/**
 * Conversation добавления персональных напоминаний привычки: одно время или
 * несколько через пробел/запятую. Входит из деталей привычки, из списка
 * напоминаний («➕ Добавить время») и после создания привычки.
 */
export const setHabitReminderConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const callbackData = ctx.callbackQuery?.data;
  const action = callbackData ? parseCallback(callbackData) : null;
  const habitId =
    action && (action.type === 'habit_reminder_add' || action.type === 'habit_reminder_set')
      ? action.habitId
      : undefined;

  if (!habitId) {
    await ctx.reply('❌ Привычка не найдена', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  const user = await conversation.external(() => findOrCreateUser(telegramId));
  const habit = await conversation.external(() => getHabitById(habitId));
  if (!habit || !habit.isActive || habit.userId !== user.id) {
    await ctx.reply('❌ Привычка не найдена', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  const existing = await conversation.external(() => getHabitReminders(habitId));
  if (existing.length >= MAX_HABIT_REMINDERS) {
    const view = buildHabitRemindersView(habit, existing);
    await ctx.reply(`⏰ У привычки уже ${MAX_HABIT_REMINDERS} напоминаний — это максимум.`, {
      reply_markup: view.keyboard,
    });
    return;
  }

  const currentLabel = existing.length > 0
    ? `Уже есть: *${existing.map((r) => r.time).join(', ')}*\n\n`
    : '';
  await ctx.reply(
    `⏰ *Напоминание для ${habit.emoji} ${escapeMarkdown(habit.name)}*\n\n${currentLabel}Введи время в формате ЧЧ:ММ (например: 07:30 или 9:00). Можно несколько через пробел: 09:00 14:00 20:00`,
    { parse_mode: 'Markdown', reply_markup: cancelConversationKeyboard() }
  );

  while (true) {
    const text = await waitTextOrCancel(conversation);
    if (text === null) return;
    if (text.trim().startsWith('/')) {
      await ctx.reply('❌ Отменено', { reply_markup: createMainMenuKeyboard() });
      return;
    }

    const parsed = parseReminderTimes(text);
    if ('error' in parsed) {
      await askAgain(ctx, parsed.error);
      continue;
    }

    const result = await conversation.external(() => addHabitReminders(habitId, user.id, parsed.times));
    if (result.kind === 'not_found') {
      await ctx.reply('❌ Привычка не найдена или была удалена.', { reply_markup: createMainMenuKeyboard() });
      return;
    }
    if (result.kind === 'limit') {
      await askAgain(
        ctx,
        `Можно до ${MAX_HABIT_REMINDERS} напоминаний в день, свободно ещё ${result.free}.`
      );
      continue;
    }

    const reminders = await conversation.external(() => getHabitReminders(habitId));
    const view = buildHabitRemindersView(habit, reminders);
    const label = result.times.length === 1 ? 'Напоминание' : 'Напоминания';
    await ctx.reply(
      `✅ ${label} для ${habit.emoji} *${escapeMarkdown(habit.name)}*: *${result.times.join(', ')}*`,
      { parse_mode: 'Markdown', reply_markup: view.keyboard }
    );
    return;
  }
};

/**
 * Conversation смены времени одного напоминания (кнопка «✏️ ЧЧ:ММ» в списке
 * напоминаний привычки).
 */
export const changeHabitReminderConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const callbackData = ctx.callbackQuery?.data;
  const action = callbackData ? parseCallback(callbackData) : null;
  const reminderId = action && action.type === 'habit_reminder_change' ? action.reminderId : undefined;
  if (reminderId === undefined) {
    await ctx.reply('❌ Напоминание не найдено', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  const user = await conversation.external(() => findOrCreateUser(telegramId));
  const reminder = await conversation.external(() => getHabitReminderById(reminderId));
  const habit = reminder ? await conversation.external(() => getHabitById(reminder.habitId)) : null;
  if (!reminder || !habit || !habit.isActive || habit.userId !== user.id) {
    await ctx.reply('❌ Напоминание не найдено', { reply_markup: createMainMenuKeyboard() });
    return;
  }

  await ctx.reply(
    `⏰ *${habit.emoji} ${escapeMarkdown(habit.name)}*\n\nСейчас напоминание в *${reminder.time}*. Введи новое время в формате ЧЧ:ММ:`,
    { parse_mode: 'Markdown', reply_markup: cancelConversationKeyboard() }
  );

  while (true) {
    const text = await waitTextOrCancel(conversation);
    if (text === null) return;
    if (text.trim().startsWith('/')) {
      await ctx.reply('❌ Отменено', { reply_markup: createMainMenuKeyboard() });
      return;
    }

    const parsed = parseReminderTimes(text);
    if ('error' in parsed) {
      await askAgain(ctx, parsed.error);
      continue;
    }
    if (parsed.times.length !== 1) {
      await askAgain(ctx, 'Здесь меняется одно время. Добавить ещё можно кнопкой «➕ Добавить время».');
      continue;
    }
    const time = parsed.times[0]!;

    const result = await conversation.external(() => changeHabitReminderTime(reminderId, user.id, time));
    if (result.kind === 'not_found') {
      await ctx.reply('❌ Напоминание не найдено или привычка удалена.', { reply_markup: createMainMenuKeyboard() });
      return;
    }
    if (result.kind === 'exists') {
      await askAgain(ctx, `Напоминание на ${time} уже есть.`);
      continue;
    }

    const reminders = await conversation.external(() => getHabitReminders(habit.id));
    const view = buildHabitRemindersView(habit, reminders);
    await ctx.reply(
      `✅ Напоминание для ${habit.emoji} *${escapeMarkdown(habit.name)}* теперь в *${time}*`,
      { parse_mode: 'Markdown', reply_markup: view.keyboard }
    );
    return;
  }
};
