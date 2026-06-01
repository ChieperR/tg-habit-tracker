import { describe, it, expect } from 'vitest';
import { escapeMarkdown } from './telegram.js';

describe('escapeMarkdown', () => {
  it('экранирует подчёркивание', () => {
    expect(escapeMarkdown('a_b')).toBe('a\\_b');
  });

  it('экранирует звёздочку', () => {
    expect(escapeMarkdown('a*b')).toBe('a\\*b');
  });

  it('экранирует квадратные скобки', () => {
    expect(escapeMarkdown('[x]')).toBe('\\[x\\]');
  });

  it('экранирует бэктик', () => {
    expect(escapeMarkdown('`c`')).toBe('\\`c\\`');
  });

  it('обычный текст без изменений', () => {
    expect(escapeMarkdown('просто текст 123')).toBe('просто текст 123');
  });

  it('пустая строка', () => {
    expect(escapeMarkdown('')).toBe('');
  });

  it('несколько спецсимволов сразу', () => {
    expect(escapeMarkdown('*_[`')).toBe('\\*\\_\\[\\`');
  });

  it('не трогает не-reserved символы (точки, скобки)', () => {
    expect(escapeMarkdown('habit (3 дн.)')).toBe('habit (3 дн.)');
  });
});
