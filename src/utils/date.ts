/**
 * Утилиты для работы с датами
 * @module utils/date
 */

import {
  format,
  subDays,
  addWeeks,
  differenceInDays,
  getDay,
  parse,
  eachDayOfInterval,
  startOfWeek,
} from 'date-fns';

/**
 * Получает текущую дату в часовом поясе пользователя
 * @param timezoneOffset - Смещение часового пояса в минутах от UTC
 * @returns Date объект в часовом поясе пользователя
 */
export const getNowInTimezone = (timezoneOffset: number = 180): Date => {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + timezoneOffset * 60000);
};

/**
 * Получает текущую дату в формате YYYY-MM-DD
 * @param timezoneOffset - Смещение часового пояса в минутах от UTC
 * @returns Строка даты в формате YYYY-MM-DD
 */
export const getTodayDate = (timezoneOffset: number = 180): string => {
  return format(getNowInTimezone(timezoneOffset), 'yyyy-MM-dd');
};

/**
 * Получает дату N дней назад
 * @param days - Количество дней назад
 * @param timezoneOffset - Смещение часового пояса
 * @returns Строка даты в формате YYYY-MM-DD
 */
export const getDateDaysAgo = (days: number, timezoneOffset: number = 180): string => {
  const now = getNowInTimezone(timezoneOffset);
  return format(subDays(now, days), 'yyyy-MM-dd');
};

/**
 * Парсит время из строки HH:MM
 * @param timeStr - Время в формате HH:MM
 * @returns Объект с часами и минутами
 */
export const parseTime = (timeStr: string): { hours: number; minutes: number } => {
  const [hoursStr, minutesStr] = timeStr.split(':');
  return { 
    hours: parseInt(hoursStr ?? '0', 10), 
    minutes: parseInt(minutesStr ?? '0', 10) 
  };
};

/**
 * Форматирует время в строку HH:MM
 * @param hours - Часы
 * @param minutes - Минуты
 * @returns Строка времени в формате HH:MM
 */
export const formatTime = (hours: number, minutes: number): string => {
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

/**
 * Получает день недели для даты (0 = Вс, 1 = Пн, ..., 6 = Сб)
 * @param dateStr - Дата в формате YYYY-MM-DD
 * @returns Номер дня недели
 */
export const getDayOfWeek = (dateStr: string): number => {
  const date = parse(dateStr, 'yyyy-MM-dd', new Date());
  return getDay(date);
};

/**
 * Параметры для проверки, нужно ли выполнять привычку
 */
export type HabitDueParams = {
  frequencyType: 'daily' | 'interval' | 'weekdays';
  frequencyDays: number;
  weekdays: string | null;
  lastCompletedDate: string | null;
  todayDate: string;
};

/**
 * Проверяет, нужно ли выполнять привычку сегодня
 * @param params - Параметры привычки
 * @returns true если привычку нужно выполнить сегодня
 */
export const isHabitDueToday = (params: HabitDueParams): boolean => {
  const { frequencyType, frequencyDays, weekdays, lastCompletedDate, todayDate } = params;

  switch (frequencyType) {
    case 'daily':
      return true;

    case 'interval': {
      if (!lastCompletedDate) {
        return true;
      }

      const lastDate = parse(lastCompletedDate, 'yyyy-MM-dd', new Date());
      const today = parse(todayDate, 'yyyy-MM-dd', new Date());
      const diffDays = differenceInDays(today, lastDate);

      return diffDays >= frequencyDays;
    }

    case 'weekdays': {
      if (!weekdays) {
        return false;
      }

      const todayDayOfWeek = getDayOfWeek(todayDate);
      const allowedDays = weekdays.split(',').map(Number);
      
      return allowedDays.includes(todayDayOfWeek);
    }

    default:
      return true;
  }
};

/**
 * Получает список дат за последние N дней
 * @param days - Количество дней
 * @param timezoneOffset - Смещение часового пояса
 * @returns Массив дат в формате YYYY-MM-DD (от старых к новым)
 */
export const getLastNDays = (days: number, timezoneOffset: number = 180): string[] => {
  const now = getNowInTimezone(timezoneOffset);
  const startDate = subDays(now, days - 1);
  
  const interval = eachDayOfInterval({ start: startDate, end: now });
  return interval.map(date => format(date, 'yyyy-MM-dd'));
};

/**
 * Форматирует дату для отображения пользователю
 * @param dateStr - Дата в формате YYYY-MM-DD
 * @returns Человекочитаемая дата
 */
export const formatDateForDisplay = (dateStr: string): string => {
  const date = parse(dateStr, 'yyyy-MM-dd', new Date());
  return format(date, 'd MMMM', { locale: undefined }); // Можно добавить ru locale
};

/**
 * Параметры для проверки, была ли привычка запланирована на дату
 */
export type HabitDueOnDateParams = {
  frequencyType: 'daily' | 'interval' | 'weekdays';
  frequencyDays: number;
  weekdays: string | null;
  /** Для interval: дата первого выполнения или создания привычки (YYYY-MM-DD) */
  referenceDate: string | null;
  /** Проверяемая дата (YYYY-MM-DD) */
  dateStr: string;
};

/**
 * Проверяет, была ли привычка запланирована на указанную дату
 * @param params - Параметры привычки и дата
 * @returns true если в этот день привычка должна была быть выполнена
 */
export const isHabitDueOnDate = (params: HabitDueOnDateParams): boolean => {
  const { frequencyType, frequencyDays, weekdays, referenceDate, dateStr } = params;

  switch (frequencyType) {
    case 'daily':
      return true;

    case 'interval': {
      if (!referenceDate) {
        return true;
      }
      const ref = parse(referenceDate, 'yyyy-MM-dd', new Date());
      const date = parse(dateStr, 'yyyy-MM-dd', new Date());
      const diffDays = differenceInDays(date, ref);
      return diffDays >= 0 && diffDays % frequencyDays === 0;
    }

    case 'weekdays': {
      if (!weekdays) {
        return false;
      }
      const dayOfWeek = getDayOfWeek(dateStr);
      const allowedDays = weekdays.split(',').map(Number);
      return allowedDays.includes(dayOfWeek);
    }

    default:
      return true;
  }
};

/**
 * Возвращает понедельник текущей (или смещённой) недели в часовом поясе пользователя
 * @param timezoneOffset - Смещение в минутах
 * @param offsetWeeks - Смещение в неделях (0 = текущая, -1 = прошлая, 1 = следующая)
 * @returns Дата понедельника в формате YYYY-MM-DD
 */
export const getWeekStartMonday = (
  timezoneOffset: number = 180,
  offsetWeeks: number = 0
): string => {
  const now = getNowInTimezone(timezoneOffset);
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  const week = offsetWeeks === 0 ? monday : addWeeks(monday, offsetWeeks);
  return format(week, 'yyyy-MM-dd');
};
