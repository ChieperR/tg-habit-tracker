import { Habit, HabitLog } from '@prisma/client';
import { format } from 'date-fns';
import { prisma } from '../db/index.js';
import { CreateHabitInput, FrequencyType, HabitWithTodayStatus } from '../types/index.js';
import { getTodayDate, isHabitDueToday, isHabitDueOnDate } from '../utils/date.js';

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
 * Удаляет привычку (мягкое удаление — деактивация)
 * @param habitId - ID привычки
 * @returns Обновлённая привычка
 */
export const deleteHabit = async (habitId: number): Promise<Habit> => {
  return prisma.habit.update({
    where: { id: habitId },
    data: { isActive: false },
  });
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

/**
 * Переключает статус выполнения привычки за указанную дату (по умолчанию — сегодня)
 * @param habitId - ID привычки
 * @param timezoneOffset - Смещение часового пояса
 * @param date - Дата в формате YYYY-MM-DD; если не передана — используется сегодня
 * @returns Новый статус (true = выполнено)
 */
export const toggleHabitCompletion = async (
  habitId: number,
  timezoneOffset: number = 180,
  date?: string
): Promise<boolean> => {
  const targetDate = date ?? getTodayDate(timezoneOffset);
  const existingLog = await getHabitLog(habitId, targetDate);

  if (existingLog) {
    const updated = await prisma.habitLog.update({
      where: { id: existingLog.id },
      data: { completed: !existingLog.completed, markedAt: new Date() },
    });
    return updated.completed;
  }

  await prisma.habitLog.create({
    data: {
      habitId,
      date: targetDate,
      completed: true,
    },
  });
  return true;
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
