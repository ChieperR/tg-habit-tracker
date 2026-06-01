import { describe, it, expect } from 'vitest';
import { computeCompletionRate, renderActivityGraph } from './statsService.js';

describe('computeCompletionRate', () => {
  const days10 = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);

  it('daily: 5 из 10 → 50%', () => {
    const logs = days10.slice(0, 5).map((d) => ({ date: d, completed: true }));
    expect(computeCompletionRate(logs, 1, days10)).toBe(50);
  });

  it('interval раз в 2 дня: ожидается 5, выполнено 5 → 100%', () => {
    const logs = days10.slice(0, 5).map((d) => ({ date: d, completed: true }));
    expect(computeCompletionRate(logs, 2, days10)).toBe(100);
  });

  it('переотметка может дать > 100%', () => {
    const logs = days10.map((d) => ({ date: d, completed: true }));
    expect(computeCompletionRate(logs, 2, days10)).toBe(200);
  });

  it('пустое окно → 100%', () => {
    expect(computeCompletionRate([], 1, [])).toBe(100);
  });

  it('completion вне окна не учитывается', () => {
    const logs = [{ date: '2025-12-01', completed: true }];
    expect(computeCompletionRate(logs, 1, days10)).toBe(0);
  });

  it('невыполненные логи не считаются', () => {
    const logs = days10.map((d) => ({ date: d, completed: false }));
    expect(computeCompletionRate(logs, 1, days10)).toBe(0);
  });
});

describe('renderActivityGraph', () => {
  it('содержит заголовок и легенду', () => {
    const graph = renderActivityGraph(new Set(), '2026-01-15');
    expect(graph).toContain('Активность');
    expect(graph).toContain('🟩 — выполнено');
  });

  // Легенда всегда содержит один 🟩 — поэтому считаем вхождения, а не наличие.
  const countGreen = (s: string): number => (s.match(/🟩/gu) ?? []).length;

  it('активная дата добавляет 🟩 в сетку (сверх легенды)', () => {
    const empty = countGreen(renderActivityGraph(new Set(), '2026-01-15'));
    const withActive = countGreen(renderActivityGraph(new Set(['2026-01-15']), '2026-01-15'));
    expect(empty).toBe(1); // только легенда
    expect(withActive).toBeGreaterThan(empty);
  });

  it('без активных дат сетка состоит из ⬜', () => {
    expect(renderActivityGraph(new Set(), '2026-01-15')).toContain('⬜');
  });
});
