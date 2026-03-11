/**
 * Список обновлений бота
 * @module changelog
 */

export type ChangelogEntry = {
  id: number;
  date: string;
  text: string;
};

/**
 * Все обновления бота.
 * ⚠️ Тексты отображаются с parse_mode: 'Markdown' — избегай спецсимволов: * _ ` [ ]
 */
export const CHANGELOG: ChangelogEntry[] = [
  { id: 1, date: '2026-02-21', text: '📊 Статистика — добавлены норм стрики (текущий + лучший) + процент выполнения за месяц. Наглядно видно прогресс по красивым зелёненьким квадратикам' },
  { id: 2, date: '2026-02-21', text: '📅 Недельный календарь — сетка привычек по дням, листаешь недели смотришь свои успехи' },
  { id: 3, date: '2026-02-21', text: '🌍 Часовой пояс по гео — Раньше уведомления не отправлялись если не задан часовой пояс, поэтому некоторые из вас могли недавно внезапно получить уведомление) Сейчас по дефолту стоит +3 МСК. Поставить свой часовой пояс можно в настройках, просто отправив ГЕО боту, он сам определит таймзону' },
  { id: 4, date: '2026-02-25', text: '📝 Отметки за прошлые дни — забыл отметить вчера? Теперь можно проставить задним числом через недельный календарь в «Моих привычках»' },
  { id: 5, date: '2026-03-03', text: '🔔 Вечернее напоминание пофикшено — кнопки чеклиста больше не кидают в полный список привычек, всё остаётся компактным' },
  { id: 6, date: '2026-03-05', text: '⏰ Персональные напоминания — Если кому-то нужно напомнить сходить в качалку в 17:22 в среду, теперь ботик это умеет' },
  { id: 7, date: '2026-03-05', text: '📋 Как вы уже поняли, в боте появился /changelog. Теперь не пропустите новые фичи!' },
];

/** ID последней записи в changelog */
export const LATEST_CHANGELOG_ID = CHANGELOG[CHANGELOG.length - 1]!.id;

/**
 * Возвращает баннер об обновлении бота, если есть новые записи и они свежие (до 3 дней).
 * @param user - Объект с полем lastSeenChangelog
 * @param timezoneOffset - Смещение часового пояса в минутах (по умолчанию 180 = UTC+3)
 * @returns Строка с баннером или null
 */
export const getChangelogBanner = (user: { lastSeenChangelog: number }, timezoneOffset: number = 180): string | null => {
  if (user.lastSeenChangelog >= LATEST_CHANGELOG_ID) {
    return null;
  }

  const latestEntry = CHANGELOG.find((e) => e.id === LATEST_CHANGELOG_ID);
  if (!latestEntry) {
    return null;
  }

  // Сравниваем строки дат в таймзоне пользователя (консистентно с utils/date.ts)
  const nowUtcMs = Date.now() + timezoneOffset * 60000;
  const todayStr = new Date(nowUtcMs).toISOString().slice(0, 10);
  const entryDate = latestEntry.date; // YYYY-MM-DD
  const diffMs = new Date(todayStr).getTime() - new Date(entryDate).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > 3) {
    return null;
  }

  return '\n\n⚡️ Бот обновился! Кликай → /changelog';
};
