import { Bot, InlineKeyboard } from 'grammy';
import { prisma } from '../../db/index.js';
import { BotContext } from '../../types/index.js';
import { getHabitsWithReminders, getHabitLog } from '../habitService.js';
import { getUsersForMorningReminder, getUsersForEveningReminder } from '../userService.js';
import { parseTime, getTodayDate, isHabitDueToday } from '../../utils/date.js';
import { serializeCallback } from '../../utils/callback.js';
import { trackEvent } from '../analyticsService.js';
import { sendMorningReminder, sendEveningReminder } from './senders.js';
import { handleDeliveryError } from './delivery.js';

/**
 * Проверяет и отправляет утренние/вечерние напоминания всем пользователям.
 * Отправляет напоминание если: текущее время >= запланированного и сегодня ещё не отправляли.
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
    const timezoneOffset = user.timezoneOffset ?? 180;
    const todayDate = getTodayDate(timezoneOffset);

    // Проверяем, отправляли ли уже сегодня
    const lastReminderDate = type === 'morning'
      ? user.lastMorningReminderDate
      : user.lastEveningReminderDate;

    if (lastReminderDate === todayDate) {
      continue;
    }

    const { hours: targetHours, minutes: targetMinutes } = parseTime(
      type === 'morning' ? user.morningTime : user.eveningTime
    );

    const utcNow = now.getTime() + now.getTimezoneOffset() * 60000;
    const userLocalTime = new Date(utcNow + timezoneOffset * 60000);
    const userHours = userLocalTime.getHours();
    const userMinutes = userLocalTime.getMinutes();

    const currentTimeInMinutes = userHours * 60 + userMinutes;
    const targetTimeInMinutes = targetHours * 60 + targetMinutes;

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
 * Проверяет и отправляет персональные напоминания привычек.
 * Для каждой привычки с reminderTime: проверяет due today, не выполнена, время подошло.
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
        const handled = handleDeliveryError(error, habit.user.telegramId, habit.userId);
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
