import { Bot } from 'grammy';
import { prisma } from '../db/index.js';
import { BotContext, HabitWithTodayStatus } from '../types/index.js';
import { getTodayHabits, getUserHabitsWithTodayStatus } from './habitService.js';
import { getUsersForMorningReminder, getUsersForEveningReminder } from './userService.js';
import { parseTime, getTodayDate } from '../utils/date.js';
import { createMainMenuKeyboard, createEveningChecklistKeyboard } from '../bot/keyboards/index.js';

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
 */
export const sendMorningReminder = async (
  bot: Bot<BotContext>,
  telegramId: bigint,
  userId: number,
  timezoneOffset: number
): Promise<void> => {
  const todayHabits = await getTodayHabits(userId, timezoneOffset);

  if (todayHabits.length === 0) {
    return; // Нет привычек на сегодня
  }

  let message = '🌅 *Доброе утро!*\n\n';
  message += 'Вот твои привычки на сегодня:\n\n';

  for (const habit of todayHabits) {
    const scheduleText = formatHabitSchedule(habit);
    message += `• ${habit.emoji} ${habit.name} _(${scheduleText})_\n`;
  }

  message += '\nУдачного дня! 🍀';

  try {
    await bot.api.sendMessage(telegramId.toString(), message, {
      parse_mode: 'Markdown',
      reply_markup: createMainMenuKeyboard(),
    });
  } catch (error) {
    console.error(`Ошибка отправки утреннего напоминания для ${telegramId}:`, error);
  }
};

/**
 * Отправляет вечернее напоминание пользователю
 * @param bot - Инстанс бота
 * @param telegramId - Telegram ID пользователя
 * @param userId - ID пользователя в БД
 * @param timezoneOffset - Смещение часового пояса
 */
export const sendEveningReminder = async (
  bot: Bot<BotContext>,
  telegramId: bigint,
  userId: number,
  timezoneOffset: number
): Promise<void> => {
  const habits = await getUserHabitsWithTodayStatus(userId, timezoneOffset);
  const todayHabits = habits.filter((h) => h.isDueToday);

  if (todayHabits.length === 0) {
    return; // Нет привычек на сегодня
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

  try {
    await bot.api.sendMessage(telegramId.toString(), message, {
      parse_mode: 'Markdown',
      reply_markup: createEveningChecklistKeyboard(todayHabits),
    });
  } catch (error) {
    console.error(`Ошибка отправки вечернего напоминания для ${telegramId}:`, error);
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
        await sendMorningReminder(bot, user.telegramId, user.id, timezoneOffset);
        await prisma.user.update({
          where: { id: user.id },
          data: { lastMorningReminderDate: todayDate },
        });
      } else {
        await sendEveningReminder(bot, user.telegramId, user.id, timezoneOffset);
        await prisma.user.update({
          where: { id: user.id },
          data: { lastEveningReminderDate: todayDate },
        });
      }
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
