import { InlineKeyboard } from 'grammy';
import { BotContext } from '../../types/index.js';
import { ADMIN_TELEGRAM_ID } from '../../config.js';
import { getAnalytics, getAnalyticsForRange, AnalyticsPeriod } from '../../services/analyticsService.js';
import { serializeCallback } from '../../utils/callback.js';
import { safeEditMessage } from '../../utils/telegram.js';

/**
 * Команда /analytics — аналитика бота (только для администратора)
 * @module bot/commands/analytics
 */

/**
 * Строит inline-клавиатуру выбора периода аналитики
 * @param current - Текущий выбранный период
 * @returns Inline-клавиатура
 */
const buildPeriodKeyboard = (current: AnalyticsPeriod): InlineKeyboard => {
  const periods: { label: string; period: AnalyticsPeriod }[] = [
    { label: '7 дней', period: '7d' },
    { label: '30 дней', period: '30d' },
    { label: '90 дней', period: '90d' },
    { label: 'Всё время', period: 'all' },
  ];

  const kb = new InlineKeyboard();
  for (const { label, period } of periods) {
    const text = period === current ? `• ${label} •` : label;
    kb.text(text, serializeCallback({ type: 'analytics', period }));
  }
  return kb;
};

/**
 * Форматирует рост пользователей относительно предыдущего периода
 */
const formatGrowth = (current: number, prev: number): string => {
  if (prev === 0) return current > 0 ? `+${current}` : '—';
  const diff = current - prev;
  const pct = Math.round((diff / prev) * 100);
  if (diff > 0) return `+${diff} (+${pct}%)`;
  if (diff < 0) return `${diff} (${pct}%)`;
  return '0 (0%)';
};

/**
 * Форматирует данные аналитики в сообщение Telegram (Markdown)
 * @param customLabel - Кастомный лейбл периода (для произвольных дат)
 */
const formatAnalyticsMessage = (data: Awaited<ReturnType<typeof getAnalytics>>, customLabel?: string): string => {
  const periodLabel = customLabel ??
    (data.period === '7d'
      ? '7 дней'
      : data.period === '30d'
        ? '30 дней'
        : data.period === '90d'
          ? '90 дней'
          : 'Всё время');

  const growthLine = formatGrowth(data.newUsers, data.prevNewUsers);

  const sourcesLine =
    data.topSources.length > 0
      ? data.topSources.map(([src, cnt]) => `  • \`${src}\`: ${cnt}`).join('\n')
      : '  _нет данных_';

  const lines = [
    `📊 *Аналитика* — ${periodLabel}`,
    ``,
    `👥 *Пользователи*`,
    `• Всего: *${data.totalUsers}*`,
    `• Новых за период: *${data.newUsers}* (${growthLine} vs предыдущий период)`,
    ``,
    `📈 *Активность*`,
    `• DAU среднее: *${data.dauAvg}*`,
    `• MAU (последний): *${data.mau}*`,
    `• Check-in'ов за период: *${data.totalCheckins}*`,
    ``,
    `🔄 *Retention* _(window-based)_`,
    `• D7: *${data.retentionD7}%*`,
    `• D30: *${data.retentionD30}%*`,
  ];

  if (data.segments) {
    const s = data.segments;
    lines.push(
      ``,
      `🎯 *Сегментация*`,
      `• Power (5+/7д): *${s.power}*`,
      `• Active (1-4/7д): *${s.active}*`,
      `• Dormant (8-30д): *${s.dormant}*`,
      `• Churned (30д+): *${s.churned}*`,
      `• Zombie: *${s.zombie}*`,
    );
  }

  lines.push(``, `🌐 *Топ источников*`, sourcesLine);

  return lines.join('\n');
};

/**
 * Показывает аналитику за указанный период.
 * Используется как обработчик команды /analytics и callback 'analytics'.
 * @param ctx - Контекст бота
 * @param period - Период аналитики
 */
export const showAnalytics = async (ctx: BotContext, period: AnalyticsPeriod = '7d'): Promise<void> => {
  const data = await getAnalytics(period);
  const message = formatAnalyticsMessage(data);
  const keyboard = buildPeriodKeyboard(period);

  await safeEditMessage(ctx, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
};

/** Паттерн даты ДД.ММ.ГГГГ */
const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;

/**
 * Конвертирует ДД.ММ.ГГГГ → YYYY-MM-DD
 */
const parseRuDate = (d: string): string => {
  const [day, month, year] = d.split('.');
  return `${year}-${month}-${day}`;
};

/**
 * Обработчик команды /analytics
 * Доступна только администратору (ADMIN_TELEGRAM_ID)
 *
 * Форматы:
 * - `/analytics` — стандартный вид (7 дней + кнопки)
 * - `/analytics 2026-02-01 2026-03-01` — произвольный период
 * @param ctx - Контекст бота
 */
export const handleAnalytics = async (ctx: BotContext): Promise<void> => {
  const fromId = ctx.from?.id;

  if (!fromId || fromId !== ADMIN_TELEGRAM_ID) {
    return;
  }

  try {
    const args = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    const parts = args.split(/\s+/).filter(Boolean);

    // Кастомный период: /analytics 2026-02-01 2026-03-01
    if (parts.length >= 2 && DATE_RE.test(parts[0]!) && DATE_RE.test(parts[1]!)) {
      const from = parseRuDate(parts[0]!);
      const to = parseRuDate(parts[1]!);

      if (from > to) {
        await ctx.reply('❌ Начальная дата должна быть раньше конечной\nФормат: `/analytics 01.02.2026 01.03.2026`', { parse_mode: 'Markdown' });
        return;
      }

      const data = await getAnalyticsForRange(from, to);
      const label = `${parts[0]} → ${parts[1]}`;
      const message = formatAnalyticsMessage(data, label);

      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    // Стандартный вид
    const data = await getAnalytics('7d');
    const message = formatAnalyticsMessage(data);
    const keyboard = buildPeriodKeyboard('7d');

    await ctx.reply(message + '\n\n_Свой период:_ `/analytics 01.02.2026 01.03.2026`', {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error('[analytics] Ошибка получения аналитики:', err);
    await ctx.reply('❌ Не удалось получить аналитику');
  }
};
