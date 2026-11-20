/**
 * Разовый перенос персональных напоминаний из `Habit.reminderTime` в таблицу
 * `HabitReminder`, в том числе у удалённых привычек (для истории в выгрузке;
 * планировщик их не берёт). `lastHabitReminderDate` становится `lastSentDate`,
 * чтобы сегодняшнее напоминание не пришло второй раз.
 *
 * Привычка, у которой в `HabitReminder` уже есть хоть одно время, пропускается:
 * повторный запуск ничего не меняет и не возвращает время, которое юзер успел
 * убрать или перенести.
 *
 * Запускать при остановленном боте, до старта новой версии:
 * `node dist/scripts/backfillHabitReminders.js [--dry-run]`
 *
 * @module scripts/backfillHabitReminders
 */
import { prisma } from '../db/index.js';

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');

  const habits = await prisma.habit.findMany({
    where: { reminderTime: { not: null } },
    select: {
      id: true,
      reminderTime: true,
      lastHabitReminderDate: true,
      reminders: { select: { time: true } },
    },
  });

  const toCreate = habits.filter((h) => h.reminderTime !== null && h.reminders.length === 0);

  if (!dryRun) {
    for (const h of toCreate) {
      await prisma.habitReminder.upsert({
        where: { habitId_time: { habitId: h.id, time: h.reminderTime! } },
        create: { habitId: h.id, time: h.reminderTime!, lastSentDate: h.lastHabitReminderDate },
        update: {},
      });
    }
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}привычек с reminderTime: ${habits.length}, ` +
      `перенести: ${toCreate.length}${dryRun ? '' : ' — перенесено'}`
  );
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
