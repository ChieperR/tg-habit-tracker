/**
 * **🚧 DEV-ONLY команда для тестирования streak/freeze/milestone фичи.**
 *
 * НЕ ВЛИВАТЬ В MAIN. Эта команда облегчает Эмину тестинг на DEV-боте
 * (@Sleek_HabitTrackerDEV_Bot). Полезна для:
 * - имитации длинного стрика без ожидания N дней
 * - имитации пропуска (delete вчерашних HabitLog'ов)
 * - инвентаризации freeze для теста auto-apply
 * - сброса всех тестовых данных в clean slate
 *
 * Гейтится через NODE_ENV / DEV env-переменную (так же как /daily).
 *
 * Subcommands:
 * - `/devstreak grow N` — backfill HabitLog'и для активных привычек на
 *   последние N дней (excluding today), completed=true. Так overall streak
 *   мгновенно становится N+1 (если сегодня тоже отметить хоть одну).
 * - `/devstreak break` — удаляет HabitLog для вчерашней даты (имитация
 *   пропуска вчера). Если в инвентаре freeze — авто-cron его потом спишет.
 * - `/devstreak break N` — удаляет HabitLog за последние N дней (имитация
 *   долгого пропуска).
 * - `/devstreak freeze N` — устанавливает freezeCount = N в User.
 * - `/devstreak earnreset` — сбрасывает lastFreezeEarnStreakDay в 0
 *   (чтобы можно было заработать freeze повторно при текущем стрике).
 * - `/devstreak status` — показывает текущее состояние (overall streak,
 *   freeze count, last achievements).
 * - `/devstreak wipe` — удаляет ВСЕ HabitLog, FreezeUsage, AchievementEvent,
 *   MessageSent юзера + freezeCount=0, lastFreezeEarnStreakDay=0.
 *   Clean slate для нового цикла теста.
 *
 * Все subcommands работают только для текущего юзера (по telegramId).
 *
 * @module bot/commands/devstreak
 */

import { BotContext } from '../../types/index.js';
import { prisma } from '../../db/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { getTodayDate, getPrevDate, DEFAULT_TIMEZONE_OFFSET } from '../../utils/date.js';
import {
  calculateOverallStreak,
  type StreakHabit,
  type StreakHabitLog,
  type StreakFreezeUsage,
} from '../../services/streak/calculator.js';
import { autoApplyFreezesForMissedDays } from '../../services/reminder/scheduler.js';

const HELP = `🛠 *DEV: имитация стрика*
\`/devstreak grow N\` — отмечает последние N дней как выполненные
\`/devstreak break [N]\` — удаляет N последних логов (N=1 если не указан)
\`/devstreak freeze N\` — устанавливает freezeCount = N
\`/devstreak earnreset\` — сбрасывает freeze-earn checkpoint
\`/devstreak freezecheck\` — вручную запускает freeze auto-apply cron (вместо ожидания каждого часа)
\`/devstreak status\` — текущее состояние стрика и freeze
\`/devstreak wipe\` — полный сброс тестовых данных`;

export const handleDevStreak = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await findOrCreateUser(telegramId);
  const timezoneOffset = user.timezoneOffset ?? DEFAULT_TIMEZONE_OFFSET;
  const todayDate = getTodayDate(timezoneOffset);

  const text = ctx.match;
  const args = typeof text === 'string' ? text.trim().split(/\s+/) : [];
  const cmd = args[0]?.toLowerCase() ?? '';
  const arg = args[1];

  if (!cmd) {
    await ctx.reply(HELP, { parse_mode: 'Markdown' });
    return;
  }

  switch (cmd) {
    case 'grow': {
      const days = parseInt(arg ?? '0', 10);
      if (!Number.isFinite(days) || days <= 0) {
        await ctx.reply('Использование: `/devstreak grow N` (N > 0)', { parse_mode: 'Markdown' });
        return;
      }
      const habits = await prisma.habit.findMany({
        where: { userId: user.id, isActive: true },
        select: { id: true },
      });
      let cursor = getPrevDate(todayDate);
      let total = 0;
      for (let i = 0; i < days; i++) {
        for (const h of habits) {
          await prisma.habitLog.upsert({
            where: { habitId_date: { habitId: h.id, date: cursor } },
            create: { habitId: h.id, date: cursor, completed: true },
            update: { completed: true },
          });
          total++;
        }
        cursor = getPrevDate(cursor);
      }
      await ctx.reply(
        `✅ Backfill: ${days} дней × ${habits.length} привычек = ${total} log'ов. Отметь хоть одну сегодня — overall streak станет ${days + 1}.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    case 'break': {
      const n = Math.max(1, parseInt(arg ?? '1', 10) || 1);
      let cursor = getPrevDate(todayDate);
      let deleted = 0;
      for (let i = 0; i < n; i++) {
        const res = await prisma.habitLog.deleteMany({
          where: { habit: { userId: user.id }, date: cursor },
        });
        deleted += res.count;
        cursor = getPrevDate(cursor);
      }
      await ctx.reply(
        `🗑 Удалено ${deleted} log'ов за последние ${n} дн. Если freeze есть в инвентаре, утренний cron его спишет за самый ранний пропущенный день.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    case 'freeze': {
      const count = parseInt(arg ?? '-1', 10);
      if (!Number.isFinite(count) || count < 0 || count > 99) {
        await ctx.reply('Использование: `/devstreak freeze N` (0..99)', { parse_mode: 'Markdown' });
        return;
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { freezeCount: count },
      });
      await ctx.reply(`🧊 freezeCount = ${count}`);
      return;
    }

    case 'earnreset': {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastFreezeEarnStreakDay: 0 },
      });
      await ctx.reply('🔄 lastFreezeEarnStreakDay = 0. Следующий 5-day milestone снова выдаст freeze.');
      return;
    }

    case 'freezecheck': {
      // Вручную дёргаем cron freeze-apply (обычно идёт раз в час).
      const before = await prisma.user.findUnique({
        where: { id: user.id },
        select: { freezeCount: true },
      });
      await autoApplyFreezesForMissedDays();
      const after = await prisma.user.findUnique({
        where: { id: user.id },
        select: { freezeCount: true, lastFreezeEarnStreakDay: true },
      });
      const lines = [
        '🧊 Freeze cron run завершён.',
        `freezeCount: ${before?.freezeCount ?? 0} → ${after?.freezeCount ?? 0}`,
        `lastFreezeEarnStreakDay: ${after?.lastFreezeEarnStreakDay ?? 0}`,
      ];
      await ctx.reply(lines.join('\n'));
      return;
    }

    case 'status': {
      const [habits, logs, freezes, freshUser, achievements] = await Promise.all([
        prisma.habit.findMany({ where: { userId: user.id } }),
        prisma.habitLog.findMany({
          where: { habit: { userId: user.id } },
          select: { habitId: true, date: true, completed: true },
        }),
        prisma.freezeUsage.findMany({ where: { userId: user.id }, select: { date: true } }),
        prisma.user.findUnique({
          where: { id: user.id },
          select: { freezeCount: true, lastFreezeEarnStreakDay: true },
        }),
        prisma.achievementEvent.findMany({
          where: { userId: user.id },
          orderBy: { achievedAt: 'desc' },
          take: 10,
        }),
      ]);
      const overallStreak = calculateOverallStreak(
        habits as StreakHabit[],
        logs as StreakHabitLog[],
        freezes as StreakFreezeUsage[],
        todayDate
      );
      const recent = achievements
        .map(
          (a) =>
            `  • ${a.scope}${a.habitId ? `#${a.habitId}` : ''} = ${a.milestone}d (${a.achievedAt.toISOString().slice(0, 10)})`
        )
        .join('\n');
      const message = [
        `🛠 *DEV status*`,
        `today: ${todayDate}`,
        `habits: ${habits.length} (active: ${habits.filter((h) => h.isActive).length})`,
        `logs: ${logs.length} | completed: ${logs.filter((l) => l.completed).length}`,
        `freezes used: ${freezes.length}`,
        `freezeCount: ${freshUser?.freezeCount ?? 0}/2`,
        `lastFreezeEarnStreakDay: ${freshUser?.lastFreezeEarnStreakDay ?? 0}`,
        `overall streak: ${overallStreak}`,
        ``,
        `Last achievements (${achievements.length}):`,
        recent || '  (none)',
      ].join('\n');
      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    case 'wipe': {
      await prisma.$transaction([
        prisma.habitLog.deleteMany({ where: { habit: { userId: user.id } } }),
        prisma.freezeUsage.deleteMany({ where: { userId: user.id } }),
        prisma.achievementEvent.deleteMany({ where: { userId: user.id } }),
        prisma.messageSent.deleteMany({ where: { userId: user.id } }),
        prisma.user.update({
          where: { id: user.id },
          data: { freezeCount: 0, lastFreezeEarnStreakDay: 0 },
        }),
      ]);
      await ctx.reply('🧹 Все тестовые данные стрика/freeze/achievement/messageSent удалены. Clean slate.');
      return;
    }

    default:
      await ctx.reply(HELP, { parse_mode: 'Markdown' });
      return;
  }
};
