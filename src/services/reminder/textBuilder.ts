/**
 * Сборщик финального текста reminder'а на основе trigger'а из triggerEvaluator.
 *
 * Утренний reminder: header + (overlay-строки) + список привычек + footer.
 * Вечерний reminder: header (фикс) + intro/replacing + (overlay-строки) + список.
 *
 * Все варианты текстов берутся из `src/data/reminderTexts.ts` через
 * detеrminистический выбор.
 *
 * @module services/reminder/textBuilder
 */

import { prisma } from '../../db/index.js';
import { HabitWithTodayStatus } from '../../types/index.js';
import { getTodayDate } from '../../utils/date.js';
import {
  NORMAL_MORNING_HEADERS,
  NORMAL_MORNING_FOOTERS,
  NORMAL_EVENING_HEADER,
  NORMAL_EVENING_INTRO,
  ALL_COMPLETED_EVENING_INTROS,
  MISSED_1_DAY_MORNING,
  MISSED_1_DAY_EVENING,
  MISSED_3_DAYS_MORNING,
  MISSED_3_DAYS_EVENING,
  MISSED_FEW_DAYS_MORNING,
  MISSED_FEW_DAYS_EVENING,
  MISSED_WEEK_MORNING,
  MISSED_WEEK_EVENING,
  MISSED_LONG_MORNING,
  MISSED_LONG_EVENING,
  NEAR_MILESTONE_PER_HABIT,
  NEAR_MILESTONE_OVERALL,
  PERFECT_WEEK_AHEAD,
  FREEZE_USED_OVERLAY,
  FREEZE_USED_SUFFIX_ONE_LEFT,
  FREEZE_USED_SUFFIX_NONE_LEFT,
  NORMAL_PER_HABIT_TEMPLATES,
  HABIT_MISSED_1_DAY,
  HABIT_MISSED_N_DAYS,
  replaceThreeWithTwo,
  type HeaderFooterPair,
  type TextPiece,
} from '../../data/reminderTexts.js';
import {
  evaluateMorningTrigger,
  evaluateEveningTrigger,
  evaluatePerHabitTrigger,
  type Overlay,
  type ReplacingTrigger,
  type EvaluatorContext,
} from '../streak/triggerEvaluator.js';
import {
  pickDeterministic,
  pickWithCooldown,
  recordTemplateSent,
  renderTemplate,
} from '../streak/textSelector.js';
import type {
  StreakFreezeUsage,
  StreakHabit,
  StreakHabitLog,
} from '../streak/calculator.js';

/**
 * Загружает контекст для триггера: привычки юзера, все логи, freeze, freezeCount.
 */
const loadEvaluatorContext = async (
  userId: number,
  todayDate: string
): Promise<EvaluatorContext> => {
  const [habits, logs, freezeUsages, user] = await Promise.all([
    prisma.habit.findMany({ where: { userId } }),
    prisma.habitLog.findMany({
      where: { habit: { userId } },
      select: { habitId: true, date: true, completed: true },
    }),
    prisma.freezeUsage.findMany({
      where: { userId },
      select: { date: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { freezeCount: true },
    }),
  ]);

  const streakHabits: StreakHabit[] = habits.map((h) => ({
    id: h.id,
    frequencyType: h.frequencyType,
    frequencyDays: h.frequencyDays,
    weekdays: h.weekdays,
    createdAt: h.createdAt,
    isActive: h.isActive,
  }));
  const streakLogs: StreakHabitLog[] = logs as StreakHabitLog[];
  const streakFreezes: StreakFreezeUsage[] = freezeUsages as StreakFreezeUsage[];

  const habitMetadata = new Map(
    habits.map((h) => [h.id, { name: h.name, emoji: h.emoji }] as const)
  );

  return {
    habits: streakHabits,
    logs: streakLogs,
    freezeUsages: streakFreezes,
    todayDate,
    currentFreezeCount: user?.freezeCount ?? 0,
    habitMetadata,
  };
};

/** Suffix для freeze_used overlay (по числу оставшихся freeze). */
const freezeUsedSuffix = (remaining: number): string =>
  remaining === 0 ? FREEZE_USED_SUFFIX_NONE_LEFT : FREEZE_USED_SUFFIX_ONE_LEFT;

/**
 * Рендерит overlay-строку (без переноса строки на конце).
 */
const renderOverlay = (overlay: Overlay, seed: string): string => {
  if (overlay.kind === 'freeze_used') {
    const variant = pickDeterministic(FREEZE_USED_OVERLAY, seed);
    return renderTemplate(variant.text, {
      suffix: freezeUsedSuffix(overlay.remainingCount),
    });
  }
  if (overlay.kind === 'near_milestone_habit') {
    const variant = pickDeterministic(NEAR_MILESTONE_PER_HABIT, seed);
    return renderTemplate(variant.text, {
      name: overlay.habitName,
      n: overlay.milestone,
    });
  }
  if (overlay.kind === 'near_milestone_overall') {
    const variant = pickDeterministic(NEAR_MILESTONE_OVERALL, seed);
    return renderTemplate(variant.text, { n: overlay.milestone });
  }
  if (overlay.kind === 'perfect_week_ahead') {
    const variant = pickDeterministic(PERFECT_WEEK_AHEAD, seed);
    return variant.text;
  }
  return '';
};

/** Выбирает header+footer связку для morning missed-trigger'а. */
const pickMorningPair = async (
  replacing: ReplacingTrigger,
  userId: number,
  todayDate: string
): Promise<{ header: string; footer: string; templateId: string }> => {
  let pool: HeaderFooterPair[] = [];
  let applySubstitution = false;

  switch (replacing) {
    case 'missed_1_day':
      pool = MISSED_1_DAY_MORNING;
      break;
    case 'missed_2_days':
      pool = MISSED_3_DAYS_MORNING;
      applySubstitution = true;
      break;
    case 'missed_3_days':
      pool = MISSED_3_DAYS_MORNING;
      break;
    case 'missed_few_days':
      pool = MISSED_FEW_DAYS_MORNING;
      break;
    case 'missed_week':
      pool = MISSED_WEEK_MORNING;
      break;
    case 'missed_long':
      pool = MISSED_LONG_MORNING;
      break;
    case 'normal':
    case 'all_completed':
      throw new Error(`pickMorningPair: unexpected trigger ${replacing}`);
  }

  const seed = `${userId}:${todayDate}:${replacing}:morning-pair`;
  const variant = await pickWithCooldown(pool, seed, userId, todayDate);
  return {
    header: applySubstitution ? replaceThreeWithTwo(variant.header) : variant.header,
    footer: applySubstitution ? replaceThreeWithTwo(variant.footer) : variant.footer,
    templateId: variant.id,
  };
};

/** Выбирает intro (второй абзац) для вечернего missed-trigger'а. */
const pickEveningIntro = async (
  replacing: ReplacingTrigger,
  userId: number,
  todayDate: string
): Promise<{ text: string; templateId: string }> => {
  let pool: TextPiece[] = [];
  let applySubstitution = false;

  switch (replacing) {
    case 'missed_1_day':
      pool = MISSED_1_DAY_EVENING;
      break;
    case 'missed_2_days':
      pool = MISSED_3_DAYS_EVENING;
      applySubstitution = true;
      break;
    case 'missed_3_days':
      pool = MISSED_3_DAYS_EVENING;
      break;
    case 'missed_few_days':
      pool = MISSED_FEW_DAYS_EVENING;
      break;
    case 'missed_week':
      pool = MISSED_WEEK_EVENING;
      break;
    case 'missed_long':
      pool = MISSED_LONG_EVENING;
      break;
    case 'all_completed':
      pool = ALL_COMPLETED_EVENING_INTROS;
      break;
    case 'normal':
      // Normal вечерний — фикс intro, не варьируется. Запись в MessageSent
      // не нужна для фиксированных строк.
      return { text: NORMAL_EVENING_INTRO, templateId: 'normal_evening_fixed' };
  }

  const seed = `${userId}:${todayDate}:${replacing}:evening-intro`;
  const variant = await pickWithCooldown(pool, seed, userId, todayDate);
  return {
    text: applySubstitution ? replaceThreeWithTwo(variant.text) : variant.text,
    templateId: variant.id,
  };
};

/**
 * Сборщик утреннего reminder'а.
 *
 * @param userId DB ID юзера
 * @param timezoneOffset offset в минутах
 * @param todayHabits Привычки на сегодня (due-today)
 * @param formatHabitLine Колбэк форматирующий одну строку привычки в списке
 *   (передаётся из senders.ts для DRY)
 */
export const buildMorningReminder = async (
  userId: number,
  timezoneOffset: number,
  todayHabits: HabitWithTodayStatus[],
  formatHabitLine: (habit: HabitWithTodayStatus) => string
): Promise<string> => {
  const todayDate = getTodayDate(timezoneOffset);
  const ctx = await loadEvaluatorContext(userId, todayDate);
  const trigger = evaluateMorningTrigger(ctx);

  let headerText: string;
  let footerText: string;
  let triggerLabel: string;

  if (trigger.replacing === 'normal') {
    const headerSeed = `${userId}:${todayDate}:normal_morning_header`;
    const footerSeed = `${userId}:${todayDate}:normal_morning_footer`;
    const headerVariant = pickDeterministic(NORMAL_MORNING_HEADERS, headerSeed);
    const footerVariant = pickDeterministic(NORMAL_MORNING_FOOTERS, footerSeed);
    headerText = headerVariant.text;
    footerText = footerVariant.text;
    triggerLabel = 'normal_morning';
    // Запись MessageSent для cooldown
    await recordTemplateSent(userId, headerVariant.id, 'normal_morning', todayDate).catch(() => undefined);
    await recordTemplateSent(userId, footerVariant.id, 'normal_morning', todayDate).catch(() => undefined);
  } else {
    const pair = await pickMorningPair(trigger.replacing, userId, todayDate);
    headerText = pair.header;
    footerText = pair.footer;
    triggerLabel = trigger.replacing;
    await recordTemplateSent(userId, pair.templateId, trigger.replacing, todayDate).catch(() => undefined);
  }

  let message = headerText + '\n\n';

  // Overlays перед списком
  for (const overlay of trigger.overlays) {
    const overlaySeed = `${userId}:${todayDate}:${triggerLabel}:${overlay.kind}`;
    const text = renderOverlay(overlay, overlaySeed);
    if (text) {
      message += text + '\n\n';
    }
  }

  // Список привычек
  for (const habit of todayHabits) {
    const line = formatHabitLine(habit);
    message += `• ${habit.emoji} ${habit.name} _(${line})_\n`;
  }

  message += '\n' + footerText;
  return message;
};

/**
 * Сборщик вечернего reminder'а.
 */
export const buildEveningReminder = async (
  userId: number,
  timezoneOffset: number,
  todayHabits: HabitWithTodayStatus[]
): Promise<string> => {
  const todayDate = getTodayDate(timezoneOffset);
  const ctx = await loadEvaluatorContext(userId, todayDate);
  const trigger = evaluateEveningTrigger(ctx);

  const intro = await pickEveningIntro(trigger.replacing, userId, todayDate);
  if (trigger.replacing !== 'normal') {
    await recordTemplateSent(userId, intro.templateId, trigger.replacing, todayDate).catch(
      () => undefined
    );
  }

  let message = NORMAL_EVENING_HEADER + '\n\n';

  // Overlays перед intro и списком — вставляем после header'а (первый абзац — фикс)
  for (const overlay of trigger.overlays) {
    // freeze_used не показывается в evening — фильтруем
    if (overlay.kind === 'freeze_used') continue;
    const overlaySeed = `${userId}:${todayDate}:evening:${overlay.kind}`;
    const text = renderOverlay(overlay, overlaySeed);
    if (text) {
      message += text + '\n\n';
    }
  }

  message += intro.text + '\n\n';

  for (const habit of todayHabits) {
    const status = habit.completedToday ? '✅' : '⬜';
    message += `${status} ${habit.emoji} ${habit.name}\n`;
  }

  return message;
};

/**
 * Сборщик per-habit reminder'а. Возвращает финальный текст «⏰ ... *эмодзи имя*»
 * с учётом trigger'а (normal / habit_missed_1_day / habit_missed_n_days).
 */
export const buildPerHabitReminder = async (
  userId: number,
  timezoneOffset: number,
  habit: { id: number; name: string; emoji: string; frequencyType: string; frequencyDays: number; weekdays: string | null; createdAt: Date; isActive: boolean }
): Promise<string> => {
  const todayDate = getTodayDate(timezoneOffset);

  const logs = await prisma.habitLog.findMany({
    where: { habit: { userId } },
    select: { habitId: true, date: true, completed: true },
  });

  const streakHabit: StreakHabit = {
    id: habit.id,
    frequencyType: habit.frequencyType,
    frequencyDays: habit.frequencyDays,
    weekdays: habit.weekdays,
    createdAt: habit.createdAt,
    isActive: habit.isActive,
  };

  const trigger = evaluatePerHabitTrigger(streakHabit, logs as StreakHabitLog[], todayDate);

  let pool: TextPiece[];
  switch (trigger) {
    case 'habit_missed_1_day':
      pool = HABIT_MISSED_1_DAY;
      break;
    case 'habit_missed_n_days':
      pool = HABIT_MISSED_N_DAYS;
      break;
    case 'normal':
    default:
      pool = NORMAL_PER_HABIT_TEMPLATES;
      break;
  }

  const seed = `${userId}:${habit.id}:${todayDate}:${trigger}`;
  const variant = await pickWithCooldown(pool, seed, userId, todayDate);
  await recordTemplateSent(userId, variant.id, `per_habit_${trigger}`, todayDate).catch(
    () => undefined
  );

  return renderTemplate(variant.text, {
    emoji: habit.emoji,
    name: habit.name,
  });
};
