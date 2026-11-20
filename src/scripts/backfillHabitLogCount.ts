/**
 * Разовое выравнивание `HabitLog.count` после появления нескольких отметок в
 * день: колонка добавляется со значением 1, а у снятых отметок
 * (`completed = false`) отметок за день ноль. Повторный запуск ничего не меняет.
 *
 * Запускать при остановленном боте, до старта новой версии:
 * `node dist/scripts/backfillHabitLogCount.js [--dry-run]`
 *
 * @module scripts/backfillHabitLogCount
 */
import { prisma } from '../db/index.js';

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');
  const where = { completed: false, count: { not: 0 } };
  const total = await prisma.habitLog.count({ where });
  if (!dryRun) await prisma.habitLog.updateMany({ where, data: { count: 0 } });
  console.log(`${dryRun ? '[dry-run] ' : ''}снятых отметок с count != 0: ${total}${dryRun ? '' : ' — исправлено'}`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
