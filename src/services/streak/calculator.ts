/**
 * Pure-функции для расчёта стриков и связанных показателей.
 *
 * **Определения:**
 * - Per-habit streak — последовательность due-дней этой привычки, закрытых
 *   completion log'ом ИЛИ freeze'ом. Non-due дни не считаются (счётчик замирает).
 * - Overall (activity) streak — последовательность дней, в каждый из которых
 *   хотя бы одна due-привычка закрыта ИЛИ день покрыт freeze. Дни без due-привычек
 *   не ломают стрик, но и не наращивают его (нейтральные).
 * - Perfect day — все due-привычки этого дня закрыты completion log'ом (freeze
 *   НЕ считается perfect).
 *
 * Функции pure: принимают данные как аргументы (logs/freezes/habits), не зовут
 * БД. Это даёт легкость тестирования.
 *
 * @module services/streak/calculator
 */

import { differenceInDays, format, parse, subDays } from 'date-fns';
import { isHabitDueOnDate } from '../../utils/date.js';

/**
 * Минимальная форма привычки, нужная для расчётов стрика.
 * Не привязано к Prisma-типу — pure-функции принимают plain objects.
 */
export type StreakHabit = {
  id: number;
  frequencyType: string;
  frequencyDays: number;
  weekdays: string | null;
  createdAt: Date;
  isActive: boolean;
};

/** Минимальная форма HabitLog для расчётов. */
export type StreakHabitLog = {
  habitId: number;
  date: string;
  completed: boolean;
};

/** Минимальная форма FreezeUsage (нужна только дата). */
export type StreakFreezeUsage = {
  date: string;
};

/**
 * Возвращает effective «дата начала жизни» привычки для streak-расчётов.
 *
 * Если у привычки есть completion log'и с датой РАНЬШЕ `habit.createdAt`
 * (юзер backdate'нул через weekly calendar), считаем что фактически привычка
 * существовала с того раннего completion'а — иначе streak-логика
 * проигнорирует backdated дни.
 */
export const getEffectiveStartDate = (habit: StreakHabit, logs: StreakHabitLog[]): string => {
  const habitCreatedDate = format(habit.createdAt, 'yyyy-MM-dd');
  const ownCompleted = logs.filter((l) => l.habitId === habit.id && l.completed);
  if (ownCompleted.length === 0) return habitCreatedDate;
  let earliest = ownCompleted[0]!.date;
  for (const l of ownCompleted) {
    if (l.date < earliest) earliest = l.date;
  }
  return earliest < habitCreatedDate ? earliest : habitCreatedDate;
};

/**
 * Возвращает referenceDate для habit (для interval-расписания).
 * Это дата первого completion (если есть), иначе дата создания привычки.
 */
const getHabitReferenceDate = (habit: StreakHabit, logs: StreakHabitLog[]): string => {
  const habitLogs = logs.filter((l) => l.habitId === habit.id && l.completed);
  if (habitLogs.length === 0) {
    return format(habit.createdAt, 'yyyy-MM-dd');
  }
  const sorted = [...habitLogs].sort((a, b) => a.date.localeCompare(b.date));
  return sorted[0]!.date;
};

/**
 * Проверяет была ли привычка due в указанную дату.
 *
 * **Performance:** для горячих циклов передавать `referenceDate` явно, чтобы не
 * пересчитывать его на каждой итерации (см. calculatePerHabitStreak и
 * calculateOverallStreak — они precompute reference перед loop).
 */
export const isHabitDue = (
  habit: StreakHabit,
  dateStr: string,
  logs: StreakHabitLog[],
  referenceDate?: string,
  effectiveStartDate?: string
): boolean => {
  // Нижняя граница «существования» привычки. По умолчанию — habit.createdAt.
  // Per-habit calculator'ы передают effectiveStartDate (`min(createdAt, earliest_completed)`),
  // чтобы backdated completion дни ДО createdAt тоже считались due.
  const lowerBound = effectiveStartDate ?? format(habit.createdAt, 'yyyy-MM-dd');
  if (dateStr < lowerBound) return false;

  return isHabitDueOnDate({
    frequencyType: habit.frequencyType as 'daily' | 'interval' | 'weekdays',
    frequencyDays: habit.frequencyDays,
    weekdays: habit.weekdays,
    referenceDate: referenceDate ?? getHabitReferenceDate(habit, logs),
    dateStr,
  });
};

/**
 * Рассчитывает per-habit streak (на конец указанной даты включительно).
 *
 * Логика: идём назад от endDate, на каждой due-дате проверяем completion log
 * или freeze. Если ни того ни другого — streak обрывается. Non-due дни
 * пропускаем без учёта.
 *
 * @param habit Привычка
 * @param logs Все log'и привычки (можно передавать только relevantные)
 * @param freezeUsages Использованные freeze дни юзера
 * @param endDate Дата окончания расчёта (YYYY-MM-DD)
 * @param maxDays Максимальная глубина поиска вглубь (default 365 — на год)
 */
export const calculatePerHabitStreak = (
  habit: StreakHabit,
  logs: StreakHabitLog[],
  freezeUsages: StreakFreezeUsage[],
  endDate: string,
  maxDays: number = 365
): number => {
  if (!habit.isActive) return 0;

  const completedDates = new Set(
    logs.filter((l) => l.habitId === habit.id && l.completed).map((l) => l.date)
  );
  const frozenDates = new Set(freezeUsages.map((f) => f.date));

  const startDate = getEffectiveStartDate(habit, logs);
  const referenceDate = getHabitReferenceDate(habit, logs);
  let streak = 0;
  const cursor = parse(endDate, 'yyyy-MM-dd', new Date());

  for (let i = 0; i < maxDays; i++) {
    const cursorStr = format(cursor, 'yyyy-MM-dd');
    if (cursorStr < startDate) break;

    if (isHabitDue(habit, cursorStr, logs, referenceDate, startDate)) {
      if (completedDates.has(cursorStr) || frozenDates.has(cursorStr)) {
        streak++;
      } else {
        // Due-день без completion и без freeze → streak обрывается.
        break;
      }
    }
    // Non-due день — пропускаем, streak не меняется.

    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
};

/**
 * Лояльная версия `calculatePerHabitStreak` для UI «текущего стрика».
 *
 * Если `endDate` (обычно today) — due-день и НЕ покрыт completion/freeze,
 * пропускаем именно его («открытый период», у юзера ещё есть остаток дня
 * чтобы отметить) и продолжаем считать назад. Эквивалентно
 * `max(calculatePerHabitStreak(today), calculatePerHabitStreak(yesterday))`
 * за один проход.
 *
 * Если `endDate` non-due (например выходной у weekdays-привычки), grace НЕ
 * переносится на следующий встреченный due-день — иначе мы бы прощали
 * вчерашний пропуск через целые выходные.
 */
export const calculatePerHabitStreakLenient = (
  habit: StreakHabit,
  logs: StreakHabitLog[],
  freezeUsages: StreakFreezeUsage[],
  endDate: string,
  maxDays: number = 365
): number => {
  if (!habit.isActive) return 0;

  const completedDates = new Set(
    logs.filter((l) => l.habitId === habit.id && l.completed).map((l) => l.date)
  );
  const frozenDates = new Set(freezeUsages.map((f) => f.date));

  const startDate = getEffectiveStartDate(habit, logs);
  const referenceDate = getHabitReferenceDate(habit, logs);
  let streak = 0;
  const cursor = parse(endDate, 'yyyy-MM-dd', new Date());

  for (let i = 0; i < maxDays; i++) {
    const cursorStr = format(cursor, 'yyyy-MM-dd');
    if (cursorStr < startDate) break;

    if (isHabitDue(habit, cursorStr, logs, referenceDate, startDate)) {
      if (completedDates.has(cursorStr) || frozenDates.has(cursorStr)) {
        streak++;
      } else if (i === 0) {
        // endDate due, но ещё не отмечен — open period, пропускаем
        // только эту первую итерацию, дальше обрыв строгий.
      } else {
        break;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
};

/**
 * Рассчитывает максимальный per-habit streak за всю историю привычки.
 *
 * Идём от habit.createdAt до endDate, день за днём. Для каждой due-даты
 * проверяем completion log или freeze. Если есть — текущий run++. Если нет —
 * фиксируем max(maxStreak, currentRun) и обнуляем run. Non-due дни не меняют
 * счётчик (так же как в calculatePerHabitStreak).
 */
export const calculatePerHabitMaxStreak = (
  habit: StreakHabit,
  logs: StreakHabitLog[],
  freezeUsages: StreakFreezeUsage[],
  endDate: string
): number => {
  if (!habit.isActive) return 0;

  const completedDates = new Set(
    logs.filter((l) => l.habitId === habit.id && l.completed).map((l) => l.date)
  );
  const frozenDates = new Set(freezeUsages.map((f) => f.date));

  const startDate = getEffectiveStartDate(habit, logs);
  const referenceDate = getHabitReferenceDate(habit, logs);

  let maxStreak = 0;
  let currentRun = 0;
  const cursor = parse(startDate, 'yyyy-MM-dd', new Date());

  while (true) {
    const cursorStr = format(cursor, 'yyyy-MM-dd');
    if (cursorStr > endDate) break;
    if (isHabitDue(habit, cursorStr, logs, referenceDate, startDate)) {
      if (completedDates.has(cursorStr) || frozenDates.has(cursorStr)) {
        currentRun++;
        if (currentRun > maxStreak) maxStreak = currentRun;
      } else {
        currentRun = 0;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return maxStreak;
};

/**
 * Рассчитывает overall (activity) streak — последовательность дней с активностью.
 *
 * Активный день = хотя бы одна due-привычка закрыта completion log'ом ИЛИ день
 * покрыт freeze. Дни без due-привычек (например все привычки на будни, а сейчас
 * выходной) НЕ считаются активными и НЕ ломают стрик (нейтральные — счётчик
 * замирает).
 *
 * Логика: идём назад от endDate, на каждом дне:
 * - если день покрыт freeze → активный, streak++
 * - иначе если есть due-привычки и хотя бы одна закрыта → активный, streak++
 * - иначе если есть due-привычки и ни одна не закрыта → streak обрывается
 * - иначе (нет due-привычек) → нейтрально, не наращиваем но и не ломаем
 *
 * @param habits Активные привычки юзера
 * @param logs Все log'и юзера
 * @param freezeUsages Freeze юзера
 * @param endDate Дата окончания (включительно)
 * @param maxDays Глубина (default 365)
 */
export const calculateOverallStreak = (
  habits: StreakHabit[],
  logs: StreakHabitLog[],
  freezeUsages: StreakFreezeUsage[],
  endDate: string,
  maxDays: number = 365
): number => {
  // Overall streak считаем по ВСЕМ habits юзера (включая удалённые),
  // потому что удаление привычки (soft delete `isActive=false`) НЕ должно
  // ретроактивно ломать стрик: completion log существует, день был активным.
  // Юзер уже мог получить freeze за этот стрик — отнимать его нельзя.
  if (habits.length === 0) return 0;

  const completedByDate = new Map<string, Set<number>>();
  for (const log of logs) {
    if (!log.completed) continue;
    if (!completedByDate.has(log.date)) {
      completedByDate.set(log.date, new Set());
    }
    completedByDate.get(log.date)!.add(log.habitId);
  }
  const frozenDates = new Set(freezeUsages.map((f) => f.date));

  // Precompute effective start dates для каждой привычки. Если у привычки
  // есть backdated completion ДО createdAt, эффективное начало смещается
  // назад — иначе overall streak не учтёт backdated дни.
  const startDates = new Map(
    habits.map((h) => [h.id, getEffectiveStartDate(h, logs)] as const)
  );
  const earliestStart = habits.reduce(
    (min, h) => {
      const d = startDates.get(h.id)!;
      return d < min ? d : min;
    },
    endDate
  );

  // Precompute reference dates для каждой привычки — не пересчитываем на
  // каждой итерации loop'а.
  const referenceDates = new Map(
    habits.map((h) => [h.id, getHabitReferenceDate(h, logs)] as const)
  );

  let streak = 0;
  let cursor = endDate;

  for (let i = 0; i < maxDays; i++) {
    if (cursor < earliestStart) break;

    if (frozenDates.has(cursor)) {
      streak++;
    } else {
      // Раздельная семантика по active vs deleted:
      // - Due-проверка только по active habits — у удалённой habit её мёртвые
      //   due-дни не должны «требовать» отметки и ломать стрик.
      // - Completion-учёт по всем habits — если на этот день есть completion
      //   от удалённой habit, она всё равно делает день активным
      //   (юзер делал привычку, значит день не был пустым).
      const dueActiveHabits = habits.filter(
        (h) =>
          h.isActive &&
          isHabitDue(h, cursor, logs, referenceDates.get(h.id), startDates.get(h.id))
      );
      const completedSet = completedByDate.get(cursor) ?? new Set();
      const anyCompletedToday = completedSet.size > 0;

      if (dueActiveHabits.length === 0) {
        // Active due нет. Если есть completion от удалённой habit — день активный.
        // Иначе нейтрально (счётчик замирает).
        if (anyCompletedToday) streak++;
      } else {
        const anyActiveDueClosed = dueActiveHabits.some((h) => completedSet.has(h.id));
        if (anyActiveDueClosed || anyCompletedToday) {
          streak++;
        } else {
          break;
        }
      }
    }

    cursor = format(subDays(parse(cursor, 'yyyy-MM-dd', new Date()), 1), 'yyyy-MM-dd');
  }

  return streak;
};

/**
 * Проверяет был ли день perfect (все due-привычки этого дня completed,
 * не frozen — freeze НЕ считается perfect).
 */
export const isPerfectDay = (
  habits: StreakHabit[],
  logs: StreakHabitLog[],
  dateStr: string
): boolean => {
  const dueHabits = habits.filter((h) => h.isActive && isHabitDue(h, dateStr, logs));
  if (dueHabits.length === 0) return false;

  const completedSet = new Set(
    logs.filter((l) => l.date === dateStr && l.completed).map((l) => l.habitId)
  );
  return dueHabits.every((h) => completedSet.has(h.id));
};

/**
 * Считает количество дней подряд назад от yesterdayDate, где НИ ОДНА due-привычка
 * не выполнена И день не покрыт freeze. Останавливается на первом дне с
 * активностью / freeze / no-due (без due-привычек = нейтрально, продолжаем
 * считать назад? — нет, тогда missed_X не имеет смысла, нейтральный день не
 * считается missed. Прерываемся на нейтральный день, чтобы не overestimate).
 *
 * Используется для определения bucket'а (missed_1/3/few/week/long).
 *
 * @returns Число missed дней подряд (0 если вчера была активность или freeze).
 */
export const countConsecutiveMissedDays = (
  habits: StreakHabit[],
  logs: StreakHabitLog[],
  freezeUsages: StreakFreezeUsage[],
  todayDate: string,
  maxDays: number = 60
): number => {
  const activeHabits = habits.filter((h) => h.isActive);
  if (activeHabits.length === 0) return 0;

  const completedByDate = new Map<string, Set<number>>();
  for (const log of logs) {
    if (!log.completed) continue;
    if (!completedByDate.has(log.date)) {
      completedByDate.set(log.date, new Set());
    }
    completedByDate.get(log.date)!.add(log.habitId);
  }
  const frozenDates = new Set(freezeUsages.map((f) => f.date));

  let missed = 0;
  let cursor = format(subDays(parse(todayDate, 'yyyy-MM-dd', new Date()), 1), 'yyyy-MM-dd');

  for (let i = 0; i < maxDays; i++) {
    if (frozenDates.has(cursor)) break;

    const dueHabits = activeHabits.filter((h) => isHabitDue(h, cursor, logs));
    if (dueHabits.length === 0) break; // нейтральный день, останавливаемся

    const completedSet = completedByDate.get(cursor) ?? new Set();
    const anyCompleted = dueHabits.some((h) => completedSet.has(h.id));
    if (anyCompleted) break;

    missed++;
    cursor = format(subDays(parse(cursor, 'yyyy-MM-dd', new Date()), 1), 'yyyy-MM-dd');
  }

  return missed;
};

/**
 * Считает сколько дней подряд (включая сегодня) конкретная привычка не выполнена
 * на due-днях. Используется для habit_missed_1_day / habit_missed_N_days
 * детекции в per-habit reminder'е.
 *
 * @returns 0 если на последнем due-дне привычка выполнена; иначе количество
 * подряд пропущенных due-дней (минимум 1).
 */
export const countHabitConsecutiveMissedDueDays = (
  habit: StreakHabit,
  logs: StreakHabitLog[],
  todayDate: string,
  maxDays: number = 60
): number => {
  if (!habit.isActive) return 0;

  const completedDates = new Set(
    logs.filter((l) => l.habitId === habit.id && l.completed).map((l) => l.date)
  );
  const startDate = getEffectiveStartDate(habit, logs);

  let missed = 0;
  let cursor = todayDate;

  for (let i = 0; i < maxDays; i++) {
    if (cursor < startDate) break;

    if (isHabitDue(habit, cursor, logs, undefined, startDate)) {
      if (completedDates.has(cursor)) break;
      missed++;
    }
    cursor = format(subDays(parse(cursor, 'yyyy-MM-dd', new Date()), 1), 'yyyy-MM-dd');
  }

  return missed;
};

/**
 * Был ли вчера хоть один due-день без отметки И без freeze (нужно ли применять
 * freeze в утреннем cron'е).
 */
export const shouldAutoApplyFreeze = (
  habits: StreakHabit[],
  logs: StreakHabitLog[],
  freezeUsages: StreakFreezeUsage[],
  todayDate: string
): boolean => {
  const yesterday = format(
    subDays(parse(todayDate, 'yyyy-MM-dd', new Date()), 1),
    'yyyy-MM-dd'
  );
  const activeHabits = habits.filter((h) => h.isActive);
  const dueYesterday = activeHabits.filter((h) => isHabitDue(h, yesterday, logs));
  if (dueYesterday.length === 0) return false;

  const frozenDates = new Set(freezeUsages.map((f) => f.date));
  if (frozenDates.has(yesterday)) return false;

  const completedYesterday = new Set(
    logs.filter((l) => l.date === yesterday && l.completed).map((l) => l.habitId)
  );
  const anyCompleted = dueYesterday.some((h) => completedYesterday.has(h.id));
  return !anyCompleted;
};

/**
 * Проверяет: если сегодня все due-привычки будут выполнены, получится ли
 * perfect-неделя (7 perfect days подряд, включая сегодня)?
 *
 * За последние 6 дней (yesterday до 6-days-ago) должны быть все perfect.
 * Freeze дни НЕ считаются perfect, потому что freeze != completion.
 *
 * @returns true если включение сегодня в perfect-streak даст ровно 7 дней.
 */
export const isPerfectWeekAhead = (
  habits: StreakHabit[],
  logs: StreakHabitLog[],
  todayDate: string
): boolean => {
  // Сегодня ещё должно быть not-yet-perfect (если уже perfect — overlay не нужен).
  const todayDue = habits.filter((h) => h.isActive && isHabitDue(h, todayDate, logs));
  if (todayDue.length === 0) return false; // нет due сегодня — не получится 7-day perfect

  const todayCompletedSet = new Set(
    logs.filter((l) => l.date === todayDate && l.completed).map((l) => l.habitId)
  );
  const todayAlreadyPerfect = todayDue.every((h) => todayCompletedSet.has(h.id));
  if (todayAlreadyPerfect) return false; // уже perfect, overlay смысла нет

  // Прошлые 6 дней должны быть либо perfect, либо нейтральные (без due).
  // Чтобы получился 7-day streak — хотя бы один из 6 предыдущих perfect + 5+ перфектов или нейтралов в сумме.
  // Простой строгий вариант: все 6 предыдущих дней либо perfect либо без due, и есть как минимум 6 due-дней
  // в 7-day окне (включая сегодня). Это сложно — упростим: 6 предыдущих должны быть perfect-если-имели-due.
  for (let i = 1; i <= 6; i++) {
    const dateStr = format(subDays(parse(todayDate, 'yyyy-MM-dd', new Date()), i), 'yyyy-MM-dd');
    const dueOnDate = habits.filter((h) => h.isActive && isHabitDue(h, dateStr, logs));
    if (dueOnDate.length === 0) continue; // нейтральный — пропускаем
    const perfect = isPerfectDay(habits, logs, dateStr);
    if (!perfect) return false;
  }

  return true;
};

/**
 * Близок ли стрик к milestone'у. Возвращает milestone-значение если current+1
 * совпадает с одним из milestone'ов, иначе null.
 *
 * @param current Текущее значение стрика (на конец вчера).
 * @param milestones Список milestone-значений (например [3, 5, 10, 15, 30]).
 */
export const findNearMilestone = (current: number, milestones: number[]): number | null => {
  const next = current + 1;
  return milestones.includes(next) ? next : null;
};
