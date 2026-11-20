/**
 * Разовое выравнивание `HabitLog.count` после появления нескольких отметок в
 * день: колонка добавляется со значением 1, а у снятых отметок
 * (`completed = false`) отметок за день ноль. Повторный запуск ничего не меняет
 * и частичные отметки дня не трогает.
 *
 * Запускать при остановленном боте, до старта новой версии:
 * `node dist/scripts/backfillHabitLogCount.js [--dry-run]`
 *
 * @module scripts/backfillHabitLogCount
 */
import { prisma } from '../db/index.js';

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');
  // Только след старой версии: снятая отметка получила count = 1 при target = 1.
  // У новой версии такой комбинации не бывает (count >= target — выполнено),
  // поэтому частичные отметки вида 1/2 повторный запуск не трогает.
  const where = { completed: false, target: 1, count: 1 };
  const total = await prisma.habitLog.count({ where });
  if (!dryRun) await prisma.habitLog.updateMany({ where, data: { count: 0 } });
  console.log(`${dryRun ? '[dry-run] ' : ''}снятых отметок старой версии с count = 1: ${total}${dryRun ? '' : ' — исправлено'}`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
