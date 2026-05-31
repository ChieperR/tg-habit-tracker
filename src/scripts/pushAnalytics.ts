/**
 * Отправляет аналитику бота на внешний дашборд (push-модель).
 *
 * Бот деплоится на отдельном сервере; этот скрипт читает локальную историю
 * DailySnapshot и POST'ит её на webhook дашборда. Идемпотентно (дашборд
 * делает upsert по project+date+metric), поэтому можно гонять как угодно
 * часто и он бэкфилит всю историю.
 *
 * Наружу уходят ТОЛЬКО агрегаты (числа из снапшотов) — никаких сырых
 * пользовательских данных.
 *
 * Запуск (по cron'у, напр. сразу после ежедневного снапшота):
 *   DASHBOARD_URL=https://... DASHBOARD_INGEST_TOKEN=... tsx src/scripts/pushAnalytics.ts
 *
 * @module scripts/pushAnalytics
 */
import { prisma } from '../db/index.js';

const PROJECT = 'tg-habit-tracker';
const URL = process.env.DASHBOARD_URL;
const TOKEN = process.env.DASHBOARD_INGEST_TOKEN;

/** Поля DailySnapshot, которые превращаем в метрики дашборда. */
const SNAPSHOT_METRICS = [
  'totalUsers',
  'newUsers',
  'dau',
  'mau',
  'totalHabits',
  'activeHabits',
  'totalCheckins',
  'avgStreak',
] as const;

type MetricRow = { date: string; metric: string; value: number };

const main = async (): Promise<void> => {
  if (!URL || !TOKEN) {
    console.error('[pushAnalytics] нужны env DASHBOARD_URL и DASHBOARD_INGEST_TOKEN');
    process.exit(1);
  }

  const snapshots = await prisma.dailySnapshot.findMany({ orderBy: { date: 'asc' } });
  const metrics: MetricRow[] = [];
  for (const s of snapshots) {
    for (const key of SNAPSHOT_METRICS) {
      const value = (s as unknown as Record<string, number>)[key];
      if (typeof value === 'number') {
        metrics.push({ date: s.date, metric: key, value });
      }
    }
  }

  if (metrics.length === 0) {
    console.log('[pushAnalytics] нет снапшотов для отправки');
    return;
  }

  const res = await fetch(`${URL.replace(/\/$/, '')}/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ project: PROJECT, metrics }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[pushAnalytics] дашборд ответил ${res.status}: ${text}`);
    process.exit(1);
  }
  const json = (await res.json()) as { rows?: number };
  console.log(`[pushAnalytics] отправлено ${metrics.length} метрик из ${snapshots.length} снапшотов (записано: ${json.rows ?? '?'})`);
};

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[pushAnalytics] ошибка:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
