/**
 * Отправляет на дашборд ПОЛНЫЙ ОБЕЗЛИЧЕННЫЙ ДАМП таблиц бота (сырьё-модель).
 *
 * Философия: дашборд держит анонимную копию БД и считает ЛЮБЫЕ метрики сам.
 * Sender ничего не агрегирует и не выбирает «нужные» поля — он шлёт таблицы
 * целиком, только обезличенные. Новая метрика на дашборде → правок здесь НЕ
 * требуется. (Раньше слались выбранные поля — это и было ошибкой.)
 *
 * Обезличивание:
 *  - все id хешируются солью консистентно: user.id → uid_hash, habit.id →
 *    hid_hash. Связи таблиц сохраняются (habit_logs ↔ habits ↔ users).
 *  - НЕ шлём: telegramId, name привычки, тексты фидбэка (таблицу фидбэка
 *    вообще не шлём), habitId внутри metadata событий — хешируется.
 *  - даты остаются как есть (UTC ISO); локальные вычисления (дата в TZ юзера
 *    и т.п.) делает дашборд из createdAt + timezoneOffset.
 *
 * 🔴 Контракт: ПОЛНЫЙ СНИМОК. Дашборд для каждой таблицы делает replace по
 * project (удалил старое, вставил присланное) — поэтому удалённые из Бота
 * строки исчезают и на дашборде (без «призраков»).
 *
 * ⚠️ Обезличенность держится на секретности соли (.dashboard-push.env, chmod
 * 600). hashId дёшев: при утечке соли диапазон id перебирается и mapping
 * восстановим; telegramId всё равно не уходит, но дисклеймер нужен.
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

/** Консистентный обезличивающий хеш id. kind разводит пространства (u/h),
 * но связи сохраняются: один и тот же (kind,id) всегда даёт один хеш. */
const hashId = (kind: 'u' | 'h', id: number): string =>
  createHash('sha256').update(`${SALT}:${kind}:${id}`).digest('hex').slice(0, 24);

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Анонимизирует habitId внутри JSON-metadata события (остальное — как есть). */
const anonMeta = (metadata: string | null): string | null => {
  if (!metadata) return metadata;
  try {
    const obj = JSON.parse(metadata);
    if (obj && typeof obj === 'object' && typeof obj.habitId === 'number') {
      obj.habitId = hashId('h', obj.habitId);
    }
    return JSON.stringify(obj);
  } catch {
    return null; // невалидный JSON — не рискуем утечкой, выкидываем
  }
};

const main = async (): Promise<void> => {
  if (!URL || !TOKEN || !SALT) {
    console.error('[pushRaw] нужны env DASHBOARD_URL, DASHBOARD_INGEST_TOKEN, DASHBOARD_HASH_SALT');
    process.exit(1);
  }

  // TODO(scale): всё грузится в память целиком. На 160 юзерах/десятках тысяч
  // логов ок; на сотнях тысяч строк — инкрементальная выгрузка по updatedAt /
  // курсорная пагинация + дельта-режим на дашборде.
  const [users, habits, habitLogs, analyticsEvents, achievementEvents, freezeUsages, dailySnapshots] =
    await Promise.all([
      prisma.user.findMany(),
      prisma.habit.findMany(),
      prisma.habitLog.findMany(),
      prisma.analyticsEvent.findMany(),
      prisma.achievementEvent.findMany(),
      prisma.freezeUsage.findMany(),
      prisma.dailySnapshot.findMany(),
    ]);

  // users — без telegramId
  const usersOut = users.map((u) => ({
    uid_hash: hashId('u', u.id),
    morningTime: u.morningTime,
    eveningTime: u.eveningTime,
    timezoneOffset: u.timezoneOffset,
    morningEnabled: u.morningEnabled,
    eveningEnabled: u.eveningEnabled,
    lastMorningReminderDate: u.lastMorningReminderDate,
    lastEveningReminderDate: u.lastEveningReminderDate,
    lastSeenChangelog: u.lastSeenChangelog,
    source: u.source,
    lastActiveAt: iso(u.lastActiveAt),
    lastFeedbackAt: iso(u.lastFeedbackAt),
    freezeCount: u.freezeCount,
    lastFreezeEarnStreakDay: u.lastFreezeEarnStreakDay,
    createdAt: iso(u.createdAt),
  }));

  // habits — без name
  const habitsOut = habits.map((h) => ({
    hid_hash: hashId('h', h.id),
    uid_hash: hashId('u', h.userId),
    emoji: h.emoji,
    frequencyType: h.frequencyType,
    frequencyDays: h.frequencyDays,
    weekdays: h.weekdays,
    reminderTime: h.reminderTime,
    lastHabitReminderDate: h.lastHabitReminderDate,
    isActive: h.isActive,
    createdAt: iso(h.createdAt),
  }));

  const habitLogsOut = habitLogs.map((l) => ({
    hid_hash: hashId('h', l.habitId),
    date: l.date,
    completed: l.completed,
    markedAt: iso(l.markedAt),
  }));

  const analyticsEventsOut = analyticsEvents.map((e) => ({
    uid_hash: hashId('u', e.userId),
    type: e.type,
    metadata: anonMeta(e.metadata),
    createdAt: iso(e.createdAt),
  }));

  const achievementEventsOut = achievementEvents.map((a) => ({
    uid_hash: hashId('u', a.userId),
    scope: a.scope,
    hid_hash: a.habitId !== null ? hashId('h', a.habitId) : null,
    milestone: a.milestone,
    achievedAt: iso(a.achievedAt),
  }));

  const freezeUsagesOut = freezeUsages.map((f) => ({
    uid_hash: hashId('u', f.userId),
    date: f.date,
    reason: f.reason,
    createdAt: iso(f.createdAt),
  }));

  const dailySnapshotsOut = dailySnapshots.map((s) => ({
    date: s.date,
    totalUsers: s.totalUsers,
    newUsers: s.newUsers,
    dau: s.dau,
    mau: s.mau,
    totalHabits: s.totalHabits,
    activeHabits: s.activeHabits,
    totalCheckins: s.totalCheckins,
    avgStreak: s.avgStreak,
  }));

  const payload = {
    project: PROJECT,
    tables: {
      users: usersOut,
      habits: habitsOut,
      habitLogs: habitLogsOut,
      analyticsEvents: analyticsEventsOut,
      achievementEvents: achievementEventsOut,
      freezeUsages: freezeUsagesOut,
      dailySnapshots: dailySnapshotsOut,
    },
  };

  const res = await fetch(`${URL.replace(/\/$/, '')}/ingest-raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    console.error(`[pushRaw] дашборд ответил ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const json = (await res.json()) as { aggregated?: number };
  console.log(
    `[pushRaw] users=${usersOut.length} habits=${habitsOut.length} logs=${habitLogsOut.length} ` +
      `events=${analyticsEventsOut.length} → метрик: ${json.aggregated ?? '?'}`,
  );
};

main()
  .catch((err) => {
    console.error('[pushRaw] ошибка:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
