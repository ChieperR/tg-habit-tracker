import { InlineKeyboard } from 'grammy';
import { BotContext } from '../../types/index.js';
import { ADMIN_TELEGRAM_ID } from '../../config.js';
import { getAnalytics, AnalyticsPeriod } from '../../services/analyticsService.js';
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
 */
const formatAnalyticsMessage = (data: Awaited<ReturnType<typeof getAnalytics>>): string => {
  const periodLabel =
    data.period === '7d'
      ? '7 дней'
      : data.period === '30d'
        ? '30 дней'
        : data.period === '90d'
          ? '90 дней'
          : 'Всё время';

  const growthLine = formatGrowth(data.newUsers, data.prevNewUsers);

  const sourcesLine =
    data.topSources.length > 0
      ? data.topSources.map(([src, cnt]) => `  • \`${src}\`: ${cnt}`).join('\n')
      : '  _нет данных_';

  return [
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
    `🔄 *Retention*`,
    `• D7: *${data.retentionD7}%*`,
    `• D30: *${data.retentionD30}%*`,
    ``,
    `🌐 *Топ источников*`,
    sourcesLine,
  ].join('\n');
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

/**
 * Обработчик команды /analytics
 * Доступна только администратору (ADMIN_TELEGRAM_ID)
 * @param ctx - Контекст бота
 */
export const handleAnalytics = async (ctx: BotContext): Promise<void> => {
  const fromId = ctx.from?.id;

  if (!fromId || fromId !== ADMIN_TELEGRAM_ID) {
    // Silently ignore — не раскрываем существование команды
    return;
  }

  try {
    const data = await getAnalytics('7d');
    const message = formatAnalyticsMessage(data);
    const keyboard = buildPeriodKeyboard('7d');

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error('[analytics] Ошибка получения аналитики:', err);
    await ctx.reply('❌ Не удалось получить аналитику');
  }
};
