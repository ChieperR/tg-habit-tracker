/**
 * Отправляет аналитику бота на внешний админ-дашборд (push-модель).
 *
 * Бот деплоится на отдельном сервере; этот скрипт читает локальную БД и
 * POST'ит агрегаты на webhook дашборда. Идемпотентно (дашборд делает upsert
 * по project+date+metric), можно гонять как угодно часто.
 *
 * Две части данных:
 *  1) РЕКОНСТРУКЦИЯ по дням из сырых логов за ВСЮ историю бота:
 *     dau, checkins, newUsers, totalUsers (накопительно), mau.
 *     Снапшоты этого вглубь не покрывают — их завели недавно.
 *  2) Из DailySnapshot — метрики, которые исторически не пересчитать
 *     (avgStreak, activeHabits, totalHabits): берём как есть, по дням снапшотов.
 *
 * Наружу уходят ТОЛЬКО агрегаты (числа). Сырых пользовательских данных нет.
 *
 * Запуск (cron, напр. после ежедневного снапшота):
 *   DASHBOARD_URL=https://... DASHBOARD_INGEST_TOKEN=... tsx src/scripts/pushAnalytics.ts
 *
 * @module scripts/pushAnalytics
 */
import { prisma } from '../db/index.js';
import { calculateWindowRetention } from '../services/analytics/retention.js';
import { getUserSegments } from '../services/analytics/segmentation.js';

const PROJECT = 'tg-habit-tracker';
const URL = process.env.DASHBOARD_URL;
const TOKEN = process.env.DASHBOARD_INGEST_TOKEN;

type MetricRow = { date: string; metric: string; value: number };

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
/** Дефолтный TZ бота (utils/date DEFAULT_TIMEZONE_OFFSET) для юзеров без своего offset. */
const BOT_TZ_MIN = 180;
/**
 * Дата в часовом поясе юзера: createdAt (UTC) сдвигаем на offset, чтобы границы
 * суток совпадали с HabitLog.date (он пишется в TZ юзера через getTodayDate).
 * Иначе регистрации ночью смещались бы на предыдущий день относительно чек-инов.
 */
const ymdInTz = (d: Date, offsetMin: number): string =>
  ymd(new Date(d.getTime() + offsetMin * 60000));
const addDays = (date: string, n: number): string => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};

/** Реконструирует дневную историю из сырых логов и регистраций. */
const reconstructFromRaw = async (): Promise<MetricRow[]> => {
  const [logs, users] = await Promise.all([
    prisma.habitLog.findMany({
      where: { completed: true },
      select: { date: true, habit: { select: { userId: true } } },
    }),
    prisma.user.findMany({ select: { createdAt: true, timezoneOffset: true } }),
  ]);

  if (logs.length === 0 && users.length === 0) return [];

  // Активные юзеры и чек-ины по дням.
  const dauByDate = new Map<string, Set<number>>();
  const checkinsByDate = new Map<string, number>();
  for (const l of logs) {
    const uid = l.habit.userId;
    if (!dauByDate.has(l.date)) dauByDate.set(l.date, new Set());
    dauByDate.get(l.date)!.add(uid);
    checkinsByDate.set(l.date, (checkinsByDate.get(l.date) ?? 0) + 1);
  }

  // Регистрации по дням.
  const signupsByDate = new Map<string, number>();
  for (const u of users) {
    const d = ymdInTz(u.createdAt, u.timezoneOffset ?? BOT_TZ_MIN);
    signupsByDate.set(d, (signupsByDate.get(d) ?? 0) + 1);
  }

  // Диапазон: от самой ранней даты (лог или регистрация) до сегодня.
  const allDates = [...dauByDate.keys(), ...signupsByDate.keys()];
  if (allDates.length === 0) return [];
  let start = allDates[0]!;
  for (const d of allDates) if (d < start) start = d;
  const end = ymdInTz(new Date(), BOT_TZ_MIN);

  const rows: MetricRow[] = [];
  let cumulativeUsers = 0;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const dau = dauByDate.get(date)?.size ?? 0;
    const checkins = checkinsByDate.get(date) ?? 0;
    const newUsers = signupsByDate.get(date) ?? 0;
    cumulativeUsers += newUsers;

    // WAU/MAU — уникальные активные за trailing 7 / 30 дней (один проход).
    // Для первых ~7/30 дней жизни бота занижены (истории слева нет) — на графике
    // растут с нуля. Это ожидаемо, не баг: честный rolling виден с 7-го/30-го дня.
    const wau = new Set<number>();
    const mau = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const set = dauByDate.get(addDays(date, -i));
      if (set) for (const u of set) {
        mau.add(u);
        if (i < 7) wau.add(u);
      }
    }

    rows.push(
      { date, metric: 'dau', value: dau },
      { date, metric: 'totalCheckins', value: checkins },
      { date, metric: 'newUsers', value: newUsers },
      { date, metric: 'totalUsers', value: cumulativeUsers },
      { date, metric: 'wau', value: wau.size },
      { date, metric: 'mau', value: mau.size },
    );
  }
  return rows;
};

/** Метрики, которые исторически не пересчитать — берём из снапшотов. */
const fromSnapshots = async (): Promise<MetricRow[]> => {
  const snaps = await prisma.dailySnapshot.findMany({
    orderBy: { date: 'asc' },
    select: { date: true, avgStreak: true, activeHabits: true, totalHabits: true },
  });
  const rows: MetricRow[] = [];
  for (const s of snaps) {
    rows.push(
      { date: s.date, metric: 'avgStreak', value: s.avgStreak },
      { date: s.date, metric: 'activeHabits', value: s.activeHabits },
      { date: s.date, metric: 'totalHabits', value: s.totalHabits },
    );
  }
  return rows;
};

/**
 * Текущие retention (D7/D30) и сегментация юзеров — point-in-time, считаются на
 * «сейчас». Исторически не реконструируются, поэтому пишутся на сегодняшнюю
 * дату; daily-cron со временем строит из них ряд.
 */
const currentSnapshot = async (): Promise<MetricRow[]> => {
  const today = ymdInTz(new Date(), BOT_TZ_MIN);
  const [d7, d30, seg] = await Promise.all([
    calculateWindowRetention(7),
    calculateWindowRetention(30),
    getUserSegments(),
  ]);
  return [
    { date: today, metric: 'retention_d7', value: d7.percent },
    { date: today, metric: 'retention_d30', value: d30.percent },
    { date: today, metric: 'seg_power', value: seg.power },
    { date: today, metric: 'seg_active', value: seg.active },
    { date: today, metric: 'seg_dormant', value: seg.dormant },
    { date: today, metric: 'seg_churned', value: seg.churned },
    { date: today, metric: 'seg_zombie', value: seg.zombie },
  ];
};

const main = async (): Promise<void> => {
  if (!URL || !TOKEN) {
    console.error('[pushAnalytics] нужны env DASHBOARD_URL и DASHBOARD_INGEST_TOKEN');
    process.exit(1);
  }

  const [raw, snap, current] = await Promise.all([
    reconstructFromRaw(),
    fromSnapshots(),
    currentSnapshot(),
  ]);
  const metrics = [...raw, ...snap, ...current];

  if (metrics.length === 0) {
    console.log('[pushAnalytics] нет данных для отправки');
    return;
  }

  const res = await fetch(`${URL.replace(/\/$/, '')}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ project: PROJECT, metrics }),
    // Чтобы скрипт не завис на час при лагающем дашборде и cron'ы не наложились.
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[pushAnalytics] дашборд ответил ${res.status}: ${text}`);
    process.exit(1);
  }
  const json = (await res.json()) as { rows?: number };
  console.log(
    `[pushAnalytics] отправлено ${metrics.length} метрик (raw: ${raw.length}, snapshot: ${snap.length}; записано: ${json.rows ?? '?'})`,
  );
};

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[pushAnalytics] ошибка:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
