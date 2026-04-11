import { BotContext } from '../../types/index.js';
import { ADMIN_TELEGRAM_ID } from '../../config.js';
import { getActivationFunnel, getHabitHealthMetrics, getReminderEffectiveness, getStreakBreaks } from '../../services/analyticsService.js';

/**
 * Обработчик команды /funnel — воронка активации + метрики привычек (только для администратора)
 */
export const handleFunnel = async (ctx: BotContext): Promise<void> => {
  const fromId = ctx.from?.id;

  if (!fromId || fromId !== ADMIN_TELEGRAM_ID) {
    return;
  }

  try {
    const [funnel, habitHealth, reminderEff, streakBreaks] = await Promise.all([
      getActivationFunnel(),
      getHabitHealthMetrics(),
      getReminderEffectiveness(),
      getStreakBreaks(),
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

    // Reminder effectiveness
    message += '\n📬 *Эффективность напоминаний* _(30д)_\n';
    if (reminderEff.length === 0) {
      message += '_нет данных_\n';
    } else {
      for (const r of reminderEff) {
        const label = r.type === 'morning' ? '🌅 Утро' : r.type === 'evening' ? '🌙 Вечер' : r.type === 'habit' ? '⏰ Персональные' : r.type;
        message += `• ${label}: *${r.followedByCheckin}*/${r.sent} (*${r.conversionPercent}%*)\n`;
      }
    }

    // Streak breaks
    message += '\n🔥 *Потеря стриков*\n';
    const retPct = (ret: number, total: number) => total > 0 ? Math.round((ret / total) * 100) : 0;
    message += `• Стрик 3+д потеряли: *${streakBreaks.broke3plus}* чел`;
    message += streakBreaks.broke3plus > 0 ? ` (вернулись: *${retPct(streakBreaks.returned3plus, streakBreaks.broke3plus)}%*)\n` : '\n';
    message += `• Стрик 7+д потеряли: *${streakBreaks.broke7plus}* чел`;
    message += streakBreaks.broke7plus > 0 ? ` (вернулись: *${retPct(streakBreaks.returned7plus, streakBreaks.broke7plus)}%*)\n` : '\n';
    message += `• Стрик 14+д потеряли: *${streakBreaks.broke14plus}* чел`;
    message += streakBreaks.broke14plus > 0 ? ` (вернулись: *${retPct(streakBreaks.returned14plus, streakBreaks.broke14plus)}%*)\n` : '\n';

    // Telegram лимит — 4096 символов. Разбиваем если нужно
    if (message.length <= 4096) {
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } else {
      const sections = message.split('\n\n');
      let chunk = '';
      for (const section of sections) {
        if (chunk.length + section.length + 2 > 4096) {
          if (chunk) await ctx.reply(chunk, { parse_mode: 'Markdown' });
          chunk = section;
        } else {
          chunk += (chunk ? '\n\n' : '') + section;
        }
      }
      if (chunk) await ctx.reply(chunk, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    console.error('[funnel] Ошибка:', err);
    await ctx.reply('❌ Не удалось получить воронку');
  }
};
