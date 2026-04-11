import { BotContext } from '../../types/index.js';
import { ADMIN_TELEGRAM_ID } from '../../config.js';
import { getActivationFunnel, getHabitHealthMetrics } from '../../services/analyticsService.js';

/**
 * Обработчик команды /funnel — воронка активации + метрики привычек (только для администратора)
 */
export const handleFunnel = async (ctx: BotContext): Promise<void> => {
  const fromId = ctx.from?.id;

  if (!fromId || fromId !== ADMIN_TELEGRAM_ID) {
    return;
  }

  try {
    const [funnel, habitHealth] = await Promise.all([
      getActivationFunnel(),
      getHabitHealthMetrics(),
    ]);

    // Воронка
    let message = '📊 *Воронка активации*\n\n';
    for (const step of funnel.steps) {
      const bar = '█'.repeat(Math.max(1, Math.round(step.percent / 5)));
      message += `${bar} *${step.percent}%* (${step.count})\n`;
      message += `  _${step.name}_\n`;
    }

    // Здоровье привычек
    message += '\n📋 *Здоровье привычек*\n';
    message += `• Активных: *${habitHealth.totalActive}*\n`;
    message += `• Живых (checkin за 7д): *${habitHealth.alive}*\n`;
    message += `• Мёртвых (нет checkin 7д+): *${habitHealth.dead}*\n`;
    message += `• Мертворождённых (0 checkin): *${habitHealth.stillborn}*\n`;
    message += `• Удалено всего: *${habitHealth.totalDeleted}*\n`;

    // Survival buckets
    message += '\n🏥 *Выживаемость привычек*\n';
    message += `• Умерли до 3 дней: *${habitHealth.survivalBuckets.diedBefore3d}*\n`;
    message += `• Умерли до 7 дней: *${habitHealth.survivalBuckets.diedBefore7d}*\n`;
    message += `• Прожили 7+ дней: *${habitHealth.survivalBuckets.survived7d}*\n`;
    message += `• Прожили 30+ дней: *${habitHealth.survivalBuckets.survived30d}*\n`;

    // По типам
    message += '\n📊 *По типам привычек*\n';
    for (const t of habitHealth.byType) {
      const label = t.type === 'daily' ? 'Daily' : t.type === 'interval' ? 'Interval' : 'Weekdays';
      message += `• ${label}: *${t.alive}*/${t.total} живых (*${t.alivePercent}%*)\n`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[funnel] Ошибка:', err);
    await ctx.reply('❌ Не удалось получить воронку');
  }
};
