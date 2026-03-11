import { Bot } from 'grammy';
import { prisma } from '../db/index.js';
import { BotContext, HabitWithTodayStatus } from '../types/index.js';
import { getTodayHabits, getUserHabitsWithTodayStatus, getHabitsWithReminders, getHabitLog } from './habitService.js';
import { getUsersForMorningReminder, getUsersForEveningReminder } from './userService.js';
import { parseTime, getTodayDate, isHabitDueToday } from '../utils/date.js';
import { serializeCallback } from '../utils/callback.js';
import { createMainMenuKeyboard, createEveningChecklistKeyboard } from '../bot/keyboards/index.js';
import { InlineKeyboard } from 'grammy';
import { getChangelogBanner } from '../changelog.js';
import { trackEvent } from './analyticsService.js';

/** Описания ошибок Telegram, при которых не нужно повторять отправку */
const UNDELIVERABLE_ERRORS = [
  'bot was blocked by the user',
  'chat not found',
  'user is deactivated',
  'PEER_ID_INVALID',
  'bot can\'t initiate conversation',
];

/**
 * Проверяет, является ли ошибка Telegram штатной (юзер заблокировал/удалился).
 * Если да — тихо логирует вместо полного стектрейса.
 * @returns true если ошибка штатная (обработана), false если неизвестная
 */
const handleDeliveryError = (error: unknown, telegramId: bigint): boolean => {
  const desc = (error as { description?: string })?.description ?? '';
  const isUndeliverable = UNDELIVERABLE_ERRORS.some((e) => desc.includes(e));

  if (isUndeliverable) {
    console.log(`[reminder] Юзер ${telegramId} недоступен: ${desc}`);
    return true;
  }

  return false;
};

/** Названия дней недели */
const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Форматирует расписание привычки для отображения
 * @param habit - Привычка
 * @returns Строка с расписанием
 */
const formatHabitSchedule = (habit: HabitWithTodayStatus): string => {
  switch (habit.frequencyType) {
    case 'daily':
      return 'ежедневно';
    case 'interval':
      return `раз в ${habit.frequencyDays} дн.`;
    case 'weekdays': {
      if (!habit.weekdays) return '';
      const days = habit.weekdays.split(',').map(Number);
      const sorted = [...days].sort((a, b) => {
        const aIdx = a === 0 ? 7 : a;
        const bIdx = b === 0 ? 7 : b;
        return aIdx - bIdx;
      });
      return sorted.map(d => WEEKDAY_NAMES[d]).join(', ');
    }
    default:
      return '';
  }
};

/**
 * Сервис для отправки напоминаний
 * @module services/reminderService
 */

/**
 * Отправляет утреннее напоминание пользователю
 * @param bot - Инстанс бота
 * @param telegramId - Telegram ID пользователя
 * @param userId - ID пользователя в БД
 * @param timezoneOffset - Смещение часового пояса
 * @param lastSeenChangelog - ID последнего просмотренного changelog
 */
export const sendMorningReminder = async (
  bot: Bot<BotContext>,
  telegramId: bigint,
  userId: number,
  timezoneOffset: number,
  lastSeenChangelog: number = 0
): Promise<boolean> => {
  const todayHabits = await getTodayHabits(userId, timezoneOffset);

  if (todayHabits.length === 0) {
    return false;
  }

  let message = '🌅 *Доброе утро!*\n\n';
  message += 'Вот твои привычки на сегодня:\n\n';

  for (const habit of todayHabits) {
    const scheduleText = formatHabitSchedule(habit);
    message += `• ${habit.emoji} ${habit.name} _(${scheduleText})_\n`;
  }

  message += '\nУдачного дня! 🍀';

  const banner = getChangelogBanner({ lastSeenChangelog }, timezoneOffset);
  if (banner) {
    message += banner;
  }

  try {
    await bot.api.sendMessage(telegramId.toString(), message, {
      parse_mode: 'Markdown',
      reply_markup: createMainMenuKeyboard(),
    });
    return true;
  } catch (error) {
    const handled = handleDeliveryError(error, telegramId);
    if (!handled) {
      console.error(`[reminder] Ошибка отправки утреннего для ${telegramId}:`, error);
    }
    return false;
  }
};

/**
 * Отправляет вечернее напоминание пользователю
 * @param bot - Инстанс бота
 * @param telegramId - Telegram ID пользователя
 * @param userId - ID пользователя в БД
 * @param timezoneOffset - Смещение часового пояса
 * @param lastSeenChangelog - ID последнего просмотренного changelog
 */
export const sendEveningReminder = async (
  bot: Bot<BotContext>,
  telegramId: bigint,
  userId: number,
  timezoneOffset: number,
  lastSeenChangelog: number = 0
): Promise<boolean> => {
  const habits = await getUserHabitsWithTodayStatus(userId, timezoneOffset);
  const todayHabits = habits.filter((h) => h.isDueToday);

  if (todayHabits.length === 0) {
    return false;
  }

  const allCompleted = todayHabits.every((h) => h.completedToday);

  let message = '🌙 *Время подвести итоги дня!*\n\n';
  if (allCompleted) {
    message += '🎉 Все привычки выполнены! Так держать! 💪\n\n';
  } else {
    message += 'Отметь выполненные привычки:\n\n';
  }
  for (const habit of todayHabits) {
    const status = habit.completedToday ? '✅' : '⬜';
    message += `${status} ${habit.emoji} ${habit.name}\n`;
  }

  const banner = getChangelogBanner({ lastSeenChangelog }, timezoneOffset);
  if (banner) {
    message += banner;
  }

  try {
    await bot.api.sendMessage(telegramId.toString(), message, {
      parse_mode: 'Markdown',
      reply_markup: createEveningChecklistKeyboard(todayHabits),
    });
    return true;
  } catch (error) {
    const handled = handleDeliveryError(error, telegramId);
    if (!handled) {
      console.error(`[reminder] Ошибка отправки вечернего для ${telegramId}:`, error);
    }
    return false;
  }
};

/**
 * Проверяет и отправляет напоминания всем пользователям
 * @description Отправляет напоминание если:
 * 1. Текущее время >= запланированного времени
 * 2. Сегодня ещё не отправляли
 * Это позволяет "догнать" пропущенные напоминания если бот был выключен
 * @param bot - Инстанс бота
 * @param type - Тип напоминания (morning или evening)
 */
export const checkAndSendReminders = async (
  bot: Bot<BotContext>,
  type: 'morning' | 'evening'
): Promise<void> => {
  const users = type === 'morning' 
    ? await getUsersForMorningReminder() 
    : await getUsersForEveningReminder();
    
  const now = new Date();

  for (const user of users) {
    // Если часовой пояс не задан — считаем МСК (UTC+3)
    const timezoneOffset = user.timezoneOffset ?? 180;
    const todayDate = getTodayDate(timezoneOffset);
    
    // Проверяем, отправляли ли уже сегодня
    const lastReminderDate = type === 'morning' 
      ? user.lastMorningReminderDate 
      : user.lastEveningReminderDate;
    
    if (lastReminderDate === todayDate) {
      continue; // Уже отправляли сегодня
    }
    
    const { hours: targetHours, minutes: targetMinutes } = parseTime(
      type === 'morning' ? user.morningTime : user.eveningTime
    );

    // Вычисляем текущее время в часовом поясе пользователя
    const utcNow = now.getTime() + now.getTimezoneOffset() * 60000;
    const userLocalTime = new Date(utcNow + timezoneOffset * 60000);
    const userHours = userLocalTime.getHours();
    const userMinutes = userLocalTime.getMinutes();

    // Текущее время в минутах от начала дня
    const currentTimeInMinutes = userHours * 60 + userMinutes;
    const targetTimeInMinutes = targetHours * 60 + targetMinutes;

    // Отправляем если текущее время >= целевого
    if (currentTimeInMinutes >= targetTimeInMinutes) {
      if (type === 'morning') {
        const sent = await sendMorningReminder(bot, user.telegramId, user.id, timezoneOffset, user.lastSeenChangelog);
        if (sent) {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastMorningReminderDate: todayDate },
          });
          void trackEvent(user.id, 'reminder_sent', { type: 'morning' });
        }
      } else {
        const sent = await sendEveningReminder(bot, user.telegramId, user.id, timezoneOffset, user.lastSeenChangelog);
        if (sent) {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastEveningReminderDate: todayDate },
          });
          void trackEvent(user.id, 'reminder_sent', { type: 'evening' });
        }
      }
    }
  }
};

/**
 * Проверяет и отправляет персональные напоминания привычек
 * @description Для каждой привычки с reminderTime:
 * 1. Проверяет, что привычка запланирована на сегодня и ещё не выполнена
 * 2. Текущее время пользователя >= reminderTime
 * 3. Сегодня ещё не отправляли (lastHabitReminderDate)
 * @param bot - Инстанс бота
 */
export const checkAndSendHabitReminders = async (
  bot: Bot<BotContext>
): Promise<void> => {
  const habits = await getHabitsWithReminders();
  const now = new Date();

  for (const habit of habits) {
    const timezoneOffset = habit.user.timezoneOffset ?? 180;
    const todayDate = getTodayDate(timezoneOffset);

    if (habit.lastHabitReminderDate === todayDate) {
      continue;
    }

    if (!habit.reminderTime) continue;

    const lastCompletedLog = await prisma.habitLog.findFirst({
      where: { habitId: habit.id, completed: true },
      orderBy: { date: 'desc' },
    });

    const isDue = isHabitDueToday({
      frequencyType: habit.frequencyType as 'daily' | 'interval' | 'weekdays',
      frequencyDays: habit.frequencyDays,
      weekdays: habit.weekdays,
      lastCompletedDate: lastCompletedLog?.date ?? null,
      todayDate,
    });

    if (!isDue) continue;

    const todayLog = await getHabitLog(habit.id, todayDate);
    if (todayLog?.completed) continue;

    const { hours: targetHours, minutes: targetMinutes } = parseTime(habit.reminderTime);

    const utcNow = now.getTime() + now.getTimezoneOffset() * 60000;
    const userLocalTime = new Date(utcNow + timezoneOffset * 60000);
    const currentTimeInMinutes = userLocalTime.getHours() * 60 + userLocalTime.getMinutes();
    const targetTimeInMinutes = targetHours * 60 + targetMinutes;

    if (currentTimeInMinutes >= targetTimeInMinutes) {
      const message = `⏰ Пришло время: *${habit.emoji} ${habit.name}*`;
      const keyboard = new InlineKeyboard()
        .text('✅ Выполнено', serializeCallback({ type: 'habit_toggle', habitId: habit.id, source: 'habit_reminder' }));

      try {
        await bot.api.sendMessage(habit.user.telegramId.toString(), message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        void trackEvent(habit.userId, 'reminder_sent', { type: 'habit', habitId: habit.id });
      } catch (error) {
        const handled = handleDeliveryError(error, habit.user.telegramId);
        if (!handled) {
          console.error(`[reminder] Ошибка напоминания привычки ${habit.id} для ${habit.user.telegramId}:`, error);
        }
      }

      await prisma.habit.update({
        where: { id: habit.id },
        data: { lastHabitReminderDate: todayDate },
      });
    }
  }
};

/**
 * Получает время следующего напоминания для пользователя
 * @param userId - ID пользователя в БД
 * @param type - Тип напоминания
 * @returns Время в формате HH:MM или null
 */
export const getNextReminderTime = async (
  userId: number,
  type: 'morning' | 'evening'
): Promise<string | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { 
      morningTime: true, 
      eveningTime: true, 
      morningEnabled: true,
      eveningEnabled: true,
    },
  });

  if (!user) {
    return null;
  }

  if (type === 'morning' && !user.morningEnabled) {
    return null;
  }
  
  if (type === 'evening' && !user.eveningEnabled) {
    return null;
  }

  return type === 'morning' ? user.morningTime : user.eveningTime;
};
