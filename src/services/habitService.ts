import { Habit, HabitLog } from '@prisma/client';
import { prisma } from '../db/index.js';
import { CreateHabitInput, FrequencyType, HabitWithTodayStatus } from '../types/index.js';
import { getTodayDate, isHabitDueToday } from '../utils/date.js';

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
 * Переключает статус выполнения привычки за сегодня
 * @param habitId - ID привычки
 * @param timezoneOffset - Смещение часового пояса
 * @returns Новый статус (true = выполнено)
 */
export const toggleHabitCompletion = async (
  habitId: number,
  timezoneOffset: number = 180
): Promise<boolean> => {
  const today = getTodayDate(timezoneOffset);
  const existingLog = await getHabitLog(habitId, today);

  if (existingLog) {
    // Переключаем статус
    const updated = await prisma.habitLog.update({
      where: { id: existingLog.id },
      data: { completed: !existingLog.completed, markedAt: new Date() },
    });
    return updated.completed;
  }

  // Создаём новый лог как выполненный
  await prisma.habitLog.create({
    data: {
      habitId,
      date: today,
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
      
      const isDueToday = isHabitDueToday({
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
