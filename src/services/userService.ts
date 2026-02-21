import { User } from '@prisma/client';
import { prisma } from '../db/index.js';
import { UserSettings } from '../types/index.js';

/**
 * Сервис для работы с пользователями
 * @module services/userService
 */

/**
 * Находит или создаёт пользователя по Telegram ID
 * @param telegramId - ID пользователя в Telegram
 * @returns Пользователь из базы данных
 */
export const findOrCreateUser = async (telegramId: number): Promise<User> => {
  const existing = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: { telegramId: BigInt(telegramId) },
  });
};

/**
 * Получает пользователя по ID в базе данных
 * @param id - ID пользователя в БД
 * @returns Пользователь или null
 */
export const getUserById = async (id: number): Promise<User | null> => {
  return prisma.user.findUnique({
    where: { id },
  });
};

/**
 * Получает пользователя по Telegram ID
 * @param telegramId - ID пользователя в Telegram
 * @returns Пользователь или null
 */
export const getUserByTelegramId = async (telegramId: number): Promise<User | null> => {
  return prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
};

/**
 * Обновляет настройки пользователя
 * @param userId - ID пользователя в БД
 * @param settings - Новые настройки
 * @returns Обновлённый пользователь
 */
export const updateUserSettings = async (
  userId: number,
  settings: Partial<UserSettings>
): Promise<User> => {
  return prisma.user.update({
    where: { id: userId },
    data: settings,
  });
};

/**
 * Получает пользователей для утренних напоминаний
 * @description Включает пользователей без часового пояса — для них используется МСК (UTC+3)
 * @returns Массив пользователей
 */
export const getUsersForMorningReminder = async (): Promise<User[]> => {
  return prisma.user.findMany({
    where: { morningEnabled: true },
  });
};

/**
 * Получает пользователей для вечерних напоминаний
 * @description Включает пользователей без часового пояса — для них используется МСК (UTC+3)
 * @returns Массив пользователей
 */
export const getUsersForEveningReminder = async (): Promise<User[]> => {
  return prisma.user.findMany({
    where: { eveningEnabled: true },
  });
};

/**
 * Получает настройки пользователя
 * @param userId - ID пользователя в БД
 * @returns Настройки пользователя или null
 */
export const getUserSettings = async (userId: number): Promise<UserSettings | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      morningTime: true,
      eveningTime: true,
      timezoneOffset: true,
      morningEnabled: true,
      eveningEnabled: true,
    },
  });

  return user;
};
