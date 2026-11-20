import { Habit, HabitLog, HabitReminder } from '@prisma/client';
import { format } from 'date-fns';
import { prisma } from '../db/index.js';
import { CreateHabitInput, FrequencyType, HabitWithTodayStatus } from '../types/index.js';
import {
  getTodayDate,
  isHabitDueToday,
  isHabitDueOnDate,
  getCurrentMinutesInTimezone,
  DEFAULT_TIMEZONE_OFFSET,
} from '../utils/date.js';
import { MAX_HABIT_REMINDERS, initialLastSentDate, nowInTimezone, sortTimes } from './reminder/habitReminderSlots.js';

/**
 * Сервис для работы с привычками
 * @module services/habitService
 */

/**
 * Создаёт новую привычку
 * @param input - Данные для создания привычки
 * @returns Созданная привычка
 */
export const createHabit = async (input: CreateHabitInput): Promise<Habit> => {
  return prisma.habit.create({
    data: {
      name: input.name,
      emoji: input.emoji,
      frequencyType: input.frequencyType,
      frequencyDays: input.frequencyDays ?? 1,
      weekdays: input.weekdays ?? null,
      userId: input.userId,
    },
  });
};

/**
 * Получает все активные привычки пользователя
 * @param userId - ID пользователя в БД
 * @returns Массив привычек
 */
export const getUserHabits = async (userId: number): Promise<Habit[]> => {
  return prisma.habit.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
};

/**
 * Получает привычку по ID
 * @param habitId - ID привычки
 * @returns Привычка или null
 */
export const getHabitById = async (habitId: number): Promise<Habit | null> => {
  return prisma.habit.findUnique({
    where: { id: habitId },
  });
};

/**
 * Удаляет привычку (мягкое удаление — деактивация) и запоминает день удаления
 * в часовом поясе юзера. Повторное удаление уже удалённой ничего не меняет.
 * @param habitId - ID привычки
 * @param timezoneOffset - Смещение часового пояса юзера в минутах
 * @returns true, если привычка была активной и теперь удалена
 */
export const deleteHabit = async (
  habitId: number,
  timezoneOffset: number = DEFAULT_TIMEZONE_OFFSET
): Promise<boolean> => {
  const { count } = await prisma.habit.updateMany({
    where: { id: habitId, isActive: true },
    data: { isActive: false, deletedDate: getTodayDate(timezoneOffset) },
  });
  return count > 0;
};

/**
 * Завершает привычку как внедрённую: она уходит из списка, напоминаний и
 * чеклистов, а история считается как у удалённой (до дня завершения —
 * обычная привычка, см. habitExistsOn). Фильтр по userId + isActive —
 * owner-check и защита от повторного нажатия.
 * @returns true, если привычка была активной и теперь завершена
 */
export const graduateHabit = async (
  habitId: number,
  userId: number,
  timezoneOffset: number = DEFAULT_TIMEZONE_OFFSET
): Promise<boolean> => {
  const { count } = await prisma.habit.updateMany({
    where: { id: habitId, userId, isActive: true },
    data: { isActive: false, deletedDate: getTodayDate(timezoneOffset), graduated: true },
  });
  return count > 0;
};

/**
 * Получает лог выполнения привычки за определённую дату
 * @param habitId - ID привычки
 * @param date - Дата в формате YYYY-MM-DD
 * @returns Лог или null
 */
export const getHabitLog = async (habitId: number, date: string): Promise<HabitLog | null> => {
  return prisma.habitLog.findUnique({
    where: {
      habitId_date: { habitId, date },
    },
  });
};

/** Сколько раз в день можно поставить привычке. */
export const MAX_TIMES_PER_DAY = 5;

/**
 * Как нажатие меняет отметки дня:
 * - `cycle` — кнопки списка и чеклиста: +1, а после полного дня — сброс в 0
 *   (при одном разе в день это прежнее «отметить / снять»);
 * - `add` — «✅ Выполнено» в напоминании: +1, на полном дне ничего не меняет;
 * - `remove` — «↩️ Отменить» в напоминании: −1.
 */
export type MarkMode = 'cycle' | 'add' | 'remove';

/** Отметки дня после нажатия. */
export type MarkResult = {
  /** Сколько отметок теперь */
  count: number;
  /** Сколько нужно за этот день */
  target: number;
  /** День выполнен (count >= target) */
  completed: boolean;
  /** День был выполнен до нажатия */
  wasCompleted: boolean;
  /** Отметок до нажатия */
  previousCount: number;
  /** Нажатие что-то изменило */
  changed: boolean;
};

/**
 * Pure: следующее число отметок дня для нажатия.
 * @param current - Отметок до нажатия
 * @param target - Сколько нужно за день
 * @param mode - Вид нажатия
 */
export const nextMarkCount = (current: number, target: number, mode: MarkMode): number => {
  if (mode === 'add') return current >= target ? current : current + 1;
  if (mode === 'remove') return Math.max(current - 1, 0);
  return current >= target ? 0 : current + 1;
};

/**
 * Ставит или снимает одну отметку привычки за дату (по умолчанию — сегодня).
 * Сколько нужно за день, фиксируется в логе при первой отметке дня
 * (`target` = timesPerDay привычки), поэтому смена числа раз не переписывает
 * прошлые дни.
 * @param habitId - ID привычки
 * @param timesPerDay - Сколько раз в день сейчас у привычки
 * @param timezoneOffset - Смещение часового пояса
 * @param date - Дата YYYY-MM-DD; если не передана — сегодня
 * @param mode - Вид нажатия (см. MarkMode)
 */
export const markHabit = async (
  habitId: number,
  timesPerDay: number,
  timezoneOffset: number = 180,
  date?: string,
  mode: MarkMode = 'cycle'
): Promise<MarkResult> => {
  const targetDate = date ?? getTodayDate(timezoneOffset);
  // Чтение и запись в одной транзакции: два быстрых нажатия не теряют отметку.
  return prisma.$transaction(async (tx): Promise<MarkResult> => {
    const existing = await tx.habitLog.findUnique({
      where: { habitId_date: { habitId, date: targetDate } },
    });
    const target = existing?.target ?? timesPerDay;
    const current = existing?.count ?? 0;
    const wasCompleted = existing?.completed ?? false;
    const count = nextMarkCount(current, target, mode);
    const completed = count >= target;
    if (existing && count === current && completed === wasCompleted) {
      return { count, target, completed, wasCompleted, previousCount: current, changed: false };
    }
    if (!existing && count === 0) {
      return { count, target, completed: false, wasCompleted, previousCount: current, changed: false };
    }
    await tx.habitLog.upsert({
      where: { habitId_date: { habitId, date: targetDate } },
      create: { habitId, date: targetDate, count, target, completed },
      update: { count, completed, markedAt: new Date() },
    });
    return { count, target, completed, wasCompleted, previousCount: current, changed: true };
  });
};

/** Итог смены числа раз в день. */
export type SetTimesResult =
  | { kind: 'not_found' }
  | { kind: 'ok'; today: string; becameCompleted: boolean };

/**
 * Меняет, сколько раз в день нужно выполнять привычку. Прошлые дни не
 * трогаются; у сегодняшнего (если отметки уже есть) меняется только цель —
 * поставленные отметки остаются, выполнен ли день, пересчитывается.
 * @returns `becameCompleted` — сегодняшний день стал выполненным из-за смены цели
 */
export const setHabitTimesPerDay = async (
  habitId: number,
  userId: number,
  timesPerDay: number,
  timezoneOffset: number = DEFAULT_TIMEZONE_OFFSET
): Promise<SetTimesResult> => {
  const n = Math.min(Math.max(Math.trunc(timesPerDay), 1), MAX_TIMES_PER_DAY);
  const today = getTodayDate(timezoneOffset);
  return prisma.$transaction(async (tx): Promise<SetTimesResult> => {
    const { count } = await tx.habit.updateMany({
      where: { id: habitId, userId, isActive: true },
      data: { timesPerDay: n },
    });
    if (count === 0) return { kind: 'not_found' };
    const log = await tx.habitLog.findUnique({ where: { habitId_date: { habitId, date: today } } });
    if (!log) return { kind: 'ok', today, becameCompleted: false };
    const completed = log.count >= n;
    await tx.habitLog.update({ where: { id: log.id }, data: { target: n, completed } });
    return { kind: 'ok', today, becameCompleted: completed && !log.completed };
  });
};

/**
 * Получает привычки пользователя со статусом на сегодня
 * @param userId - ID пользователя в БД
 * @param timezoneOffset - Смещение часового пояса
 * @returns Массив привычек с сегодняшним статусом
 */
export const getUserHabitsWithTodayStatus = async (
  userId: number,
  timezoneOffset: number = 180
): Promise<HabitWithTodayStatus[]> => {
  const today = getTodayDate(timezoneOffset);
  
  const habits = await prisma.habit.findMany({
    where: { userId, isActive: true },
    include: {
      logs: {
        where: { date: today },
        take: 1,
      },
      reminders: { select: { time: true }, orderBy: { time: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Получаем последние выполнения для определения isDueToday
  const habitsWithDueStatus = await Promise.all(
    habits.map(async (habit) => {
      const lastCompleted = await prisma.habitLog.findFirst({
        where: { habitId: habit.id, completed: true },
        orderBy: { date: 'desc' },
      });

      const completedToday = habit.logs[0]?.completed ?? false;
      const frequencyType = habit.frequencyType as FrequencyType;
      
      // Если привычка уже выполнена сегодня — она всегда isDueToday,
      // независимо от интервала (иначе после отметки показывалась бы с 💤)
      const isDueToday = completedToday || isHabitDueToday({
        frequencyType,
        frequencyDays: habit.frequencyDays,
        weekdays: habit.weekdays,
        lastCompletedDate: lastCompleted?.date ?? null,
        todayDate: today,
      });

      return {
        id: habit.id,
        name: habit.name,
        emoji: habit.emoji,
        frequencyType,
        frequencyDays: habit.frequencyDays,
        weekdays: habit.weekdays,
        completedToday,
        isDueToday,
        timesPerDay: habit.timesPerDay,
        doneCount: habit.logs[0]?.count ?? 0,
        targetToday: habit.logs[0]?.target ?? habit.timesPerDay,
        reminderTimes: habit.reminders.map((r) => r.time),
      };
    })
  );

  return habitsWithDueStatus;
};

/**
 * Получает привычки пользователя со статусом на произвольную дату.
 * Использует isHabitDueOnDate (по расписанию) вместо isHabitDueToday.
 * @param userId - ID пользователя в БД
 * @param date - Целевая дата (YYYY-MM-DD)
 * @returns Массив привычек со статусом на указанную дату
 */
export const getUserHabitsWithDateStatus = async (
  userId: number,
  date: string
): Promise<HabitWithTodayStatus[]> => {
  const habits = await prisma.habit.findMany({
    where: { userId, isActive: true },
    include: {
      logs: {
        where: { date },
        take: 1,
      },
      reminders: { select: { time: true }, orderBy: { time: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const habitsWithStatus = await Promise.all(
    habits.map(async (habit) => {
      const firstCompleted = await prisma.habitLog.findFirst({
        where: { habitId: habit.id, completed: true },
        orderBy: { date: 'asc' },
      });

      const completed = habit.logs[0]?.completed ?? false;
      const frequencyType = habit.frequencyType as FrequencyType;
      const habitCreatedDate = format(habit.createdAt, 'yyyy-MM-dd');
      const referenceDate = firstCompleted?.date ?? habitCreatedDate;

      const isDue = date < habitCreatedDate
        ? false
        : completed || isHabitDueOnDate({
            frequencyType,
            frequencyDays: habit.frequencyDays,
            weekdays: habit.weekdays,
            referenceDate,
            dateStr: date,
          });

      return {
        id: habit.id,
        name: habit.name,
        emoji: habit.emoji,
        frequencyType,
        frequencyDays: habit.frequencyDays,
        weekdays: habit.weekdays,
        completedToday: completed,
        isDueToday: isDue,
        timesPerDay: habit.timesPerDay,
        doneCount: habit.logs[0]?.count ?? 0,
        targetToday: habit.logs[0]?.target ?? habit.timesPerDay,
        reminderTimes: habit.reminders.map((r) => r.time),
      };
    })
  );

  return habitsWithStatus;
};

/**
 * Получает привычки, которые нужно выполнить сегодня
 * @param userId - ID пользователя в БД
 * @param timezoneOffset - Смещение часового пояса
 * @returns Массив привычек на сегодня
 */
export const getTodayHabits = async (
  userId: number,
  timezoneOffset: number = 180
): Promise<HabitWithTodayStatus[]> => {
  const allHabits = await getUserHabitsWithTodayStatus(userId, timezoneOffset);
  return allHabits.filter((h) => h.isDueToday);
};

/**
 * Получает логи привычки за период
 * @param habitId - ID привычки
 * @param startDate - Начальная дата (YYYY-MM-DD)
 * @param endDate - Конечная дата (YYYY-MM-DD)
 * @returns Массив логов
 */
export const getHabitLogs = async (
  habitId: number,
  startDate: string,
  endDate: string
): Promise<HabitLog[]> => {
  return prisma.habitLog.findMany({
    where: {
      habitId,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { date: 'asc' },
  });
};

/** Результат добавления времён напоминаний. */
export type AddRemindersResult =
  | { kind: 'added'; times: string[] }
  | { kind: 'limit'; free: number }
  | { kind: 'not_found' };

/** Результат смены времени одного напоминания. */
export type ChangeReminderResult =
  | { kind: 'changed'; habitId: number }
  | { kind: 'exists'; habitId: number }
  | { kind: 'not_found' };

/** Активная привычка юзера с поясом владельца — для правок напоминаний. */
const findOwnActiveHabit = async (
  habitId: number,
  userId: number
): Promise<{ timezoneOffset: number } | null> => {
  const habit = await prisma.habit.findFirst({
    where: { id: habitId, userId, isActive: true },
    select: { user: { select: { timezoneOffset: true } } },
  });
  return habit ? { timezoneOffset: habit.user.timezoneOffset ?? DEFAULT_TIMEZONE_OFFSET } : null;
};

/**
 * Персональное напоминание по ID.
 * @param reminderId - ID напоминания
 */
export const getHabitReminderById = async (reminderId: number): Promise<HabitReminder | null> =>
  prisma.habitReminder.findUnique({ where: { id: reminderId } });

/**
 * Персональные напоминания привычки по времени.
 * @param habitId - ID привычки
 */
export const getHabitReminders = async (habitId: number): Promise<HabitReminder[]> =>
  prisma.habitReminder.findMany({ where: { habitId }, orderBy: { time: 'asc' } });

/**
 * Добавляет привычке времена напоминаний (уже провалидированные HH:MM).
 * Времена, которые уже есть, пропускаются. Лимит — MAX_HABIT_REMINDERS на
 * привычку: если новые не помещаются, ничего не добавляется.
 *
 * Время, которое сегодня уже прошло, помечается отправленным сегодня — иначе
 * напоминание пришло бы сразу после настройки (см. initialLastSentDate).
 *
 * @returns `added` со всеми временами привычки после добавления, `limit` со
 * свободным местом или `not_found` для чужой/удалённой привычки.
 */
export const addHabitReminders = async (
  habitId: number,
  userId: number,
  times: string[]
): Promise<AddRemindersResult> => {
  const habit = await findOwnActiveHabit(habitId, userId);
  if (!habit) return { kind: 'not_found' };

  const { today, minutes: nowMinutes } = nowInTimezone(habit.timezoneOffset);
  // Подсчёт и запись в одной транзакции: лимит не обходится параллельным
  // добавлением, пакет времён пишется целиком или никак.
  return prisma.$transaction(async (tx): Promise<AddRemindersResult> => {
    const existing = await tx.habitReminder.findMany({ where: { habitId }, select: { time: true } });
    const existingTimes = new Set(existing.map((r) => r.time));
    const fresh = times.filter((t) => !existingTimes.has(t));
    if (existing.length + fresh.length > MAX_HABIT_REMINDERS) {
      return { kind: 'limit', free: Math.max(0, MAX_HABIT_REMINDERS - existing.length) };
    }
    for (const time of fresh) {
      await tx.habitReminder.create({
        data: { habitId, time, lastSentDate: initialLastSentDate(time, nowMinutes, today) },
      });
    }
    return { kind: 'added', times: sortTimes([...existingTimes, ...fresh]) };
  });
};

/**
 * Меняет время одного напоминания. lastSentDate пересчитывается как для
 * нового времени: прошедшее сегодня не придёт сразу, будущее сработает сегодня.
 *
 * @returns `changed`, `exists` (у привычки уже есть такое время) или
 * `not_found` (напоминание удалено, привычка чужая или удалена).
 */
export const changeHabitReminderTime = async (
  reminderId: number,
  userId: number,
  time: string
): Promise<ChangeReminderResult> => {
  const reminder = await prisma.habitReminder.findUnique({ where: { id: reminderId } });
  if (!reminder) return { kind: 'not_found' };
  const habit = await findOwnActiveHabit(reminder.habitId, userId);
  if (!habit) return { kind: 'not_found' };
  if (reminder.time === time) return { kind: 'changed', habitId: reminder.habitId };

  const clash = await prisma.habitReminder.findUnique({
    where: { habitId_time: { habitId: reminder.habitId, time } },
  });
  if (clash) return { kind: 'exists', habitId: reminder.habitId };

  const { today, minutes: nowMinutes } = nowInTimezone(habit.timezoneOffset);
  await prisma.habitReminder.update({
    where: { id: reminderId },
    data: { time, lastSentDate: initialLastSentDate(time, nowMinutes, today) },
  });
  return { kind: 'changed', habitId: reminder.habitId };
};

/**
 * Убирает одно напоминание. `shownTime` — время, подписанное на нажатой
 * кнопке: если напоминание с тех пор перенесли, ничего не удаляется.
 * @returns habitId привычки, если напоминание было у своей активной привычки и удалено; иначе null.
 */
export const removeHabitReminder = async (
  reminderId: number,
  userId: number,
  shownTime?: string
): Promise<number | null> => {
  const reminder = await prisma.habitReminder.findUnique({ where: { id: reminderId } });
  // Кнопка из устаревшего списка: время уже изменили — не удаляем вслепую.
  if (!reminder || (shownTime !== undefined && reminder.time !== shownTime)) return null;
  const habit = await findOwnActiveHabit(reminder.habitId, userId);
  if (!habit) return null;
  await prisma.habitReminder.delete({ where: { id: reminderId } });
  return reminder.habitId;
};

/**
 * Получает все активные привычки с персональными напоминаниями
 * @returns Привычки с напоминаниями и данными пользователя
 */
export const getHabitsWithReminders = async (): Promise<
  (Habit & {
    reminders: HabitReminder[];
    user: { telegramId: bigint; timezoneOffset: number | null };
  })[]
> => {
  return prisma.habit.findMany({
    where: {
      isActive: true,
      reminders: { some: {} },
    },
    include: {
      reminders: { orderBy: { time: 'asc' } },
      user: {
        select: { telegramId: true, timezoneOffset: true },
      },
    },
  });
};

/**
 * Переименовывает привычку. Имя должно быть уже провалидировано
 * (см. utils/validation.validateHabitName).
 *
 * Where включает userId + isActive: это разом и owner-check (нельзя
 * переименовать чужую привычку подделанным callback'ом), и защита от
 * переименования удалённой (isActive=false) записи. Используем updateMany,
 * т.к. update требует уникальный where — а нам нужен составной фильтр.
 *
 * @returns true если привычка найдена и переименована, false иначе.
 */
export const renameHabit = async (
  habitId: number,
  userId: number,
  name: string
): Promise<boolean> => {
  const result = await prisma.habit.updateMany({
    where: { id: habitId, userId, isActive: true },
    data: { name },
  });
  return result.count > 0;
};

/**
 * Меняет эмодзи привычки. Эмодзи должен быть уже провалидирован
 * (см. utils/validation.parseHabitEmoji). Фильтр по userId + isActive —
 * как в renameHabit: owner-check и запрет менять удалённую привычку.
 *
 * @returns true если привычка найдена и эмодзи изменён, false иначе.
 */
export const changeHabitEmoji = async (
  habitId: number,
  userId: number,
  emoji: string
): Promise<boolean> => {
  const result = await prisma.habit.updateMany({
    where: { id: habitId, userId, isActive: true },
    data: { emoji },
  });
  return result.count > 0;
};
