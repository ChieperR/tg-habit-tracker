import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatYMDUtc,
  getNowInTimezone,
  getCurrentMinutesInTimezone,
  getTodayDate,
  getDateDaysAgo,
  parseTime,
  formatTime,
  getDayOfWeek,
  isHabitDueToday,
  getNextDueDay,
  getLastNDays,
  formatDateForDisplay,
  isHabitDueOnDate,
  getWeekStartMonday,
  formatDayHeader,
  formatDayLabel,
  getPrevDate,
  getNextDate,
} from './date.js';

describe('formatYMDUtc', () => {
  it('форматирует через UTC-аксессоры', () => {
    expect(formatYMDUtc(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });

  it('паддит месяц и день', () => {
    expect(formatYMDUtc(new Date('2026-03-09T12:00:00Z'))).toBe('2026-03-09');
  });
});

describe('parseTime', () => {
  it('парсит HH:MM', () => {
    expect(parseTime('08:30')).toEqual({ hours: 8, minutes: 30 });
  });
  it('парсит время с одной цифрой', () => {
    expect(parseTime('9:5')).toEqual({ hours: 9, minutes: 5 });
  });
  it('отсутствующие части дают NaN (в проде вход всегда валидный HH:MM из БД)', () => {
    // `?? '0'` срабатывает только на undefined/null, не на пустой строке,
    // поэтому parseInt('') → NaN. Документируем фактическое поведение.
    expect(parseTime('')).toEqual({ hours: NaN, minutes: 0 });
  });
});

describe('formatTime', () => {
  it('паддит часы и минуты', () => {
    expect(formatTime(8, 5)).toBe('08:05');
    expect(formatTime(21, 0)).toBe('21:00');
  });
});

describe('getDayOfWeek', () => {
  it('0=Вс ... 6=Сб', () => {
    expect(getDayOfWeek('2026-01-01')).toBe(4); // Thu
    expect(getDayOfWeek('2026-01-05')).toBe(1); // Mon
    expect(getDayOfWeek('2026-01-04')).toBe(0); // Sun
  });
});

describe('isHabitDueToday', () => {
  it('daily — всегда true', () => {
    expect(isHabitDueToday({ frequencyType: 'daily', frequencyDays: 1, weekdays: null, lastCompletedDate: null, todayDate: '2026-01-05' })).toBe(true);
  });

  it('interval без последнего выполнения → true', () => {
    expect(isHabitDueToday({ frequencyType: 'interval', frequencyDays: 3, weekdays: null, lastCompletedDate: null, todayDate: '2026-01-05' })).toBe(true);
  });

  it('interval — true если прошло >= frequencyDays', () => {
    expect(isHabitDueToday({ frequencyType: 'interval', frequencyDays: 3, weekdays: null, lastCompletedDate: '2026-01-01', todayDate: '2026-01-04' })).toBe(true);
    expect(isHabitDueToday({ frequencyType: 'interval', frequencyDays: 3, weekdays: null, lastCompletedDate: '2026-01-01', todayDate: '2026-01-03' })).toBe(false);
  });

  it('weekdays — true только в нужный день', () => {
    expect(isHabitDueToday({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: '1,3,5', lastCompletedDate: null, todayDate: '2026-01-05' })).toBe(true); // Mon
    expect(isHabitDueToday({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: '1,3,5', lastCompletedDate: null, todayDate: '2026-01-06' })).toBe(false); // Tue
  });

  it('weekdays без расписания → false', () => {
    expect(isHabitDueToday({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: null, lastCompletedDate: null, todayDate: '2026-01-05' })).toBe(false);
  });
});

describe('isHabitDueOnDate', () => {
  it('daily — всегда true', () => {
    expect(isHabitDueOnDate({ frequencyType: 'daily', frequencyDays: 1, weekdays: null, referenceDate: null, dateStr: '2026-01-05' })).toBe(true);
  });

  it('interval — кратность от referenceDate, не раньше неё', () => {
    expect(isHabitDueOnDate({ frequencyType: 'interval', frequencyDays: 3, weekdays: null, referenceDate: '2026-01-01', dateStr: '2026-01-04' })).toBe(true);
    expect(isHabitDueOnDate({ frequencyType: 'interval', frequencyDays: 3, weekdays: null, referenceDate: '2026-01-01', dateStr: '2026-01-03' })).toBe(false);
    expect(isHabitDueOnDate({ frequencyType: 'interval', frequencyDays: 3, weekdays: null, referenceDate: '2026-01-05', dateStr: '2026-01-01' })).toBe(false);
  });

  it('weekdays — по дню недели', () => {
    expect(isHabitDueOnDate({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: '1', referenceDate: null, dateStr: '2026-01-05' })).toBe(true);
    expect(isHabitDueOnDate({ frequencyType: 'weekdays', frequencyDays: 1, weekdays: '1', referenceDate: null, dateStr: '2026-01-06' })).toBe(false);
  });
});

describe('getNextDueDay', () => {
  it('возвращает ближайший день недели из расписания', () => {
    // today 2026-01-05 (Mon), расписание Wed(3) → среда
    expect(getNextDueDay('3', '2026-01-05')).toBe('среда');
  });
});

describe('getPrevDate / getNextDate', () => {
  it('сдвиг на день', () => {
    expect(getPrevDate('2026-01-05')).toBe('2026-01-04');
    expect(getNextDate('2026-01-05')).toBe('2026-01-06');
  });
  it('через границу месяца', () => {
    expect(getPrevDate('2026-02-01')).toBe('2026-01-31');
    expect(getNextDate('2026-01-31')).toBe('2026-02-01');
  });
});

describe('formatDateForDisplay', () => {
  it('формат d MMMM', () => {
    expect(formatDateForDisplay('2026-01-05')).toBe('5 January');
  });
});

describe('formatDayHeader', () => {
  it('сегодня', () => {
    expect(formatDayHeader('2026-01-05', '2026-01-05')).toBe('Сегодня, 5 янв');
  });
  it('вчера', () => {
    expect(formatDayHeader('2026-01-05', '2026-01-06')).toBe('Вчера, 5 янв');
  });
  it('давняя дата с днём недели', () => {
    expect(formatDayHeader('2026-01-03', '2026-01-06')).toBe('3 янв, Сб');
  });
});

describe('formatDayLabel', () => {
  it('сегодня / вчера / дата', () => {
    expect(formatDayLabel('2026-01-05', '2026-01-05')).toBe('Сегодня');
    expect(formatDayLabel('2026-01-05', '2026-01-06')).toBe('Вчера');
    expect(formatDayLabel('2026-01-03', '2026-01-06')).toBe('3 янв');
  });
});

describe('now-зависимые функции (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('getNowInTimezone применяет offset в минутах', () => {
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const d = getNowInTimezone(180); // UTC+3
    expect(d.getUTCHours()).toBe(13);
    expect(d.getUTCMinutes()).toBe(30);
  });

  it('getCurrentMinutesInTimezone — минуты с полуночи в TZ юзера', () => {
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    expect(getCurrentMinutesInTimezone(180)).toBe(13 * 60 + 30);
  });

  it('getTodayDate учитывает сдвиг через полночь', () => {
    vi.setSystemTime(new Date('2026-01-15T22:00:00Z'));
    expect(getTodayDate(180)).toBe('2026-01-16'); // +3h → уже 16-е
  });

  it('getDateDaysAgo', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
    expect(getDateDaysAgo(2, 180)).toBe('2026-01-13');
    expect(getDateDaysAgo(0, 180)).toBe('2026-01-15');
  });

  it('getLastNDays — от старых к новым', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
    expect(getLastNDays(3, 180)).toEqual(['2026-01-13', '2026-01-14', '2026-01-15']);
  });

  it('getWeekStartMonday — понедельник текущей и прошлой недели', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z')); // Thu
    expect(getWeekStartMonday(180, 0)).toBe('2026-01-12');
    expect(getWeekStartMonday(180, -1)).toBe('2026-01-05');
  });
});
