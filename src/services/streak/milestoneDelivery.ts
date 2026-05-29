/**
 * Доставка milestone-поздравлений после успешной отметки привычки.
 *
 * Поток:
 * 1. После `habit_toggle` callback'а (когда отметка зафиксирована) зовём
 *    `detectAndSendMilestones`.
 * 2. Считаем per-habit streak (для этой habit) и overall streak.
 * 3. Если значение совпало с одним из milestone'ов:
 *    - вызываем `recordMilestone` (idempotent через unique constraint)
 *    - выбираем вариант текста (учитывая firstOnly)
 *    - проверяем early-adopter bonus
 *    - отправляем сообщение с Telegram effect_id'ами
 *
 * Если несколько milestone'ов сработали в одну отметку (per-habit 5 + overall
 * 7) — отправляется ОДИН сводный месседж (НЕ два отдельных).
 *
 * @module services/streak/milestoneDelivery
 */

import type { Api, RawApi } from 'grammy';
import { prisma } from '../../db/index.js';
import {
  PER_HABIT_MILESTONES,
  OVERALL_MILESTONES,
  EARLY_ADOPTER_BONUS_TEMPLATE,
  type MilestoneScope,
  type MilestoneTextSet,
  type MilestoneVariant,
} from '../../data/milestoneTexts.js';
import {
  calculateOverallStreak,
  calculatePerHabitStreak,
  type StreakHabit,
  type StreakHabitLog,
  type StreakFreezeUsage,
} from './calculator.js';
import {
  pickDeterministic,
  renderTemplate,
} from './textSelector.js';
import { escapeMarkdown } from '../../utils/telegram.js';
import {
  recordMilestone,
  isFirstAchievementOfMilestone,
  getEarlyAdopterRank,
  qualifiesForEarlyAdopterBonus,
} from './achievementService.js';

/** Сводное описание сработавшего milestone'а. */
type TriggeredMilestone = {
  scope: MilestoneScope;
  habitId: number | null;
  habitName: string | null;
  milestone: number;
  isFirstTime: boolean;
  earlyAdopterRank: number | null;
  textSet: MilestoneTextSet;
};

/**
 * Главная функция: после успешной отметки habit'а вызывается, проверяет
 * milestone'ы (per-habit для этой habit, overall) и отправляет сводное
 * сообщение если что-то сработало.
 *
 * @param api grammY Api инстанс (ctx.api или bot.api)
 * @param telegramId Telegram ID юзера (для sendMessage)
 * @param userId DB ID юзера
 * @param habitId DB ID привычки, которую только что отметили
 * @param asOfDate Дата за которую засчитана отметка (YYYY-MM-DD в timezone
 *   юзера). Может отличаться от «сегодня» если юзер отметил backdated через
 *   weekly calendar или из старого reminder'а — стрик и milestone считаются
 *   именно на эту дату.
 */
export const detectAndSendMilestones = async (
  api: Api<RawApi>,
  telegramId: bigint,
  userId: number,
  habitId: number,
  asOfDate: string
): Promise<void> => {
  // Fetch user habits / logs / freezes
  const habits = (await prisma.habit.findMany({
    where: { userId },
  })) as unknown as StreakHabit[];

  const logs = (await prisma.habitLog.findMany({
    where: { habit: { userId } },
    select: { habitId: true, date: true, completed: true },
  })) as StreakHabitLog[];

  const freezeUsages = (await prisma.freezeUsage.findMany({
    where: { userId },
    select: { date: true },
  })) as StreakFreezeUsage[];

  const habit = habits.find((h) => h.id === habitId);
  if (!habit) return;

  const triggered: TriggeredMilestone[] = [];

  // Per-habit streak check
  const perHabitStreak = calculatePerHabitStreak(habit, logs, freezeUsages, asOfDate);
  if (PER_HABIT_MILESTONES.some((set) => set.milestone === perHabitStreak)) {
    const set = PER_HABIT_MILESTONES.find((s) => s.milestone === perHabitStreak)!;
    const isNew = await recordMilestone(userId, 'habit', habitId, perHabitStreak);
    if (isNew) {
      const isFirst = await isFirstAchievementOfMilestone(userId, 'habit', perHabitStreak);
      const rank = await getEarlyAdopterRank(userId, 'habit', habitId, perHabitStreak);
      const habitName = await prisma.habit
        .findUnique({ where: { id: habitId }, select: { name: true } })
        .then((h) => h?.name ?? '');
      triggered.push({
        scope: 'habit',
        habitId,
        habitName,
        milestone: perHabitStreak,
        isFirstTime: isFirst,
        earlyAdopterRank: rank,
        textSet: set,
      });
    }
  }

  // Overall streak check
  const overallStreak = calculateOverallStreak(habits, logs, freezeUsages, asOfDate);
  if (OVERALL_MILESTONES.some((set) => set.milestone === overallStreak)) {
    const set = OVERALL_MILESTONES.find((s) => s.milestone === overallStreak)!;
    const isNew = await recordMilestone(userId, 'overall', null, overallStreak);
    if (isNew) {
      const isFirst = await isFirstAchievementOfMilestone(userId, 'overall', overallStreak);
      const rank = await getEarlyAdopterRank(userId, 'overall', null, overallStreak);
      triggered.push({
        scope: 'overall',
        habitId: null,
        habitName: null,
        milestone: overallStreak,
        isFirstTime: isFirst,
        earlyAdopterRank: rank,
        textSet: set,
      });
    }
  }

  if (triggered.length === 0) return;

  // Собираем сводный текст и эффекты
  const message = buildMessage(triggered, userId, asOfDate);
  const effectIds = mergeEffectIds(triggered);

  try {
    await api.sendMessage(telegramId.toString(), message, {
      parse_mode: 'Markdown',
      // grammY API типизирован, message_effect_id передаётся через `other`
      ...(effectIds[0] ? { message_effect_id: effectIds[0] } : {}),
    } as Parameters<typeof api.sendMessage>[2]);
  } catch (err) {
    console.error('[milestoneDelivery] failed to send congratulation:', err);
    return;
  }

  // Если есть дополнительные эффекты (heart вслед за салютом) — отправляем
  // отдельным небольшим сообщением. Применимо к overall 30/60/100.
  if (effectIds.length > 1) {
    try {
      await api.sendMessage(telegramId.toString(), '❤️', {
        message_effect_id: effectIds[1],
      } as Parameters<typeof api.sendMessage>[2]);
    } catch (err) {
      console.error('[milestoneDelivery] failed to send secondary effect:', err);
    }
  }
};

/**
 * Собирает финальный текст из сработавших milestone'ов. Если их больше одного
 * — формируется сводное сообщение (один заголовок «Двойное достижение» + по
 * блоку на каждый milestone).
 */
const buildMessage = (
  triggered: TriggeredMilestone[],
  userId: number,
  asOfDate: string
): string => {
  if (triggered.length === 1) {
    return renderMilestoneBlock(triggered[0]!, userId, asOfDate);
  }

  const parts = triggered.map((t) => renderMilestoneBlock(t, userId, asOfDate));
  const header =
    triggered.length === 2
      ? '🎯 *Двойное достижение!*'
      : triggered.length === 3
      ? '🎯 *Тройное достижение!*'
      : '🎯 *Несколько достижений!*';
  return [header, ...parts].join('\n\n');
};

/** Рендерит один milestone-блок: основной текст + early-adopter bonus если есть. */
const renderMilestoneBlock = (
  triggered: TriggeredMilestone,
  userId: number,
  asOfDate: string
): string => {
  // Выбираем подходящий вариант: фильтруем firstOnly если не первое достижение
  const variants: MilestoneVariant[] = triggered.textSet.variants.filter(
    (v) => triggered.isFirstTime || !v.firstOnly
  );
  // Сначала pickаем из firstOnly если first time и они есть — даёт особый текст
  const firstOnlyVariants = triggered.textSet.variants.filter((v) => v.firstOnly);
  const pool = triggered.isFirstTime && firstOnlyVariants.length > 0 ? firstOnlyVariants : variants;

  const seed = `${userId}:${triggered.scope}:${triggered.habitId ?? 'overall'}:${triggered.milestone}:${asOfDate}`;
  const variant = pickDeterministic(pool, seed);

  let text = renderTemplate(variant.text, {
    name: escapeMarkdown(triggered.habitName ?? ''),
  });

  if (qualifiesForEarlyAdopterBonus(triggered.earlyAdopterRank)) {
    const bonus = renderTemplate(EARLY_ADOPTER_BONUS_TEMPLATE, {
      n: triggered.earlyAdopterRank!,
    });
    text += `\n\n${bonus}`;
  }

  return text;
};

/**
 * Объединяет effect_ids из сработавших milestone'ов (берём набор первого по
 * приоритету: per-habit > overall если оба сработали; иначе единственный).
 * Возвращает максимум 2 effect_id (некоторые milestone'ы имеют 2 — салют+сердце).
 */
const mergeEffectIds = (triggered: TriggeredMilestone[]): string[] => {
  // Приоритет: если есть overall 30/60/100 → используем его (он имеет 🎉+❤️).
  // Иначе если есть per-habit 30 → его. Иначе первый сработавший.
  const overall = triggered.find((t) => t.scope === 'overall');
  const habit = triggered.find((t) => t.scope === 'habit');
  const primary = overall ?? habit ?? triggered[0]!;
  return [...primary.textSet.effectIds];
};
