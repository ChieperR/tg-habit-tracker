/**
 * Отправляет ОБЕЗЛИЧЕННОЕ сырьё аналитики на дашборд (сырьё-модель).
 *
 * Вместо готовых метрик шлём «сырые» данные с хешированными ID — дашборд сам
 * считает любые метрики (новые добавляются на стороне дашборда, sender не
 * трогаем). Наружу уходят: хеш(uid) + даты активности + флаги. Без имён,
 * username, реальных TG ID, названий привычек.
 *
 * Что шлём:
 *  - users:    [{uid_hash, created, tz, morning, evening, habitReminders}]
 *  - userDays: [{uid_hash, date, checkins}] — completed чек-ины по дням
 *  - habitDaily: [{date, avgStreak, activeHabits, totalHabits}] из снапшотов
 *
 * 🔴 Контракт: это ПОЛНЫЙ СНИМОК текущего состояния, не дельта. Каждый запуск
 * шлёт всех живых юзеров целиком. Семантика на дашборде — UPSERT по uid_hash:
 * существующие обновляются, новые добавляются. Удалённый из БД бота юзер
 * (CASCADE при prisma.user.delete) просто перестаёт приходить — на дашборде
 * остаётся как «призрак» (не удаляется автоматически). Для текущего масштаба
 * это ок; если понадобится точный отток — дашборд должен помечать
 * отсутствующих в снимке. Прошлый агрегатный sender считал totalUsers
 * кумулятивно (только рос) — здесь totalUsers = размер текущего снимка.
 *
 * ⚠️ Обезличенность держится на СЕКРЕТНОСТИ соли. hashUid = sha256(salt:id)
 * дёшев: при утечке соли весь диапазон id (1..N) перебирается за секунды и
 * mapping uid_hash → internal_id восстанавливается. internal_id ≠ telegramId
 * (его знает только БД бота), но при одновременной утечке дампа БД
 * анонимизация снимается полностью. Соль лежит только на сервере бота
 * (.dashboard-push.env, chmod 600). Для реальной необратимости понадобился бы
 * per-user pepper / scrypt и хранение соли вне бота — избыточно для масштаба.
 *
 * Запуск (cron):
 *   DASHBOARD_URL=... DASHBOARD_INGEST_TOKEN=... DASHBOARD_HASH_SALT=... \
 *     tsx src/scripts/pushRaw.ts
 *
 * @module scripts/pushRaw
 */
import { createHash } from 'node:crypto';
import { prisma } from '../db/index.js';
import { DEFAULT_TIMEZONE_OFFSET } from '../utils/date.js';

const PROJECT = 'tg-habit-tracker';
const URL = process.env.DASHBOARD_URL;
const TOKEN = process.env.DASHBOARD_INGEST_TOKEN;
const SALT = process.env.DASHBOARD_HASH_SALT;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const ymdInTz = (d: Date, offsetMin: number): string =>
  ymd(new Date(d.getTime() + offsetMin * 60000));

/** Хеш TG-id с солью (96 бит против коллизий). Обратимость — см. дисклеймер
 * в шапке модуля: защита держится на секретности соли. */
const hashUid = (id: number): string =>
  createHash('sha256').update(`${SALT}:${id}`).digest('hex').slice(0, 24);

const main = async (): Promise<void> => {
  if (!URL || !TOKEN || !SALT) {
    console.error('[pushRaw] нужны env DASHBOARD_URL, DASHBOARD_INGEST_TOKEN, DASHBOARD_HASH_SALT');
    process.exit(1);
  }

  // ── users ──────────────────────────────────────────────────────────────
  // TODO(scale): full findMany всех юзеров + их habits в память. На 160 ок,
  // на 50k+ — курсорная пагинация / дельта по updatedAt.
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
  const usersPayload = users.map((u) => {
    const tz = u.timezoneOffset ?? DEFAULT_TIMEZONE_OFFSET;
    return {
      uid_hash: hashUid(u.id),
      created: ymdInTz(u.createdAt, tz),
      // Разворачиваем по типам (не один грубый boolean): дашборд сам считает
      // «ожидается утренних/вечерних/по привычкам» и любые сегменты по типам.
      tz,
      morning: u.morningEnabled,
      evening: u.eveningEnabled,
      habitReminders: u.habits.filter((h) => h.reminderTime !== null).length,
    };
  });

  // ── userDays (completed чек-ины по дням) ─────────────────────────────────
  // Берём только completed=true: единица активности на дашборде = выполненная
  // привычка. Дни, где юзер ставил и снимал галку (markedAt есть, completed
  // стал false), сюда не попадают — это осознанный выбор «считаем выполнения».
  // TODO(scale): findMany всех логов за всё время; на 1M строк — пагинация.
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
  .catch((err) => {
    console.error('[pushRaw] ошибка:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
