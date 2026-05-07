import { FeedbackMessage, Prisma } from '@prisma/client';
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
}): Promise<FeedbackMessage> => {
  const [feedback] = await prisma.$transaction([
    prisma.feedbackMessage.create({
      data: {
        userId: input.userId,
        text: input.text,
        photoFileId: input.photoFileId ?? null,
      },
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
 * Контекст юзера для уведомления админу: стаж, число привычек, longest streak
 * среди всех привычек, общее число чек-инов. Используется в `📬 Новый фидбэк`
 * шапке, чтобы админ сразу видел кто пишет.
 */
export type FeedbackUserContext = {
  /** Сколько дней с регистрации */
  daysSinceJoin: number;
  /** Количество активных привычек */
  activeHabits: number;
  /** Лучший streak среди всех привычек юзера */
  longestStreak: number;
  /** Всего успешных чек-инов */
  totalCheckins: number;
};

/**
 * Считает мини-контекст юзера для уведомления админу
 * @param userId - ID юзера в БД
 */
export const getFeedbackUserContext = async (userId: number): Promise<FeedbackUserContext> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  const daysSinceJoin = user
    ? Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 3600 * 1000))
    : 0;

  const activeHabits = await prisma.habit.count({
    where: { userId, isActive: true },
  });

  const totalCheckins = await prisma.habitLog.count({
    where: { habit: { userId }, completed: true },
  });

  // longest streak — берём максимум из агрегата по сериям подряд для каждой
  // привычки. Для простоты считаем sql-зависимым способом: выбираем все
  // completed-логи юзера, сортируем по дате, в цикле считаем максимум
  // непрерывных дней. Дешевле чем гонять несколько SQL.
  const logs = await prisma.habitLog.findMany({
    where: { habit: { userId }, completed: true },
    select: { habitId: true, date: true },
    orderBy: [{ habitId: 'asc' }, { date: 'asc' }],
  });
  const longestStreak = computeLongestStreak(logs);

  return { daysSinceJoin, activeHabits, longestStreak, totalCheckins };
};

const ONE_DAY_MS = 24 * 3600 * 1000;

/**
 * Считает максимальный непрерывный streak (дней подряд) из плоского списка
 * `{habitId, date}` записей. Логи приходят отсортированными по habitId, дате.
 */
const computeLongestStreak = (
  logs: { habitId: number; date: string }[]
): number => {
  let maxStreak = 0;
  let currentHabit = -1;
  let prevTs = 0;
  let streak = 0;
  for (const log of logs) {
    const ts = new Date(log.date).getTime();
    if (log.habitId !== currentHabit) {
      currentHabit = log.habitId;
      streak = 1;
      prevTs = ts;
    } else if (ts - prevTs === ONE_DAY_MS) {
      streak += 1;
      prevTs = ts;
    } else {
      streak = 1;
      prevTs = ts;
    }
    if (streak > maxStreak) maxStreak = streak;
  }
  return maxStreak;
};
