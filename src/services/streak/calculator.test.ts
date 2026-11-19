import { describe, it, expect } from 'vitest';
import { parse } from 'date-fns';
import {
  habitExistsOn,
  getEffectiveStartDate,
  isHabitDue,
  calculatePerHabitStreak,
  calculatePerHabitMaxStreak,
  calculateOverallStreak,
  isPerfectDay,
  countConsecutiveMissedDays,
  countHabitConsecutiveMissedDueDays,
  shouldAutoApplyFreeze,
  isPerfectWeekAhead,
  findNearMilestone,
  type StreakHabit,
  type StreakHabitLog,
  type StreakFreezeUsage,
} from './calculator.js';

// parse через date-fns — точно так же как внутри calculator, поэтому
// createdAt round-trip'ится через format() в ту же YYYY-MM-DD строку.
const toDate = (s: string): Date => parse(s, 'yyyy-MM-dd', new Date());

const daily = (id: number, createdAt: string, isActive = true, deletedDate: string | null = null): StreakHabit => ({
  id,
  frequencyType: 'daily',
  frequencyDays: 1,
  weekdays: null,
  createdAt: toDate(createdAt),
  isActive,
  deletedDate,
});

const weekly = (id: number, createdAt: string, weekdays: string, isActive = true): StreakHabit => ({
  id,
  frequencyType: 'weekdays',
  frequencyDays: 1,
  weekdays,
  createdAt: toDate(createdAt),
  isActive,
  deletedDate: null,
});

const interval = (id: number, createdAt: string, days: number, isActive = true): StreakHabit => ({
  id,
  frequencyType: 'interval',
  frequencyDays: days,
  weekdays: null,
  createdAt: toDate(createdAt),
  isActive,
  deletedDate: null,
});

const log = (habitId: number, date: string, completed = true): StreakHabitLog => ({
  habitId,
  date,
  completed,
});

const freeze = (date: string): StreakFreezeUsage => ({ date });

describe('getEffectiveStartDate', () => {
  it('без логов возвращает дату создания', () => {
    expect(getEffectiveStartDate(daily(1, '2026-01-01'), [])).toBe('2026-01-01');
  });

  it('сдвигается назад на backdated completion раньше createdAt', () => {
    const h = daily(1, '2026-01-10');
    const logs = [log(1, '2026-01-05'), log(1, '2026-01-11')];
    expect(getEffectiveStartDate(h, logs)).toBe('2026-01-05');
  });

  it('не сдвигается если все completion позже createdAt', () => {
    const h = daily(1, '2026-01-10');
    expect(getEffectiveStartDate(h, [log(1, '2026-01-12')])).toBe('2026-01-10');
  });

  it('игнорирует невыполненные логи', () => {
    const h = daily(1, '2026-01-10');
    expect(getEffectiveStartDate(h, [log(1, '2026-01-05', false)])).toBe('2026-01-10');
  });

  it('учитывает только свои логи (по habitId)', () => {
    const h = daily(1, '2026-01-10');
    expect(getEffectiveStartDate(h, [log(2, '2026-01-05')])).toBe('2026-01-10');
  });
});

describe('isHabitDue', () => {
  it('daily — due на любую дату от старта', () => {
    expect(isHabitDue(daily(1, '2026-01-01'), '2026-01-05', [])).toBe(true);
  });

  it('false до effectiveStartDate', () => {
    const h = daily(1, '2026-01-10');
    expect(isHabitDue(h, '2026-01-05', [], undefined, '2026-01-10')).toBe(false);
  });

  it('weekdays — due только в нужный день недели', () => {
    const h = weekly(1, '2026-01-01', '1'); // Понедельник
    expect(isHabitDue(h, '2026-01-05', [])).toBe(true); // Mon
    expect(isHabitDue(h, '2026-01-06', [])).toBe(false); // Tue
  });

  it('interval — due по кратности от referenceDate', () => {
    const h = interval(1, '2026-01-01', 3);
    expect(isHabitDue(h, '2026-01-01', [], '2026-01-01')).toBe(true);
    expect(isHabitDue(h, '2026-01-04', [], '2026-01-01')).toBe(true);
    expect(isHabitDue(h, '2026-01-03', [], '2026-01-01')).toBe(false);
  });
});

describe('calculatePerHabitStreak', () => {
  const h = daily(1, '2026-01-01');

  it('считает непрерывную серию completion', () => {
    const logs = [log(1, '2026-01-03'), log(1, '2026-01-04'), log(1, '2026-01-05')];
    expect(calculatePerHabitStreak(h, logs, [], '2026-01-05')).toBe(3);
  });

  it('пропуск дня обрывает стрик', () => {
    const logs = [log(1, '2026-01-03'), log(1, '2026-01-05')];
    expect(calculatePerHabitStreak(h, logs, [], '2026-01-05')).toBe(1);
  });

  it('строгий режим: неотмеченный endDate даёт 0', () => {
    const logs = [log(1, '2026-01-03'), log(1, '2026-01-04'), log(1, '2026-01-05')];
    expect(calculatePerHabitStreak(h, logs, [], '2026-01-06')).toBe(0);
  });

  it('lenientToday: неотмеченный endDate не обрывает (грейс)', () => {
    const logs = [log(1, '2026-01-03'), log(1, '2026-01-04'), log(1, '2026-01-05')];
    expect(
      calculatePerHabitStreak(h, logs, [], '2026-01-06', { lenientToday: true })
    ).toBe(3);
  });

  it('lenientToday грейс только на первой итерации, дальше обрыв строгий', () => {
    // 01-06 нет, 01-05 нет → даже с грейсом обрыв на 01-05
    const logs = [log(1, '2026-01-03'), log(1, '2026-01-04')];
    expect(
      calculatePerHabitStreak(h, logs, [], '2026-01-06', { lenientToday: true })
    ).toBe(0);
  });

  it('freeze закрывает пропущенный день', () => {
    const logs = [log(1, '2026-01-03'), log(1, '2026-01-05')];
    expect(calculatePerHabitStreak(h, logs, [freeze('2026-01-04')], '2026-01-05')).toBe(3);
  });

  it('неактивная привычка → 0', () => {
    const inactive = daily(1, '2026-01-01', false);
    expect(calculatePerHabitStreak(inactive, [log(1, '2026-01-05')], [], '2026-01-05')).toBe(0);
  });

  it('maxDays ограничивает глубину', () => {
    const logs = Array.from({ length: 10 }, (_, i) => log(1, `2026-01-${String(i + 1).padStart(2, '0')}`));
    expect(calculatePerHabitStreak(h, logs, [], '2026-01-10', { maxDays: 2 })).toBe(2);
  });

  it('не уходит раньше startDate', () => {
    expect(calculatePerHabitStreak(h, [log(1, '2026-01-01')], [], '2026-01-01')).toBe(1);
  });
});

describe('calculatePerHabitMaxStreak', () => {
  const h = daily(1, '2026-01-01');

  it('находит максимальную серию за историю', () => {
    const logs = [
      log(1, '2026-01-01'), log(1, '2026-01-02'), log(1, '2026-01-03'),
      log(1, '2026-01-05'), log(1, '2026-01-06'),
    ];
    expect(calculatePerHabitMaxStreak(h, logs, [], '2026-01-06')).toBe(3);
  });

  it('freeze продлевает серию', () => {
    const logs = [log(1, '2026-01-01'), log(1, '2026-01-02'), log(1, '2026-01-04')];
    expect(calculatePerHabitMaxStreak(h, logs, [freeze('2026-01-03')], '2026-01-04')).toBe(4);
  });

  it('пустые логи → 0', () => {
    expect(calculatePerHabitMaxStreak(h, [], [], '2026-01-10')).toBe(0);
  });

  it('неактивная → 0', () => {
    expect(calculatePerHabitMaxStreak(daily(1, '2026-01-01', false), [log(1, '2026-01-01')], [], '2026-01-01')).toBe(0);
  });
});

describe('calculateOverallStreak', () => {
  it('одна привычка ведёт себя как per-habit', () => {
    const habits = [daily(1, '2026-01-01')];
    const logs = [log(1, '2026-01-01'), log(1, '2026-01-02'), log(1, '2026-01-03')];
    expect(calculateOverallStreak(habits, logs, [], '2026-01-03')).toBe(3);
  });

  it('день активен если хотя бы одна due-привычка закрыта', () => {
    const habits = [daily(1, '2026-01-01'), daily(2, '2026-01-01')];
    const logs = [log(1, '2026-01-01'), log(1, '2026-01-02'), log(1, '2026-01-03')];
    expect(calculateOverallStreak(habits, logs, [], '2026-01-03')).toBe(3);
  });

  it('день без единой отметки обрывает стрик', () => {
    const habits = [daily(1, '2026-01-01')];
    const logs = [log(1, '2026-01-01'), log(1, '2026-01-03')];
    expect(calculateOverallStreak(habits, logs, [], '2026-01-03')).toBe(1);
  });

  it('freeze покрывает день', () => {
    const habits = [daily(1, '2026-01-01')];
    const logs = [log(1, '2026-01-01'), log(1, '2026-01-03')];
    expect(calculateOverallStreak(habits, logs, [freeze('2026-01-02')], '2026-01-03')).toBe(3);
  });

  it('нейтральные дни (нет due) не ломают и не растят стрик', () => {
    // weekdays-привычка только по понедельникам
    const habits = [weekly(1, '2026-01-01', '1')];
    const logs = [log(1, '2026-01-05'), log(1, '2026-01-12')]; // два понедельника
    expect(calculateOverallStreak(habits, logs, [], '2026-01-12')).toBe(2);
  });

  it('lenientToday не обрывает на неотмеченном сегодня', () => {
    const habits = [daily(1, '2026-01-01')];
    const logs = [log(1, '2026-01-01'), log(1, '2026-01-02')];
    expect(
      calculateOverallStreak(habits, logs, [], '2026-01-03', { lenientToday: true })
    ).toBe(2);
  });

  it('completion удалённой привычки держит день активным', () => {
    const habits = [daily(1, '2026-01-01'), daily(2, '2026-01-01', false)];
    const logs = [log(1, '2026-01-01'), log(2, '2026-01-02')];
    // 01-02: h1 due но не отмечена, h2 удалена но есть её completion → день активен
    expect(calculateOverallStreak(habits, logs, [], '2026-01-02')).toBe(2);
  });

  it('пустой список привычек → 0', () => {
    expect(calculateOverallStreak([], [], [], '2026-01-03')).toBe(0);
  });
});

describe('isPerfectDay', () => {
  it('все due-привычки выполнены → true', () => {
    const habits = [daily(1, '2026-01-01'), daily(2, '2026-01-01')];
    const logs = [log(1, '2026-01-05'), log(2, '2026-01-05')];
    expect(isPerfectDay(habits, logs, '2026-01-05')).toBe(true);
  });

  it('одна due не выполнена → false', () => {
    const habits = [daily(1, '2026-01-01'), daily(2, '2026-01-01')];
    const logs = [log(1, '2026-01-05')];
    expect(isPerfectDay(habits, logs, '2026-01-05')).toBe(false);
  });

  it('нет due-привычек → false', () => {
    const habits = [weekly(1, '2026-01-01', '1')]; // Mon only
    expect(isPerfectDay(habits, [], '2026-01-06')).toBe(false); // Tue
  });
});

describe('countConsecutiveMissedDays', () => {
  const habits = [daily(1, '2026-01-01')];

  it('считает пропущенные дни назад от вчера', () => {
    const logs = [log(1, '2026-01-05')];
    // today 01-10: вчера 01-09..01-06 missed (4), 01-05 completed → стоп
    expect(countConsecutiveMissedDays(habits, logs, [], '2026-01-10')).toBe(4);
  });

  it('вчера выполнено → 0', () => {
    const logs = [log(1, '2026-01-09')];
    expect(countConsecutiveMissedDays(habits, logs, [], '2026-01-10')).toBe(0);
  });

  it('freeze вчера → 0 (прерывает подсчёт)', () => {
    expect(countConsecutiveMissedDays(habits, [], [freeze('2026-01-09')], '2026-01-10')).toBe(0);
  });

  it('нет активных привычек → 0', () => {
    expect(countConsecutiveMissedDays([daily(1, '2026-01-01', false)], [], [], '2026-01-10')).toBe(0);
  });

  it('отметки удалённой привычки — не пропуск', () => {
    const withDeleted = [daily(1, '2026-01-01'), daily(2, '2026-01-01', false)];
    const logs = ['2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'].map((d) => log(2, d));
    expect(countConsecutiveMissedDays(withDeleted, logs, [], '2026-01-10')).toBe(0);
  });

  it('пропуски считаются до последнего дня с отметкой удалённой привычки', () => {
    const withDeleted = [daily(1, '2026-01-01'), daily(2, '2026-01-01', false)];
    const logs = [log(2, '2026-01-06')];
    // 01-09, 01-08, 01-07 — пропуски, 01-06 — отметка удалённой → стоп
    expect(countConsecutiveMissedDays(withDeleted, logs, [], '2026-01-10')).toBe(3);
  });
});

describe('countHabitConsecutiveMissedDueDays', () => {
  const h = daily(1, '2026-01-01');

  it('считает пропущенные due-дни включая сегодня', () => {
    const logs = [log(1, '2026-01-07')];
    // today 01-10: 01-10,09,08 missed (3), 01-07 completed → стоп
    expect(countHabitConsecutiveMissedDueDays(h, logs, '2026-01-10')).toBe(3);
  });

  it('сегодня выполнено → 0', () => {
    expect(countHabitConsecutiveMissedDueDays(h, [log(1, '2026-01-10')], '2026-01-10')).toBe(0);
  });

  it('неактивная → 0', () => {
    expect(countHabitConsecutiveMissedDueDays(daily(1, '2026-01-01', false), [], '2026-01-10')).toBe(0);
  });
});

describe('shouldAutoApplyFreeze', () => {
  const habits = [daily(1, '2026-01-01')];

  it('вчера due, не отмечено, не frozen → true', () => {
    expect(shouldAutoApplyFreeze(habits, [], [], '2026-01-10')).toBe(true);
  });

  it('вчера выполнено → false', () => {
    expect(shouldAutoApplyFreeze(habits, [log(1, '2026-01-09')], [], '2026-01-10')).toBe(false);
  });

  it('вчера уже frozen → false', () => {
    expect(shouldAutoApplyFreeze(habits, [], [freeze('2026-01-09')], '2026-01-10')).toBe(false);
  });

  it('вчера не было due (weekdays) → false', () => {
    const weekHabits = [weekly(1, '2026-01-01', '1')]; // Mon only
    // today 01-07 (Wed) → вчера 01-06 (Tue) не due
    expect(shouldAutoApplyFreeze(weekHabits, [], [], '2026-01-07')).toBe(false);
  });

  it('вчера отмечена только удалённая привычка → false', () => {
    const withDeleted = [daily(1, '2026-01-01'), daily(2, '2026-01-01', false)];
    expect(shouldAutoApplyFreeze(withDeleted, [log(2, '2026-01-09')], [], '2026-01-10')).toBe(false);
  });

  it('снятая отметка (completed=false) не считается', () => {
    expect(shouldAutoApplyFreeze(habits, [log(1, '2026-01-09', false)], [], '2026-01-10')).toBe(true);
  });
});

describe('isPerfectWeekAhead', () => {
  const habits = [daily(1, '2026-01-01')];

  it('сегодня not-yet-perfect + 6 предыдущих perfect → true', () => {
    const logs = [
      log(1, '2026-01-04'), log(1, '2026-01-05'), log(1, '2026-01-06'),
      log(1, '2026-01-07'), log(1, '2026-01-08'), log(1, '2026-01-09'),
    ];
    expect(isPerfectWeekAhead(habits, logs, '2026-01-10')).toBe(true);
  });

  it('сегодня уже perfect → false', () => {
    const logs = [
      log(1, '2026-01-04'), log(1, '2026-01-05'), log(1, '2026-01-06'),
      log(1, '2026-01-07'), log(1, '2026-01-08'), log(1, '2026-01-09'),
      log(1, '2026-01-10'),
    ];
    expect(isPerfectWeekAhead(habits, logs, '2026-01-10')).toBe(false);
  });

  it('один из 6 предыдущих не perfect → false', () => {
    const logs = [
      log(1, '2026-01-04'), log(1, '2026-01-05'), /* пропуск 01-06 */
      log(1, '2026-01-07'), log(1, '2026-01-08'), log(1, '2026-01-09'),
    ];
    expect(isPerfectWeekAhead(habits, logs, '2026-01-10')).toBe(false);
  });

  it('нет due сегодня → false', () => {
    const weekHabits = [weekly(1, '2026-01-01', '1')]; // Mon only
    expect(isPerfectWeekAhead(weekHabits, [], '2026-01-07')).toBe(false); // Wed
  });
});

describe('findNearMilestone', () => {
  const milestones = [3, 5, 10, 15, 30];

  it('current+1 совпадает с milestone → возвращает его', () => {
    expect(findNearMilestone(4, milestones)).toBe(5);
    expect(findNearMilestone(2, milestones)).toBe(3);
  });

  it('current+1 не milestone → null', () => {
    expect(findNearMilestone(5, milestones)).toBeNull();
    expect(findNearMilestone(7, milestones)).toBeNull();
  });

  it('пустой список milestone → null', () => {
    expect(findNearMilestone(4, [])).toBeNull();
  });
});

describe('удалённые привычки: до дня удаления — как обычные', () => {
  // h1 удалена 01-08: до 01-08 её due-дни требуют отметки, с 01-08 — нет
  const deleted = daily(1, '2026-01-01', false, '2026-01-08');

  it('habitExistsOn: до дня удаления — да, в день удаления и после — нет', () => {
    expect(habitExistsOn(deleted, '2026-01-07')).toBe(true);
    expect(habitExistsOn(deleted, '2026-01-08')).toBe(false);
    expect(habitExistsOn(daily(2, '2026-01-01', false), '2026-01-07')).toBe(false);
    expect(habitExistsOn(daily(3, '2026-01-01'), '2030-01-01')).toBe(true);
  });

  it('пропуск удалённой привычки до удаления по-прежнему обрывает стрик', () => {
    const habits = [deleted, weekly(2, '2026-01-01', '1')]; // h2 только по понедельникам
    // 01-05 (Пн) обе отмечены, 01-06 h1 не отмечена → обрыв; 01-12 (Пн) h2 отмечена
    const logs = [log(1, '2026-01-05'), log(2, '2026-01-05'), log(2, '2026-01-12')];
    expect(calculateOverallStreak(habits, logs, [], '2026-01-12')).toBe(1);
  });

  it('день удаления и дни после не требуют отметки удалённой привычки', () => {
    const habits = [deleted, weekly(2, '2026-01-01', '1')];
    const logs = [1, 2, 3, 4, 5, 6, 7].map((d) => log(1, `2026-01-0${d}`)).concat(log(2, '2026-01-12'));
    // 01-01..01-07 отмечены, 01-08..01-11 нейтральные, 01-12 отмечен
    expect(calculateOverallStreak(habits, logs, [], '2026-01-12')).toBe(8);
  });

  it('все привычки удалены: стрик не растёт за счёт старых пропусков', () => {
    const habits = [daily(1, '2026-01-01', false, '2026-01-20')];
    const logs = [log(1, '2026-01-02'), log(1, '2026-01-03'), log(1, '2026-01-10')];
    // 01-11..01-19 пропуски до удаления → стрик оборвался, сегодня 02-01 — 0
    expect(calculateOverallStreak(habits, logs, [], '2026-02-01', { lenientToday: true })).toBe(0);
  });

  it('счётчик пропусков: привычку удалили сегодня, вчера её не отметили → пропуск', () => {
    const habits = [daily(1, '2026-01-01', false, '2026-01-10'), daily(2, '2026-01-09')];
    expect(countConsecutiveMissedDays(habits, [log(1, '2026-01-08')], [], '2026-01-10')).toBe(1);
  });

  it('автозаморозка: привычку удалили сегодня, вчера её не отметили → нужна', () => {
    const habits = [daily(1, '2026-01-01', false, '2026-01-10'), weekly(2, '2026-01-01', '1')];
    // вчера 01-09 (Пт): h2 не due, h1 ещё была и не отмечена
    expect(shouldAutoApplyFreeze(habits, [], [], '2026-01-10')).toBe(true);
  });

  it('perfect day: неотмеченная удалённая привычка до удаления портит день', () => {
    const habits = [daily(1, '2026-01-01', false, '2026-01-10'), daily(2, '2026-01-01')];
    expect(isPerfectDay(habits, [log(2, '2026-01-05')], '2026-01-05')).toBe(false);
    expect(isPerfectDay(habits, [log(2, '2026-01-12')], '2026-01-12')).toBe(true);
  });
});
