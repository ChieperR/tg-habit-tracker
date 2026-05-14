/**
 * Принимает решение какой trigger fires для юзера сегодня (для morning/evening
 * reminder'ов) и какой trigger fires для конкретной привычки в per-habit
 * reminder'е.
 *
 * **Resolution rules:**
 * - Replacing-trigger вычисляется по `countConsecutiveMissedDays` (см. calculator).
 *   Bucket'ы: 0 → normal, 1 → missed_1_day, 2 → missed_2_days, 3 → missed_3_days,
 *   4-6 → missed_few_days, 7-13 → missed_week, 14+ → missed_long.
 * - Если вчера был покрыт freeze (FreezeUsage есть, missed=0 формально) →
 *   replacing-trigger становится `normal`, плюс добавляется overlay
 *   `freeze_used` с подсчётом freeze в инвентаре.
 * - Overlay `near_milestone` добавляется только при `normal` replacing-trigger'е
 *   (при missed логически не может быть, так как стрик сломан).
 * - Overlay `perfect_week_ahead` тоже только при `normal`.
 * - `all_completed` (вечерний) — отдельный случай заменяющий intro второго
 *   абзаца, имеет приоритет над `normal`. Если есть due-привычки сегодня и все
 *   выполнены → all_completed.
 *
 * Per-habit: trigger зависит только от того сколько consecutive due-days этой
 * привычки пропущено. 0 → normal, 1 → habit_missed_1_day, 2+ →
 * habit_missed_n_days.
 *
 * @module services/streak/triggerEvaluator
 */

import {
  isHabitDue,
  isPerfectWeekAhead,
  calculateOverallStreak,
  calculatePerHabitStreak,
  countConsecutiveMissedDays,
  countHabitConsecutiveMissedDueDays,
  findNearMilestone,
  type StreakHabit,
  type StreakHabitLog,
  type StreakFreezeUsage,
} from './calculator.js';
import { getPrevDate } from '../../utils/date.js';

/** Replacing-trigger (заменяет normal-обёртку). */
export type ReplacingTrigger =
  | 'normal'
  | 'missed_1_day'
  | 'missed_2_days'
  | 'missed_3_days'
  | 'missed_few_days'
  | 'missed_week'
  | 'missed_long'
  | 'all_completed';

/** Имя\эмодзи привычки для overlay'ев. */
export type OverlayHabitInfo = {
  id: number;
  name: string;
  emoji: string;
};

/** Overlay-trigger (добавляется поверх). */
export type Overlay =
  | { kind: 'freeze_used'; remainingCount: number }
  /** 1-2 привычки на одном milestone (рендерится через NEAR_MILESTONE_PER_HABIT для 1 / _TWO для 2). */
  | { kind: 'near_milestone_habit'; milestone: number; habits: OverlayHabitInfo[] }
  /** Summary — остальные habits близкие к стрикам, без указания milestone. */
  | { kind: 'near_milestone_habit_summary'; habits: OverlayHabitInfo[] }
  | { kind: 'near_milestone_overall'; milestone: number }
  | { kind: 'perfect_week_ahead' };

/** Решение для morning/evening reminder'а. */
export type ReminderTrigger = {
  replacing: ReplacingTrigger;
  overlays: Overlay[];
};

/** Bucket по числу consecutive missed days. */
const bucketMissedDays = (n: number): ReplacingTrigger => {
  if (n <= 0) return 'normal';
  if (n === 1) return 'missed_1_day';
  if (n === 2) return 'missed_2_days';
  if (n === 3) return 'missed_3_days';
  if (n <= 6) return 'missed_few_days';
  if (n <= 13) return 'missed_week';
  return 'missed_long';
};

/** Milestone-значения для per-habit стрика. */
const PER_HABIT_MILESTONES = [3, 5, 10, 15, 30];
/** Milestone-значения для overall стрика. */
const OVERALL_MILESTONES = [3, 5, 7, 14, 30, 60, 100];

/**
 * Контекст для evaluator'а: pre-fetched данные юзера.
 */
export type EvaluatorContext = {
  habits: StreakHabit[];
  logs: StreakHabitLog[];
  freezeUsages: StreakFreezeUsage[];
  todayDate: string;
  /** Текущий freezeCount юзера (для freeze_used overlay при списании). */
  currentFreezeCount: number;
  /** Habits и их имена/эмодзи для overlay'ев. */
  habitMetadata?: Map<number, { name: string; emoji: string }>;
};

/** Параметры для wasFrozen yesterday — нужно знать был ли вчера freeze. */
const wasFrozenYesterday = (ctx: EvaluatorContext): boolean => {
  const yesterday = getPrevDate(ctx.todayDate);
  return ctx.freezeUsages.some((f) => f.date === yesterday);
};

/**
 * Evaluator для УТРЕННЕГО reminder'а.
 *
 * Logic:
 * 1. Если вчера был freeze → replacing=normal, overlay=freeze_used.
 * 2. Иначе считаем missed days → bucket → replacing-trigger.
 * 3. Если replacing=normal:
 *    - Считаем overall стрик, проверяем near_milestone overall.
 *    - Для каждой due-сегодня привычки считаем per-habit стрик, проверяем
 *      near_milestone habit.
 *    - Проверяем perfect_week_ahead.
 */
export const evaluateMorningTrigger = (ctx: EvaluatorContext): ReminderTrigger => {
  const overlays: Overlay[] = [];

  if (wasFrozenYesterday(ctx)) {
    overlays.push({ kind: 'freeze_used', remainingCount: ctx.currentFreezeCount });
    return { replacing: 'normal', overlays };
  }

  const missedCount = countConsecutiveMissedDays(
    ctx.habits,
    ctx.logs,
    ctx.freezeUsages,
    ctx.todayDate
  );
  const replacing = bucketMissedDays(missedCount);

  if (replacing !== 'normal') {
    return { replacing, overlays };
  }

  // Normal — собираем overlay'и
  const yesterday = getPrevDate(ctx.todayDate);
  const overallStreak = calculateOverallStreak(
    ctx.habits,
    ctx.logs,
    ctx.freezeUsages,
    // Берём вчерашнюю дату для near_milestone проверки: streak уже сложился,
    // сегодня его можно нарастить ещё на 1.
    yesterday
  );
  const overallNext = findNearMilestone(overallStreak, OVERALL_MILESTONES);
  if (overallNext !== null) {
    overlays.push({ kind: 'near_milestone_overall', milestone: overallNext });
  }

  // Per-habit near milestone — только для due-сегодня привычек.
  // Группируем по milestone, приоритет: больший milestone впереди. Внутри
  // группы приоритет: созданные раньше (createdAt ASC). Максимум 2 habits в
  // одной группе. Максимум 2 группы с конкретикой; остальные → summary.
  collectPerHabitOverlays(ctx, yesterday, overlays);

  if (isPerfectWeekAhead(ctx.habits, ctx.logs, ctx.todayDate)) {
    overlays.push({ kind: 'perfect_week_ahead' });
  }

  return { replacing: 'normal', overlays };
};

/**
 * Evaluator для ВЕЧЕРНЕГО reminder'а.
 *
 * Logic похожая на morning, но:
 * - freeze_used overlay НЕ показывается в evening (только в morning).
 * - all_completed: если все due-сегодня привычки уже выполнены — replacing=all_completed.
 */
export const evaluateEveningTrigger = (ctx: EvaluatorContext): ReminderTrigger => {
  const overlays: Overlay[] = [];

  // Если все due-сегодня привычки выполнены — all_completed (приоритет над missed/normal).
  const todayDue = ctx.habits.filter((h) => h.isActive && isHabitDue(h, ctx.todayDate, ctx.logs));
  if (todayDue.length > 0) {
    const completedSet = new Set(
      ctx.logs.filter((l) => l.date === ctx.todayDate && l.completed).map((l) => l.habitId)
    );
    const allDone = todayDue.every((h) => completedSet.has(h.id));
    if (allDone) {
      return { replacing: 'all_completed', overlays };
    }
  }

  // Missed-bucket — как у morning (но без freeze_used overlay в evening).
  const yesterdayFrozen = wasFrozenYesterday(ctx);
  const missedCount = yesterdayFrozen
    ? 0
    : countConsecutiveMissedDays(ctx.habits, ctx.logs, ctx.freezeUsages, ctx.todayDate);
  const replacing = bucketMissedDays(missedCount);

  if (replacing !== 'normal') {
    return { replacing, overlays };
  }

  // Normal — overlay'и
  const yesterday = getPrevDate(ctx.todayDate);
  const overallStreak = calculateOverallStreak(
    ctx.habits,
    ctx.logs,
    ctx.freezeUsages,
    yesterday
  );
  const overallNext = findNearMilestone(overallStreak, OVERALL_MILESTONES);
  if (overallNext !== null) {
    overlays.push({ kind: 'near_milestone_overall', milestone: overallNext });
  }

  collectPerHabitOverlays(ctx, yesterday, overlays);

  if (isPerfectWeekAhead(ctx.habits, ctx.logs, ctx.todayDate)) {
    overlays.push({ kind: 'perfect_week_ahead' });
  }

  return { replacing: 'normal', overlays };
};

/** Тип trigger для per-habit reminder'а. */
export type PerHabitTrigger = 'normal' | 'habit_missed_1_day' | 'habit_missed_n_days';

/**
 * Evaluator для PER-HABIT reminder'а (конкретная привычка).
 *
 * Считает сколько consecutive due-дней этой привычки пропущено (включая
 * сегодня — если сегодня due и ещё не отмечена, это уже missed-кандидат).
 *
 * Но: на момент per-habit reminder'а сегодня ещё не закончился, юзер может
 * отметить. Поэтому считаем missed_due_days до вчерашней даты (excluding today).
 *
 * - 0 (вчера на due-дне была отметка) → normal
 * - 1 (вчера на due-дне не было отметки) → habit_missed_1_day
 * - 2+ → habit_missed_n_days
 */
/**
 * Собирает overlay'и near_milestone_habit для всех due-привычек:
 * - группирует кандидатов по milestone
 * - сортирует группы DESC по milestone (больший приоритет)
 * - в каждой группе берёт максимум 2 habit'а (по createdAt ASC — старые первыми)
 * - максимум 2 группы → конкретные overlay'и
 * - остальные habits → summary overlay (max 3 имён + «и ещё N»)
 */
const collectPerHabitOverlays = (
  ctx: EvaluatorContext,
  yesterday: string,
  overlays: Overlay[]
): void => {
  const dueHabits = ctx.habits.filter(
    (h) => h.isActive && isHabitDue(h, ctx.todayDate, ctx.logs)
  );
  if (dueHabits.length === 0) return;

  // 1. Собираем кандидатов (habit, milestone)
  const candidates: Array<{ habit: StreakHabit; milestone: number }> = [];
  for (const habit of dueHabits) {
    const streak = calculatePerHabitStreak(habit, ctx.logs, ctx.freezeUsages, yesterday);
    const next = findNearMilestone(streak, PER_HABIT_MILESTONES);
    if (next !== null) {
      candidates.push({ habit, milestone: next });
    }
  }
  if (candidates.length === 0) return;

  // 2. Группируем по milestone
  const byMilestone = new Map<number, StreakHabit[]>();
  for (const c of candidates) {
    const list = byMilestone.get(c.milestone) ?? [];
    list.push(c.habit);
    byMilestone.set(c.milestone, list);
  }

  // 3. Внутри группы: сортируем по createdAt ASC (старые первыми), берём top-2
  type Group = { milestone: number; habits: StreakHabit[]; leftover: StreakHabit[] };
  const groups: Group[] = [];
  for (const [milestone, habits] of byMilestone) {
    const sorted = [...habits].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    groups.push({
      milestone,
      habits: sorted.slice(0, 2),
      leftover: sorted.slice(2),
    });
  }
  // 4. Сортируем группы DESC по milestone
  groups.sort((a, b) => b.milestone - a.milestone);

  // 5. Топ-2 групп — конкретные overlay'и
  const detailedGroups = groups.slice(0, 2);
  const tailGroups = groups.slice(2);
  for (const g of detailedGroups) {
    overlays.push({
      kind: 'near_milestone_habit',
      milestone: g.milestone,
      habits: g.habits.map((h) => habitToInfo(h, ctx)),
    });
  }

  // 6. Summary: leftover habits из топ-групп + все habits из tail групп
  const summaryHabits: StreakHabit[] = [];
  for (const g of detailedGroups) {
    summaryHabits.push(...g.leftover);
  }
  for (const g of tailGroups) {
    summaryHabits.push(...g.habits, ...g.leftover);
  }
  if (summaryHabits.length > 0) {
    overlays.push({
      kind: 'near_milestone_habit_summary',
      habits: summaryHabits.map((h) => habitToInfo(h, ctx)),
    });
  }
};

/** Извлекает name/emoji habit'а из ctx.habitMetadata (fallback на пустоты). */
const habitToInfo = (habit: StreakHabit, ctx: EvaluatorContext): OverlayHabitInfo => {
  const meta = ctx.habitMetadata?.get(habit.id);
  return {
    id: habit.id,
    name: meta?.name ?? '',
    emoji: meta?.emoji ?? '',
  };
};

export const evaluatePerHabitTrigger = (
  habit: StreakHabit,
  logs: StreakHabitLog[],
  todayDate: string
): PerHabitTrigger => {
  // Считаем missed до вчера (excluding today)
  const yesterday = getPrevDate(todayDate);
  const missed = countHabitConsecutiveMissedDueDays(habit, logs, yesterday);
  if (missed <= 0) return 'normal';
  if (missed === 1) return 'habit_missed_1_day';
  return 'habit_missed_n_days';
};
