import { describe, it, expect } from 'vitest';
import { pickPendingSlots, initialLastSentDate, sortTimes } from './habitReminderSlots.js';

const today = '2026-11-20';
const slot = (id: number, time: string, lastSentDate: string | null = null) => ({ id, time, lastSentDate });

describe('pickPendingSlots', () => {
  it('наступившее и не отправленное сегодня — пора', () => {
    expect(pickPendingSlots([slot(1, '09:00')], 9 * 60, today).map((s) => s.id)).toEqual([1]);
  });

  it('ещё не наступило — не пора', () => {
    expect(pickPendingSlots([slot(1, '09:00')], 8 * 60 + 59, today)).toEqual([]);
  });

  it('уже отправлено сегодня — не пора, вчерашняя отправка не мешает', () => {
    expect(pickPendingSlots([slot(1, '09:00', today)], 12 * 60, today)).toEqual([]);
    expect(pickPendingSlots([slot(1, '09:00', '2026-11-19')], 12 * 60, today).map((s) => s.id)).toEqual([1]);
  });

  it('из трёх времён в 14:05: утреннее отправлено, 14:00 пора, 19:00 впереди', () => {
    const slots = [slot(1, '09:00', today), slot(2, '14:00'), slot(3, '19:00')];
    expect(pickPendingSlots(slots, 14 * 60 + 5, today).map((s) => s.id)).toEqual([2]);
  });

  it('бот лежал с утра: оба прошедших времени попадают в одну отправку', () => {
    const slots = [slot(1, '09:00'), slot(2, '14:00'), slot(3, '19:00')];
    expect(pickPendingSlots(slots, 14 * 60 + 5, today).map((s) => s.id)).toEqual([1, 2]);
  });
});

describe('initialLastSentDate', () => {
  it('время уже прошло (или ровно сейчас) — сегодня, чтобы не прийти сразу', () => {
    expect(initialLastSentDate('09:00', 12 * 60, today)).toBe(today);
    expect(initialLastSentDate('12:00', 12 * 60, today)).toBe(today);
  });

  it('время впереди — null, сработает сегодня', () => {
    expect(initialLastSentDate('18:00', 12 * 60, today)).toBeNull();
  });
});

describe('sortTimes', () => {
  it('сортирует по времени', () => {
    expect(sortTimes(['19:00', '07:30', '13:00'])).toEqual(['07:30', '13:00', '19:00']);
  });
});
