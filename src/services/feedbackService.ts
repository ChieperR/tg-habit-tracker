import { FeedbackMessage, User } from '@prisma/client';
import { prisma } from '../db/index.js';

/**
 * Сервис для работы с фидбэком юзеров
 * @module services/feedbackService
 */

/** Минимальный интервал между двумя фидбэками одного юзера (мс) */
const RATE_LIMIT_MS = 5 * 60 * 1000;

/**
 * Создаёт запись фидбэка и атомарно обновляет `user.lastFeedbackAt = now()`
 * @param input - Данные фидбэка (userId обязателен, photoFileId опционально)
 * @returns Созданная запись
 */
export const createFeedback = async (input: {
  userId: number;
  text: string;
  photoFileId?: string | null;
}): Promise<FeedbackMessage & { user: User }> => {
  const [feedback] = await prisma.$transaction([
    prisma.feedbackMessage.create({
      data: {
        userId: input.userId,
        text: input.text,
        photoFileId: input.photoFileId ?? null,
      },
      include: { user: true },
    }),
    prisma.user.update({
      where: { id: input.userId },
      data: { lastFeedbackAt: new Date() },
    }),
  ]);
  return feedback;
};

/**
 * Возвращает фидбэк по id с подгруженным юзером
 * @param id - ID фидбэка
 * @returns Запись с юзером или null
 */
export const getFeedbackById = async (
  id: number
): Promise<(FeedbackMessage & { user: { id: number; telegramId: bigint } }) | null> => {
  return prisma.feedbackMessage.findUnique({
    where: { id },
    include: { user: { select: { id: true, telegramId: true } } },
  });
};

/**
 * Помечает фидбэк как `seen` без отправки ответа юзеру
 * @param id - ID фидбэка
 */
export const markFeedbackSeen = async (id: number): Promise<void> => {
  await prisma.feedbackMessage.update({
    where: { id },
    data: { status: 'seen', repliedAt: new Date() },
  });
};

/**
 * Записывает ответ админа на фидбэк
 * @param id - ID фидбэка
 * @param replyText - Текст ответа админа
 */
export const replyToFeedback = async (id: number, replyText: string): Promise<void> => {
  await prisma.feedbackMessage.update({
    where: { id },
    data: {
      status: 'replied',
      adminReply: replyText,
      repliedAt: new Date(),
    },
  });
};

/**
 * Проверяет rate-limit. Возвращает количество секунд до следующего разрешённого
 * фидбэка, либо 0 если можно отправлять прямо сейчас.
 * @param userId - ID юзера в БД
 */
export const getFeedbackCooldownSeconds = async (userId: number): Promise<number> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastFeedbackAt: true },
  });
  if (!user?.lastFeedbackAt) return 0;
  const elapsedMs = Date.now() - user.lastFeedbackAt.getTime();
  if (elapsedMs >= RATE_LIMIT_MS) return 0;
  return Math.ceil((RATE_LIMIT_MS - elapsedMs) / 1000);
};

/**
 * Контекст юзера для уведомления админу: стаж, число привычек, общее число
 * чек-инов. Используется в `📬 Новый фидбэк` шапке, чтобы админ сразу видел
 * кто пишет.
 */
export type FeedbackUserContext = {
  /** Сколько дней с регистрации */
  daysSinceJoin: number;
  /** Количество активных привычек */
  activeHabits: number;
  /** Всего успешных чек-инов */
  totalCheckins: number;
};

/**
 * Считает мини-контекст юзера для уведомления админу
 * @param userId - ID юзера в БД
 */
export const getFeedbackUserContext = async (userId: number): Promise<FeedbackUserContext> => {
  const [user, activeHabits, totalCheckins] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    }),
    prisma.habit.count({ where: { userId, isActive: true } }),
    prisma.habitLog.count({ where: { habit: { userId }, completed: true } }),
  ]);
  const daysSinceJoin = user
    ? Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 3600 * 1000))
    : 0;
  return { daysSinceJoin, activeHabits, totalCheckins };
};
