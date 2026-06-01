import { describe, it, expect } from 'vitest';
import { pickDeterministic, renderTemplate } from './textSelector.js';

describe('pickDeterministic', () => {
  const pool = ['a', 'b', 'c', 'd'];

  it('возвращает один и тот же элемент для одного seed (идемпотентность)', () => {
    const first = pickDeterministic(pool, 'user:1:2026-01-01');
    const second = pickDeterministic(pool, 'user:1:2026-01-01');
    expect(first).toBe(second);
  });

  it('возвращает элемент из пула', () => {
    expect(pool).toContain(pickDeterministic(pool, 'seed-x'));
  });

  it('разные seeds дают разброс по пулу (не всегда один элемент)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(pickDeterministic(pool, `seed-${i}`));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('пул из одного элемента всегда возвращает его', () => {
    expect(pickDeterministic(['only'], 'any-seed')).toBe('only');
  });

  it('бросает на пустом пуле', () => {
    expect(() => pickDeterministic([], 'seed')).toThrow();
  });
});

describe('renderTemplate', () => {
  it('подставляет один плейсхолдер', () => {
    expect(renderTemplate('Привет, {name}!', { name: 'Аня' })).toBe('Привет, Аня!');
  });

  it('подставляет несколько плейсхолдеров', () => {
    expect(renderTemplate('{a} и {b}', { a: 'X', b: 'Y' })).toBe('X и Y');
  });

  it('заменяет все вхождения одного плейсхолдера', () => {
    expect(renderTemplate('{n}+{n}', { n: 2 })).toBe('2+2');
  });

  it('числовые значения приводятся к строке', () => {
    expect(renderTemplate('стрик {days} дн.', { days: 10 })).toBe('стрик 10 дн.');
  });

  it('оставляет неизвестные плейсхолдеры как есть', () => {
    expect(renderTemplate('{known} {unknown}', { known: 'ok' })).toBe('ok {unknown}');
  });

  it('без плейсхолдеров возвращает шаблон неизменным', () => {
    expect(renderTemplate('просто текст', { x: 1 })).toBe('просто текст');
  });
});
