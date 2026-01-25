import { PrismaClient } from '@prisma/client';

/**
 * Инстанс Prisma клиента
 * @description Используется для всех операций с базой данных
 */
export const prisma = new PrismaClient();

/**
 * Инициализирует подключение к базе данных
 * @returns Promise, который резолвится при успешном подключении
 */
export const initDatabase = async (): Promise<void> => {
  await prisma.$connect();
  console.log('✅ База данных подключена');
};

/**
 * Закрывает подключение к базе данных
 * @returns Promise, который резолвится при закрытии подключения
 */
export const closeDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  console.log('🔌 База данных отключена');
};
