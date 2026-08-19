/**
 * Ежедневные задачи Office Task Tracker — порт логики из Code.gs
 * (функции moveOldCompletedTasks и logDailyOkrCompliance) на Node.js.
 *
 * Столбцы таблицы (0-индексы):
 *   0=Received, 1=Task, 2=Priority, 3=Status, 4=Est time,
 *   5=Due date, 6=Start date, 7=Completed date, 8=Comments
 */

import {
  getSheetMeta,
  getValues,
  appendRow,
  deleteRows,
  ensureSheet,
} from './sheets.js';

const TASKS_SHEET = 'Tasks';
const COMPLETED_SHEET = 'Completed';
const OKR_SHEET = 'OKR Summary';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Помощники по датам (аналоги parseDateValue / stripTime из Code.gs)
// ---------------------------------------------------------------------------

/** Превращает значение ячейки в объект Date, либо null, если не распознать. */
export function parseDateValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Обрезает время, оставляя только календарный день (локальный). */
export function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Форматирует дату в "M/d/yyyy" (как Utilities.formatDate в оригинале). */
export function formatMDY(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

/** Форматирует дату в ISO "yyyy-MM-dd" — так Google Sheets надёжно распознаёт её как дату. */
export function formatISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// 1. Перенос старых завершённых задач из "Tasks" в "Completed"
//    (задачи со статусом Completed, у которых с Due date прошло > 7 дней)
// ---------------------------------------------------------------------------
export async function moveOldCompletedTasks(sheets, spreadsheetId, now = new Date()) {
  const meta = await getSheetMeta(sheets, spreadsheetId);
  if (!meta.has(TASKS_SHEET) || !meta.has(COMPLETED_SHEET)) {
    console.log(
      `[move-old] Пропуск: не найден лист "${TASKS_SHEET}" или "${COMPLETED_SHEET}".`
    );
    return { moved: 0 };
  }

  const data = await getValues(sheets, spreadsheetId, TASKS_SHEET);
  const rowsToMove = [];
  const indexesToDelete = [];

  // i начинается с 1 — пропускаем строку заголовка
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[3] ? row[3].toString().toLowerCase() : '';
    const dueDate = parseDateValue(row[5]);

    if (status.indexOf('completed') !== -1 && dueDate) {
      const diffDays = (now - dueDate) / MS_PER_DAY;
      if (diffDays > 7) {
        rowsToMove.push(row);
        indexesToDelete.push(i);
      }
    }
  }

  if (rowsToMove.length === 0) {
    console.log('[move-old] Нет задач для переноса.');
    return { moved: 0 };
  }

  // Сначала копируем в архив, потом удаляем из источника (снизу вверх).
  for (const row of rowsToMove) {
    await appendRow(sheets, spreadsheetId, COMPLETED_SHEET, row);
  }
  await deleteRows(sheets, spreadsheetId, meta.get(TASKS_SHEET), indexesToDelete);

  console.log(`[move-old] Перенесено задач: ${rowsToMove.length}.`);
  return { moved: rowsToMove.length };
}

// ---------------------------------------------------------------------------
// 2. Ежедневный расчёт % задач, выполненных в срок (по будням)
// ---------------------------------------------------------------------------
export async function logDailyOkrCompliance(sheets, spreadsheetId, now = new Date()) {
  const day = now.getDay(); // 0 = воскресенье, 6 = суббота
  if (day === 0 || day === 6) {
    console.log('[okr] Выходной — пропуск.');
    return { skipped: true };
  }

  const meta = await getSheetMeta(sheets, spreadsheetId);
  const sheetsToScan = [TASKS_SHEET, COMPLETED_SHEET].filter((name) => meta.has(name));

  let onTime = 0;
  let late = 0;
  const lateTasks = [];

  for (const name of sheetsToScan) {
    const data = await getValues(sheets, spreadsheetId, name);
    for (let i = 1; i < data.length; i++) {
      const status = data[i][3] ? data[i][3].toString().toLowerCase() : '';
      const dueDate = parseDateValue(data[i][5]);
      const completedDate = parseDateValue(data[i][7]);
      if (status.indexOf('completed') !== -1 && dueDate && completedDate) {
        if (stripTime(completedDate) <= stripTime(dueDate)) {
          onTime++;
        } else {
          late++;
          lateTasks.push(
            `${data[i][1]} (due ${formatMDY(dueDate)}, completed ${formatMDY(completedDate)})`
          );
        }
      }
    }
  }

  if (lateTasks.length > 0) {
    console.log('[okr] Late tasks:\n' + lateTasks.join('\n'));
  }

  const total = onTime + late;
  const percent = total > 0 ? Math.round((onTime / total) * 1000) / 10 : 0;

  // Создаём вкладку OKR Summary с заголовком, если её ещё нет.
  const okrExisted = meta.has(OKR_SHEET);
  await ensureSheet(sheets, spreadsheetId, OKR_SHEET);
  if (!okrExisted) {
    await appendRow(sheets, spreadsheetId, OKR_SHEET, [
      'Date',
      'Total completed',
      'On-time',
      'Late',
      '% on-time',
    ]);
  }

  await appendRow(sheets, spreadsheetId, OKR_SHEET, [
    formatISODate(now),
    total,
    onTime,
    late,
    percent + '%',
  ]);

  console.log(
    `[okr] Записано: total=${total}, on-time=${onTime}, late=${late}, ${percent}%.`
  );
  return { total, onTime, late, percent };
}
