/**
 * Точка входа. Запускается из GitHub Actions по расписанию (раз в день).
 *
 * Использование:
 *   node src/index.js            — запускает обе задачи (перенос + OKR)
 *   node src/index.js move-old   — только перенос старых завершённых задач
 *   node src/index.js okr        — только запись OKR-статистики
 *
 * "Сегодня" вычисляется в часовом поясе TIMEZONE (по умолчанию UTC),
 * который в GitHub Actions задаётся через env TZ.
 */

import { readConfig, createSheetsClient } from './sheets.js';
import { moveOldCompletedTasks, logDailyOkrCompliance } from './jobs.js';

async function main() {
  const which = process.argv[2] || 'all';
  const { credentials, spreadsheetId, timeZone } = readConfig();
  const sheets = await createSheetsClient(credentials);
  const now = new Date();

  console.log(`Старт (${which}). Часовой пояс: ${timeZone}. Сейчас: ${now.toISOString()}.`);

  if (which === 'all' || which === 'move-old') {
    await moveOldCompletedTasks(sheets, spreadsheetId, now);
  }
  if (which === 'all' || which === 'okr') {
    await logDailyOkrCompliance(sheets, spreadsheetId, now);
  }

  console.log('Готово.');
}

main().catch((err) => {
  console.error('Ошибка выполнения:', err.message);
  if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
