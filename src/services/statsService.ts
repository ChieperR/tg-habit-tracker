import { prisma } from '../db/index.js';
import { HabitStats, UserStats } from '../types/index.js';
import { getLastNDays, getTodayDate } from '../utils/date.js';
import { format, subDays, startOfWeek, addDays, parse } from 'date-fns';

/**
 * Сервис для работы со статистикой
 * @module services/statsService
 */

/**
 * Вычисляет текущий streak (дней подряд) для привычки
 * @param habitId - ID привычки
 * @param frequencyDays - Частота привычки в днях
 * @param timezoneOffset - Смещение часового пояса
 * @returns Количество дней подряд
 */
export const calculateCurrentStreak = async (
  habitId: number,
  frequencyDays: number,
  timezoneOffset: number = 180
): Promise<number> => {
  const today = getTodayDate(timezoneOffset);

  // Получаем все успешные выполнения, отсортированные по дате (новые первые)
  const completedLogs = await prisma.habitLog.findMany({
    where: { habitId, completed: true },
    orderBy: { date: 'desc' },
  });

  if (completedLogs.length === 0) {
    return 0;
  }

  let streak = 0;
  let expectedDate = new Date(today);

  for (const log of completedLogs) {
    const logDate = new Date(log.date);
    const diffDays = Math.floor(
      (expectedDate.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Для привычек с frequencyDays > 1, проверяем в пределах допустимого интервала
    if (diffDays <= frequencyDays && diffDays >= 0) {
      streak++;
      // Следующая ожидаемая дата — на frequencyDays раньше
      expectedDate = new Date(logDate.getTime() - frequencyDays * 24 * 60 * 60 * 1000);
    } else if (diffDays > frequencyDays) {
      // Цепочка прервана
      break;
    }
    // Если diffDays < 0, значит дата в будущем — пропускаем
  }

  return streak;
};

/**
 * Вычисляет максимальный streak для привычки
 * @param habitId - ID привычки
 * @param frequencyDays - Частота привычки в днях
 * @returns Максимальное количество дней подряд
 */
export const calculateMaxStreak = async (
  habitId: number,
  frequencyDays: number
): Promise<number> => {
  const completedLogs = await prisma.habitLog.findMany({
    where: { habitId, completed: true },
    orderBy: { date: 'asc' },
  });

  if (completedLogs.length === 0) {
    return 0;
  }

  let maxStreak = 1;
  let currentStreak = 1;

  for (let i = 1; i < completedLogs.length; i++) {
    const prevLog = completedLogs[i - 1];
    const currentLog = completedLogs[i];

    if (!prevLog || !currentLog) continue;

    const prevDate = new Date(prevLog.date);
    const currDate = new Date(currentLog.date);
    const diffDays = Math.floor(
      (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays <= frequencyDays) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }

  return maxStreak;
};

/**
 * Вычисляет процент выполнения привычки за последние N дней
 * @param habitId - ID привычки
 * @param frequencyDays - Частота привычки
 * @param days - Количество дней для анализа
 * @param timezoneOffset - Смещение часового пояса
 * @returns Процент выполнения (0-100)
 */
export const calculateCompletionRate = async (
  habitId: number,
  frequencyDays: number,
  days: number = 30,
  timezoneOffset: number = 180
): Promise<number> => {
  const lastNDays = getLastNDays(days, timezoneOffset);

  // Сколько раз привычка должна была быть выполнена
  const expectedCompletions = Math.ceil(days / frequencyDays);

  const completedCount = await prisma.habitLog.count({
    where: {
      habitId,
      completed: true,
      date: { in: lastNDays },
    },
  });

  if (expectedCompletions === 0) {
    return 100;
  }

  return Math.round((completedCount / expectedCompletions) * 100);
};

/**
 * Получает статистику по одной привычке
 * @param habitId - ID привычки
 * @param timezoneOffset - Смещение часового пояса
 * @returns Статистика привычки
 */
export const getHabitStats = async (
  habitId: number,
  timezoneOffset: number = 180
): Promise<HabitStats | null> => {
  const habit = await prisma.habit.findUnique({
    where: { id: habitId },
  });

  if (!habit) {
    return null;
  }

  const totalCompleted = await prisma.habitLog.count({
    where: { habitId, completed: true },
  });

  const [currentStreak, maxStreak, completionRate] = await Promise.all([
    calculateCurrentStreak(habitId, habit.frequencyDays, timezoneOffset),
    calculateMaxStreak(habitId, habit.frequencyDays),
    calculateCompletionRate(habitId, habit.frequencyDays, 30, timezoneOffset),
  ]);

  return {
    habitId,
    name: habit.name,
    emoji: habit.emoji,
    totalCompleted,
    currentStreak,
    maxStreak,
    completionRate,
  };
};

/**
 * Получает общую статистику пользователя
 * @param userId - ID пользователя в БД
 * @param timezoneOffset - Смещение часового пояса
 * @returns Общая статистика
 */
export const getUserStats = async (
  userId: number,
  timezoneOffset: number = 180
): Promise<UserStats> => {
  const habits = await prisma.habit.findMany({
    where: { userId },
  });

  const activeHabits = habits.filter((h) => h.isActive);

  const totalCompletions = await prisma.habitLog.count({
    where: {
      habit: { userId },
      completed: true,
    },
  });

  const habitStats = await Promise.all(
    activeHabits.map((h) => getHabitStats(h.id, timezoneOffset))
  );

  return {
    totalHabits: habits.length,
    activeHabits: activeHabits.length,
    totalCompletions,
    habitStats: habitStats.filter((s): s is HabitStats => s !== null),
  };
};

/**
 * Генерирует график активности в стиле GitHub contributions
 * @param userId - ID пользователя
 * @param timezoneOffset - Смещение часового пояса
 * @returns Строка с графиком активности
 */
export const generateActivityGraph = async (
  userId: number,
  timezoneOffset: number = 180
): Promise<string> => {
  const today = getTodayDate(timezoneOffset);
  const todayDate = parse(today, 'yyyy-MM-dd', new Date());

  // Последние 91 день (13 недель)
  const daysCount = 91;
  const startDate = subDays(todayDate, daysCount - 1);

  // Получаем все даты с выполнением хотя бы одной привычки
  const completedLogs = await prisma.habitLog.findMany({
    where: {
      habit: { userId, isActive: true },
      completed: true,
      date: {
        gte: format(startDate, 'yyyy-MM-dd'),
        lte: today,
      },
    },
    select: { date: true },
  });

  // Создаём Set для быстрой проверки (день активен если хотя бы одна привычка выполнена)
  const activeDates = new Set(completedLogs.map(log => log.date));

  // Создаём матрицу активности (13 недель × 7 дней)
  // График: недели идут слева направо, дни недели сверху вниз
  const weeks = 13;
  const grid: boolean[][] = [];

  // Находим начало первой недели (понедельник)
  const firstMonday = startOfWeek(startDate, { weekStartsOn: 1 });

  // Заполняем сетку: каждая строка = неделя, каждая колонка = день недели
  for (let week = 0; week < weeks; week++) {
    const weekRow: boolean[] = [];
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const checkDate = addDays(firstMonday, week * 7 + dayOfWeek);
      const dateStr = format(checkDate, 'yyyy-MM-dd');

      // Проверяем, не выходим ли за пределы сегодня и не раньше startDate
      if (checkDate >= startDate && checkDate <= todayDate) {
        weekRow.push(activeDates.has(dateStr));
      } else {
        weekRow.push(false);
      }
    }
    grid.push(weekRow);
  }

  // Заголовок с диапазоном дат (короткие названия месяцев)
  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const startDay = startDate.getDate();
  const startMonth = monthNames[startDate.getMonth()];
  const endDay = todayDate.getDate();
  const endMonth = monthNames[todayDate.getMonth()];

  let graph = `📊 *Активность* (${startDay} ${startMonth} — ${endDay} ${endMonth})\n\n`;

  const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    const dayLabel = `\`${weekdayLabels[dayOfWeek] ?? ''}\``;
    let row = `${dayLabel} `;

    for (let week = 0; week < weeks; week++) {
      const isActive = grid[week]?.[dayOfWeek] ?? false;
      row += isActive ? '🟩' : '⬜';
    }
    graph += row + '\n';
  }

  graph += '\n🟩 — выполнено  ⬜ — нет';

  return graph;
};

/**
 * Форматирует статистику для отображения в сообщении
 * @param stats - Статистика пользователя
 * @param userId - ID пользователя в БД
 * @param timezoneOffset - Смещение часового пояса
 * @returns Отформатированное сообщение
 */
export const formatStatsMessage = async (
  stats: UserStats,
  userId: number,
  timezoneOffset: number = 180
): Promise<string> => {
  if (stats.activeHabits === 0) {
    return '📊 *Статистика*\n\nУ тебя пока нет привычек. Добавь первую! ✨';
  }

  let message = '📊 *Твоя статистика*\n\n';
  message += `📝 Активных привычек: *${stats.activeHabits}*\n`;
  message += `✅ Всего выполнений: *${stats.totalCompletions}*\n\n`;

  // Добавляем график активности
  const graph = await generateActivityGraph(userId, timezoneOffset);
  message += graph + '\n';
  message += '━━━━━━━━━━━━━━━\n\n';

  for (const habit of stats.habitStats) {
    const recordSuffix =
      habit.currentStreak < habit.maxStreak
        ? ` (Рекорд: ${habit.maxStreak})`
        : '';
    message += `${habit.emoji} *${habit.name}*\n`;
    message += `   🔥 Стрик: ${habit.currentStreak} дн.${recordSuffix}\n`;
    message += `   📈 За 30 дней: ${habit.completionRate}%\n\n`;
  }

  return message;
};
