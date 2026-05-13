import { Bot, InlineKeyboard } from 'grammy';
import { prisma } from '../../db/index.js';
import { BotContext } from '../../types/index.js';
import { getHabitsWithReminders, getHabitLog } from '../habitService.js';
import { getUsersForMorningReminder, getUsersForEveningReminder } from '../userService.js';
import {
  parseTime,
  getTodayDate,
  isHabitDueToday,
  getCurrentMinutesInTimezone,
  DEFAULT_TIMEZONE_OFFSET,
  getPrevDate,
} from '../../utils/date.js';
import { serializeCallback } from '../../utils/callback.js';
import { trackEvent } from '../analyticsService.js';
import { sendMorningReminder, sendEveningReminder } from './senders.js';
import { handleDeliveryError } from './delivery.js';
import { buildPerHabitReminder } from './textBuilder.js';
import { shouldAutoApplyFreeze, type StreakHabit, type StreakHabitLog, type StreakFreezeUsage } from '../streak/calculator.js';
import { autoSpendFreeze } from '../streak/freezeService.js';

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

  for (const user of users) {
    const timezoneOffset = user.timezoneOffset ?? DEFAULT_TIMEZONE_OFFSET;
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

    const currentTimeInMinutes = getCurrentMinutesInTimezone(timezoneOffset);
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

  for (const habit of habits) {
    const timezoneOffset = habit.user.timezoneOffset ?? DEFAULT_TIMEZONE_OFFSET;
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

    const currentTimeInMinutes = getCurrentMinutesInTimezone(timezoneOffset);
    const targetTimeInMinutes = targetHours * 60 + targetMinutes;

    if (currentTimeInMinutes >= targetTimeInMinutes) {
      const message = await buildPerHabitReminder(habit.userId, timezoneOffset, {
        id: habit.id,
        name: habit.name,
        emoji: habit.emoji,
        frequencyType: habit.frequencyType,
        frequencyDays: habit.frequencyDays,
        weekdays: habit.weekdays,
        createdAt: habit.createdAt,
        isActive: habit.isActive,
      });
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
 * Утренняя проверка freeze: для всех юзеров с активными привычками,
 * у которых вчера были due-привычки и ни одна не выполнена и день не покрыт
 * freeze, и в инвентаре есть freeze — автоматически списываем freeze.
 *
 * Идемпотентна: благодаря unique constraint `[userId, date]` на FreezeUsage,
 * повторный вызов на тот же день ничего не делает.
 *
 * Вызывается из cron раз в день, в утреннее окно (например 04:00..05:00).
 */
export const autoApplyFreezesForMissedDays = async (): Promise<void> => {
  const users = await prisma.user.findMany({
    where: { freezeCount: { gt: 0 } },
    select: {
      id: true,
      timezoneOffset: true,
      habits: {
        select: {
          id: true,
          frequencyType: true,
          frequencyDays: true,
          weekdays: true,
          createdAt: true,
          isActive: true,
        },
      },
    },
  });

  for (const user of users) {
    const timezoneOffset = user.timezoneOffset ?? DEFAULT_TIMEZONE_OFFSET;
    const todayDate = getTodayDate(timezoneOffset);

    const [logs, freezeUsages] = await Promise.all([
      prisma.habitLog.findMany({
        where: { habit: { userId: user.id } },
        select: { habitId: true, date: true, completed: true },
      }),
      prisma.freezeUsage.findMany({
        where: { userId: user.id },
        select: { date: true },
      }),
    ]);

    const streakHabits: StreakHabit[] = user.habits;
    const streakLogs: StreakHabitLog[] = logs;
    const streakFreezes: StreakFreezeUsage[] = freezeUsages;

    if (shouldAutoApplyFreeze(streakHabits, streakLogs, streakFreezes, todayDate)) {
      const yesterdayStr = getPrevDate(todayDate);
      await autoSpendFreeze(user.id, yesterdayStr).catch((err) => {
        console.error(`[freeze-cron] Ошибка списания freeze для юзера ${user.id}:`, err);
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
