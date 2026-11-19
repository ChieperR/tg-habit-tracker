/**
 * Разовый перенос персональных напоминаний из `Habit.reminderTime` в таблицу
 * `HabitReminder`. Переносит только активные привычки; `lastHabitReminderDate`
 * становится `lastSentDate`, чтобы сегодняшнее напоминание не пришло второй раз.
 *
 * Привычка, у которой в `HabitReminder` уже есть это время, пропускается —
 * повторный запуск ничего не меняет.
 *
 * Запуск: `node dist/scripts/backfillHabitReminders.js [--dry-run]`
 *
 * @module scripts/backfillHabitReminders
 */
import { prisma } from '../db/index.js';

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');

  const habits = await prisma.habit.findMany({
    where: { isActive: true, reminderTime: { not: null } },
    select: {
      id: true,
      reminderTime: true,
      lastHabitReminderDate: true,
      reminders: { select: { time: true } },
    },
  });

  const toCreate = habits.filter(
    (h) => h.reminderTime !== null && !h.reminders.some((r) => r.time === h.reminderTime)
  );

  if (!dryRun) {
    for (const h of toCreate) {
      await prisma.habitReminder.create({
        data: { habitId: h.id, time: h.reminderTime!, lastSentDate: h.lastHabitReminderDate },
      });
    }
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}активных привычек с reminderTime: ${habits.length}, ` +
      `перенести: ${toCreate.length}${dryRun ? '' : ' — перенесено'}`
  );
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
