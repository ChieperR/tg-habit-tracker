import { describe, it, expect } from 'vitest';
import { parseTimezoneFromText } from './timezoneFromLocation.js';

describe('parseTimezoneFromText', () => {
  it('число без знака → восток (минуты)', () => {
    expect(parseTimezoneFromText('3')).toBe(180);
  });

  it('с плюсом', () => {
    expect(parseTimezoneFromText('+3')).toBe(180);
  });

  it('префикс UTC', () => {
    expect(parseTimezoneFromText('UTC+3')).toBe(180);
    expect(parseTimezoneFromText('utc+3')).toBe(180);
  });

  it('отрицательное смещение', () => {
    expect(parseTimezoneFromText('-5')).toBe(-300);
    expect(parseTimezoneFromText('UTC-5')).toBe(-300);
  });

  it('дробное смещение (точка и запятая)', () => {
    expect(parseTimezoneFromText('3.5')).toBe(210);
    expect(parseTimezoneFromText('3,5')).toBe(210);
  });

  it('границы диапазона', () => {
    expect(parseTimezoneFromText('14')).toBe(840);
    expect(parseTimezoneFromText('-12')).toBe(-720);
  });

  it('вне диапазона → null', () => {
    expect(parseTimezoneFromText('15')).toBeNull();
    expect(parseTimezoneFromText('-13')).toBeNull();
  });

  it('нечисловой ввод → null', () => {
    expect(parseTimezoneFromText('abc')).toBeNull();
    expect(parseTimezoneFromText('')).toBeNull();
  });

  it('лишние пробелы обрезаются', () => {
    expect(parseTimezoneFromText('  +3  ')).toBe(180);
  });
});
