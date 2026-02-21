/**
 * Получение и парсинг часового пояса
 * @module utils/timezoneFromLocation
 */

import { find } from 'geo-tz';
import { getTimezoneOffset } from 'date-fns-tz';

/** Смещение в минутах от UTC (положительное — восток) */
const MS_PER_MINUTE = 60_000;

/**
 * Возвращает смещение часового пояса в минутах по координатам
 * @param latitude - Широта
 * @param longitude - Долгота
 * @returns Смещение в минутах от UTC (например, 180 для МСК) или null при ошибке
 */
export const getTimezoneOffsetFromLocation = (
  latitude: number,
  longitude: number
): number | null => {
  try {
    const zones = find(latitude, longitude);
    const iana = Array.isArray(zones) ? zones[0] : zones;
    if (!iana || typeof iana !== 'string') {
      return null;
    }
    const offsetMs = getTimezoneOffset(iana, new Date());
    return Math.round(offsetMs / MS_PER_MINUTE);
  } catch {
    return null;
  }
};

/**
 * Парсит смещение часового пояса из текста пользователя
 * @param input - Строка вида "3", "+3", "UTC+3", "-5", "UTC-5"
 * @returns Смещение в минутах от UTC или null при неверном формате
 */
export const parseTimezoneFromText = (input: string): number | null => {
  const cleaned = input.trim().replace(',', '.').replace(/^UTC/i, '').trim();
  const offset = parseFloat(cleaned);
  if (isNaN(offset) || offset < -12 || offset > 14) {
    return null;
  }
  return Math.round(offset * 60);
};
