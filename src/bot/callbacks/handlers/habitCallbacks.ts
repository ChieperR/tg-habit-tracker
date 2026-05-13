import { InlineKeyboard } from 'grammy';
import { BotContext } from '../../../types/index.js';
import { serializeCallback } from '../../../utils/callback.js';
import { safeEditMessage, safeAnswerCallback } from '../../../utils/telegram.js';
import { findOrCreateUser } from '../../../services/userService.js';
import { toggleHabitCompletion, deleteHabit, getHabitById, getUserHabitsWithTodayStatus, updateHabitReminder } from '../../../services/habitService.js';
import { trackEvent } from '../../../services/analyticsService.js';
import { showHabitsList } from '../../commands/habits.js';
import { createEveningChecklistKeyboard, createDeleteConfirmKeyboard, createHabitDetailsKeyboard, createHabitCreatedKeyboard } from '../../keyboards/index.js';
import { formatScheduleText } from '../../../utils/format.js';
import { escapeMarkdown } from '../../../utils/telegram.js';
import { prisma } from '../../../db/index.js';
import { getTodayDate } from '../../../utils/date.js';
import { detectAndSendMilestones } from '../../../services/streak/milestoneDelivery.js';
import { tryEarnFreezes, refundFreeze } from '../../../services/streak/freezeService.js';
import {
  calculateOverallStreak,
  type StreakHabit,
  type StreakHabitLog,
  type StreakFreezeUsage,
} from '../../../services/streak/calculator.js';
import {
  FREEZE_EARNED_NOTIFICATION,
  FREEZE_EARNED_SUFFIX_ONE,
  FREEZE_EARNED_SUFFIX_TWO,
} from '../../../data/reminderTexts.js';
import { pickDeterministic, renderTemplate } from '../../../services/streak/textSelector.js';

/**
 * Переключает статус выполнения привычки
 */
export const handleHabitToggle = async (
  ctx: BotContext,
  habitId: number,
  source?: 'evening_reminder' | 'habit_reminder' | 'habit_created',
  date?: string
): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const habit = await getHabitById(habitId);

  if (!habit || habit.userId !== user.id) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  const timezoneOffset = user.timezoneOffset ?? 0;
  const todayDate = getTodayDate(timezoneOffset);
  const targetDate = date ?? todayDate;
  const newStatus = await toggleHabitCompletion(habitId, timezoneOffset, date);
  const statusText = newStatus ? '✅ Выполнено!' : '⬜ Отменено';

  // Трекаем check-in (fire-and-forget)
  if (newStatus) {
    void trackEvent(user.id, 'checkin', { habitId, source: source ?? 'habit_list' });
  }

  await safeAnswerCallback(ctx, statusText);

  // Streak-machinery: milestone delivery + freeze refund + freeze earn (только при отметке).
  if (newStatus) {
    void processStreakSideEffects(ctx, user.id, user.telegramId, habitId, targetDate, todayDate);
  }

  if (source === 'habit_reminder') {
    const safeName = escapeMarkdown(habit.name);
    const doneText = newStatus
      ? `✅ *${habit.emoji} ${safeName}* — выполнено!`
      : `⏰ Пришло время: *${habit.emoji} ${safeName}*`;

    const toggleKeyboard = new InlineKeyboard().text(
      newStatus ? '↩️ Отменить' : '✅ Выполнено',
      serializeCallback({ type: 'habit_toggle', habitId, source: 'habit_reminder' })
    );

    await safeEditMessage(ctx, doneText, {
      parse_mode: 'Markdown',
      reply_markup: toggleKeyboard,
    });
    return;
  }

  if (source === 'habit_created') {
    const scheduleText = formatScheduleText(habit);
    const footerText = newStatus ? 'Отличное начало! 🔥' : 'Сегодня как раз нужно выполнить — отметь первый раз! ⬇️';
    const message = `✅ *Привычка добавлена!*\n\n${habit.emoji} ${escapeMarkdown(habit.name)}\n📅 ${scheduleText}\n\n${footerText}`;

    await safeEditMessage(ctx, message, {
      parse_mode: 'Markdown',
      reply_markup: createHabitCreatedKeyboard(habitId, { isDueToday: true, emoji: habit.emoji, completed: newStatus }),
    });
    return;
  }

  if (source === 'evening_reminder') {
    const habits = await getUserHabitsWithTodayStatus(user.id, timezoneOffset);
    const todayHabits = habits.filter((h) => h.isDueToday);
    const allCompleted = todayHabits.every((h) => h.completedToday);

    let message = '🌙 *Время подвести итоги дня!*\n\n';
    if (allCompleted) {
      message += '🎉 Все привычки выполнены! Так держать! 💪\n\n';
    } else {
      message += 'Отметь выполненные привычки:\n\n';
    }
    for (const h of todayHabits) {
      const status = h.completedToday ? '✅' : '⬜';
      message += `${status} ${h.emoji} ${escapeMarkdown(h.name)}\n`;
    }

    await safeEditMessage(ctx, message, {
      parse_mode: 'Markdown',
      reply_markup: createEveningChecklistKeyboard(todayHabits),
    });
    return;
  }

  await showHabitsList(ctx, date);
};

/**
 * Side-effects после успешной отметки привычки:
 * - milestone-поздравления (per-habit + overall streak)
 * - refund freeze если backdated день был frozen
 * - earn freeze если overall streak достиг очередного 5-day чекпоинта
 *
 * Fire-and-forget из основного callback'а — ошибки логируются, не блокируют UX.
 */
const processStreakSideEffects = async (
  ctx: BotContext,
  userId: number,
  telegramId: bigint,
  habitId: number,
  targetDate: string,
  todayDate: string
): Promise<void> => {
  try {
    // Refund freeze, если backdated день был frozen
    if (targetDate < todayDate) {
      await refundFreeze(userId, targetDate);
    }

    // Пересчитываем overall streak и пробуем заработать freeze
    const [habits, logs, freezeUsages] = await Promise.all([
      prisma.habit.findMany({ where: { userId } }),
      prisma.habitLog.findMany({
        where: { habit: { userId } },
        select: { habitId: true, date: true, completed: true },
      }),
      prisma.freezeUsage.findMany({
        where: { userId },
        select: { date: true },
      }),
    ]);

    const streakHabits: StreakHabit[] = habits;
    const streakLogs: StreakHabitLog[] = logs;
    const streakFreezes: StreakFreezeUsage[] = freezeUsages;

    const overallStreak = calculateOverallStreak(
      streakHabits,
      streakLogs,
      streakFreezes,
      todayDate
    );

    const earnResult = await tryEarnFreezes(userId, overallStreak);
    if (earnResult.kind === 'earned') {
      const seed = `${userId}:${todayDate}:freeze_earned:${earnResult.newCount}`;
      const variant = pickDeterministic(FREEZE_EARNED_NOTIFICATION, seed);
      const suffix = earnResult.newCount === 2 ? FREEZE_EARNED_SUFFIX_TWO : FREEZE_EARNED_SUFFIX_ONE;
      const text = renderTemplate(variant.text, { suffix });
      try {
        await ctx.api.sendMessage(telegramId.toString(), text, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error('[freeze] failed to send earned notification:', err);
      }
    }

    // Milestone detection
    await detectAndSendMilestones(ctx.api, telegramId, userId, habitId, todayDate);
  } catch (err) {
    console.error('[streak] processStreakSideEffects failed:', err);
  }
};

/**
 * Показывает подтверждение удаления
 */
export const handleHabitDeletePrompt = async (ctx: BotContext, habitId: number): Promise<void> => {
  const habit = await getHabitById(habitId);

  if (!habit) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  await ctx.answerCallbackQuery();

  const message = `
🗑 *Удаление привычки*

Ты уверен, что хочешь удалить привычку "${habit.emoji} ${escapeMarkdown(habit.name)}"?

Это действие нельзя отменить.
  `.trim();

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: createDeleteConfirmKeyboard(habitId),
  });
};

/**
 * Подтверждает удаление привычки
 */
export const handleHabitConfirmDelete = async (ctx: BotContext, habitId: number): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const habit = await getHabitById(habitId);

  if (!habit || habit.userId !== user.id) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  await deleteHabit(habitId);
  void trackEvent(user.id, 'habit_delete', { habitId });
  await ctx.answerCallbackQuery('🗑 Привычка удалена');
  await showHabitsList(ctx);
};

/**
 * Показывает детали привычки
 */
export const handleHabitDetails = async (ctx: BotContext, habitId: number): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const habit = await getHabitById(habitId);

  if (!habit || habit.userId !== user.id) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  await ctx.answerCallbackQuery();

  const schedule = formatScheduleText(habit);
  const reminderLine = habit.reminderTime
    ? `⏰ Напоминание: *${habit.reminderTime}*`
    : '⏰ Напоминание: _не установлено_';

  const message = `
⚙️ *${habit.emoji} ${escapeMarkdown(habit.name)}*

📅 Расписание: _${schedule}_
${reminderLine}
  `.trim();

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createHabitDetailsKeyboard({
      habitId: habit.id,
      reminderTime: habit.reminderTime,
    }),
  });
};

/**
 * Удаляет напоминание привычки
 */
export const handleHabitReminderRemove = async (ctx: BotContext, habitId: number): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const habit = await getHabitById(habitId);

  if (!habit || habit.userId !== user.id) {
    await ctx.answerCallbackQuery('❌ Привычка не найдена');
    return;
  }

  await updateHabitReminder(habitId, null);
  await ctx.answerCallbackQuery('🔕 Напоминание удалено');

  const schedule = formatScheduleText(habit);
  const message = `
⚙️ *${habit.emoji} ${escapeMarkdown(habit.name)}*

📅 Расписание: _${schedule}_
⏰ Напоминание: _не установлено_
  `.trim();

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: createHabitDetailsKeyboard({
      habitId: habit.id,
      reminderTime: null,
    }),
  });
};
