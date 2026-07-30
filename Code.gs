/**
 * Office Task Tracker — Automation Scripts
 * Столбцы таблицы: A=Received, B=Task, C=Priority, D=Status,
 *                  E=Est time, F=Due date, G=Start date,
 *                  H=Completed date, I=Comments
 *
 * Функции:
 *  1. onEdit()                  — автозаполнение полей при вводе задачи / смене статуса
 *  2. moveOldCompletedTasks()   — переносит задачи Status=Completed, у которых
 *                                 с Due date прошло >7 дней, из "Tasks" в "Completed"
 *  3. logDailyOkrCompliance()   — по будням считает % задач, выполненных в срок,
 *                                 и логирует в отдельную вкладку "OKR Summary"
 */

// ---------------------------------------------------------------------------
// 1. Автозаполнение полей при редактировании (простой триггер onEdit)
// ---------------------------------------------------------------------------
function onEdit(e) {
  if (!e || !e.range) return; // защита от ручного запуска без события правки
  var sheet = e.source.getActiveSheet();
  var row = e.range.getRow();
  var col = e.range.getColumn();

  if (row === 1) return; // пропускаем заголовок
  var today = new Date();

  // Начал печатать в колонке "Task" (B)
  if (col === 2 && e.range.getValue() !== "") {
    var received = sheet.getRange(row, 1);
    if (received.getValue() === "") received.setValue(today);

    var priority = sheet.getRange(row, 3);
    if (priority.getValue() === "") priority.setValue("3 low");

    var dueDate = sheet.getRange(row, 6);
    if (dueDate.getValue() === "") dueDate.setValue(today);
  }

  // Смена статуса (колонка D)
  if (col === 4) {
    var status = e.range.getValue().toString().toLowerCase();

    if (status.indexOf("progress") !== -1) {
      var startDate = sheet.getRange(row, 7);
      if (startDate.getValue() === "") startDate.setValue(today);
    }

    if (status.indexOf("completed") !== -1) {
      var completedDate = sheet.getRange(row, 8);
      if (completedDate.getValue() === "") completedDate.setValue(today);
    }

    if (status.indexOf("blocked") !== -1) {
      var comments = sheet.getRange(row, 9);
      var existing = comments.getValue().toString();
      var stamp = "Blocked on " + Utilities.formatDate(today, Session.getScriptTimeZone(), "M/d/yyyy");
      comments.setValue(existing ? existing + " | " + stamp : stamp);
    }
  }
}

// ---------------------------------------------------------------------------
// Помощник: превращает значение ячейки (настоящая дата ИЛИ текст вроде
// "7/22/2026") в объект Date. Возвращает null, если распознать не удалось.
// ---------------------------------------------------------------------------
function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Обрезает время, оставляя только календарный день (00:00:00), чтобы
// сравнение "вовремя / не вовремя" не зависело от времени суток
function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// ---------------------------------------------------------------------------
// 2. Перенос старых завершённых задач из "Tasks" в "Completed"
//    Запускать по расписанию (Time-driven trigger, ежедневно ночью)
// ---------------------------------------------------------------------------
function moveOldCompletedTasks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = ss.getSheetByName('Tasks');
  var archive = ss.getSheetByName('Completed');
  if (!source || !archive) return; // на случай, если название вкладки не совпадает

  var data = source.getDataRange().getValues();
  var today = new Date();
  var msPerDay = 24 * 60 * 60 * 1000;

  for (var i = data.length - 1; i >= 1; i--) { // снизу вверх, чтобы удаление строк не сбивало индексы
    var row = data[i];
    var status = row[3] ? row[3].toString().toLowerCase() : "";
    var dueDate = parseDateValue(row[5]);

    if (status.indexOf("completed") !== -1 && dueDate) {
      var diffDays = (today - dueDate) / msPerDay;
      if (diffDays > 7) {
        archive.appendRow(row);
        source.deleteRow(i + 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Ежедневный расчёт % задач, выполненных в срок (по будням)
//    Запускать по расписанию (Time-driven trigger, ежедневно)
// ---------------------------------------------------------------------------
function logDailyOkrCompliance() {
  var today = new Date();
  var day = today.getDay(); // 0 = воскресенье, 6 = суббота
  if (day === 0 || day === 6) return; // пропускаем выходные

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tasksSheet = ss.getSheetByName('Tasks');
  var completedSheet = ss.getSheetByName('Completed');
  var summarySheet = ss.getSheetByName('OKR Summary');

  // Создаём вкладку OKR Summary, если её ещё нет
  if (!summarySheet) {
    summarySheet = ss.insertSheet('OKR Summary');
    summarySheet.appendRow(['Date', 'Total completed', 'On-time', 'Late', '% on-time']);
  }

  var onTime = 0, late = 0;
  var lateTasks = [];

  [tasksSheet, completedSheet].forEach(function(sheet) {
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var status = data[i][3] ? data[i][3].toString().toLowerCase() : "";
      var dueDate = parseDateValue(data[i][5]);
      var completedDate = parseDateValue(data[i][7]);
      if (status.indexOf("completed") !== -1 && dueDate && completedDate) {
        if (stripTime(completedDate) <= stripTime(dueDate)) {
          onTime++;
        } else {
          late++;
          lateTasks.push(data[i][1] + " (due " + Utilities.formatDate(dueDate, Session.getScriptTimeZone(), "M/d/yyyy") + ", completed " + Utilities.formatDate(completedDate, Session.getScriptTimeZone(), "M/d/yyyy") + ")");
        }
      }
    }
  });

  if (lateTasks.length > 0) {
    Logger.log("Late tasks:\n" + lateTasks.join("\n"));
  }

  var total = onTime + late;
  var percent = total > 0 ? Math.round((onTime / total) * 1000) / 10 : 0;

  summarySheet.appendRow([today, total, onTime, late, percent + '%']);
}
