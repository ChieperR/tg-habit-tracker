/**
 * Отправляет ОБЕЗЛИЧЕННОЕ сырьё аналитики на дашборд (сырьё-модель).
 *
 * Вместо готовых метрик шлём «сырые» данные с хешированными ID — дашборд сам
 * считает любые метрики (новые добавляются на стороне дашборда, sender не
 * трогаем). Наружу уходят: хеш(uid) + даты активности + флаги. Без имён,
 * username, реальных TG ID, названий привычек.
 *
 * Что шлём:
 *  - users:    [{uid_hash, created (дата рег. в TZ юзера), reminders}]
 *  - userDays: [{uid_hash, date, checkins}] — completed чек-ины по дням
 *  - habitDaily: [{date, avgStreak, activeHabits, totalHabits}] из снапшотов
 *
 * Запуск (cron):
 *   DASHBOARD_URL=... DASHBOARD_INGEST_TOKEN=... DASHBOARD_HASH_SALT=... \
 *     tsx src/scripts/pushRaw.ts
 *
 * @module scripts/pushRaw
 */
import { createHash } from 'node:crypto';
import { prisma } from '../db/index.js';

const PROJECT = 'tg-habit-tracker';
const URL = process.env.DASHBOARD_URL;
const TOKEN = process.env.DASHBOARD_INGEST_TOKEN;
const SALT = process.env.DASHBOARD_HASH_SALT;
const BOT_TZ_MIN = 180;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const ymdInTz = (d: Date, offsetMin: number): string =>
  ymd(new Date(d.getTime() + offsetMin * 60000));

/** Необратимый хеш TG-id с солью (96 бит — достаточно против коллизий). */
const hashUid = (id: number): string =>
  createHash('sha256').update(`${SALT}:${id}`).digest('hex').slice(0, 24);

const main = async (): Promise<void> => {
  if (!URL || !TOKEN || !SALT) {
    console.error('[pushRaw] нужны env DASHBOARD_URL, DASHBOARD_INGEST_TOKEN, DASHBOARD_HASH_SALT');
    process.exit(1);
  }

  // ── users ──────────────────────────────────────────────────────────────
  const users = await prisma.user.findMany({
    select: {
      id: true,
      createdAt: true,
      timezoneOffset: true,
      morningEnabled: true,
      eveningEnabled: true,
      habits: { where: { isActive: true }, select: { reminderTime: true } },
    },
  });
  const usersPayload = users.map((u) => ({
    uid_hash: hashUid(u.id),
    created: ymdInTz(u.createdAt, u.timezoneOffset ?? BOT_TZ_MIN),
    reminders:
      u.morningEnabled || u.eveningEnabled || u.habits.some((h) => h.reminderTime !== null),
  }));

  // ── userDays (completed чек-ины по дням) ─────────────────────────────────
  const logs = await prisma.habitLog.findMany({
    where: { completed: true },
    select: { date: true, habit: { select: { userId: true } } },
  });
  const counter = new Map<string, number>(); // `${userId}|${date}` → count
  for (const l of logs) {
    const k = `${l.habit.userId}|${l.date}`;
    counter.set(k, (counter.get(k) ?? 0) + 1);
  }
  const userDays = [...counter.entries()].map(([k, checkins]) => {
    const sep = k.indexOf('|');
    const uid = Number(k.slice(0, sep));
    const date = k.slice(sep + 1);
    return { uid_hash: hashUid(uid), date, checkins };
  });

  // ── habit-агрегаты из снапшотов (не на уровне юзера) ─────────────────────
  const snaps = await prisma.dailySnapshot.findMany({
    orderBy: { date: 'asc' },
    select: { date: true, avgStreak: true, activeHabits: true, totalHabits: true },
  });
  const habitDaily = snaps.map((s) => ({
    date: s.date,
    avgStreak: s.avgStreak,
    activeHabits: s.activeHabits,
    totalHabits: s.totalHabits,
  }));

  const res = await fetch(`${URL.replace(/\/$/, '')}/ingest-raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ project: PROJECT, users: usersPayload, userDays, habitDaily }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    console.error(`[pushRaw] дашборд ответил ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const json = (await res.json()) as { aggregated?: number };
  console.log(
    `[pushRaw] users=${usersPayload.length} userDays=${userDays.length} habitDaily=${habitDaily.length} → агрегировано метрик: ${json.aggregated ?? '?'}`,
  );
};

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[pushRaw] ошибка:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
