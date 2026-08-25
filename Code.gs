/**
 * Office Task Tracker — Automation Scripts
 * Sheet columns: A=Received, B=Task, C=Priority, D=Status,
 *                E=Est time, F=Due date, G=Start date,
 *                H=Completed date, I=Comments
 *
 * Functions:
 *  1. onEdit()                  — auto-fills fields when a task is entered / status changes
 *  2. moveOldCompletedTasks()   — moves tasks with Status=Completed whose Due date is
 *                                 more than 7 days in the past from "Tasks" to "Completed"
 *  3. logDailyOkrCompliance()   — on weekdays, computes the % of tasks completed on time
 *                                 and logs it into a separate "OKR Summary" tab
 *  4. doGet()                   — web app entry point: runs the daily jobs (2 and 3).
 *                                 Triggered externally (GitHub Actions) once a day via a
 *                                 secret URL with a token.
 */

// ---------------------------------------------------------------------------
// 0. Web app: daily run triggered by an external HTTP request
//    Deployed as a Web App (Deploy → New deployment → Web app).
//    The request must include the correct token: ...?token=XXXX
//    The token is stored in Script Properties under the key WEBAPP_TOKEN
//    (Project Settings → Script Properties); it is never hardcoded here.
// ---------------------------------------------------------------------------
function doGet(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('WEBAPP_TOKEN');
  var provided = (e && e.parameter && e.parameter.token) ? e.parameter.token : '';

  if (!expected || provided !== expected) {
    return ContentService
      .createTextOutput('Forbidden: missing or invalid token')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  var log = [];
  try {
    moveOldCompletedTasks();
    log.push('moveOldCompletedTasks: OK');
  } catch (err) {
    log.push('moveOldCompletedTasks: ERROR ' + err);
  }
  try {
    logDailyOkrCompliance();
    log.push('logDailyOkrCompliance: OK');
  } catch (err) {
    log.push('logDailyOkrCompliance: ERROR ' + err);
  }

  return ContentService
    .createTextOutput(log.join('\n'))
    .setMimeType(ContentService.MimeType.TEXT);
}

// ---------------------------------------------------------------------------
// 1. Auto-fill fields on edit (simple onEdit trigger)
// ---------------------------------------------------------------------------
function onEdit(e) {
  if (!e || !e.range) return; // guard against manual runs without an edit event
  var sheet = e.source.getActiveSheet();
  var row = e.range.getRow();
  var col = e.range.getColumn();

  if (row === 1) return; // skip the header row
  var today = new Date();

  // Started typing in the "Task" column (B)
  if (col === 2 && e.range.getValue() !== "") {
    var received = sheet.getRange(row, 1);
    if (received.getValue() === "") received.setValue(today);

    var priority = sheet.getRange(row, 3);
    if (priority.getValue() === "") priority.setValue("3 low");

    var dueDate = sheet.getRange(row, 6);
    if (dueDate.getValue() === "") dueDate.setValue(today);
  }

  // Status change (column D)
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
// Helper: converts a cell value (a real Date OR text like "7/22/2026")
// into a Date object. Returns null if it cannot be parsed.
// ---------------------------------------------------------------------------
function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Strips the time part, keeping only the calendar day (00:00:00), so the
// "on time / late" comparison does not depend on the time of day.
function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// ---------------------------------------------------------------------------
// 2. Move old completed tasks from "Tasks" to "Completed"
//    Runs on a schedule (via the web app, once a day)
// ---------------------------------------------------------------------------
function moveOldCompletedTasks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = ss.getSheetByName('Tasks');
  var archive = ss.getSheetByName('Completed');
  if (!source || !archive) return; // in case a tab name does not match

  var data = source.getDataRange().getValues();
  var today = new Date();
  var msPerDay = 24 * 60 * 60 * 1000;

  for (var i = data.length - 1; i >= 1; i--) { // bottom-up so row deletion does not shift indexes
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
// 3. Daily computation of the % of tasks completed on time (weekdays only)
//    Runs on a schedule (via the web app, once a day)
// ---------------------------------------------------------------------------
function logDailyOkrCompliance() {
  var today = new Date();
  var day = today.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return; // skip weekends

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tasksSheet = ss.getSheetByName('Tasks');
  var completedSheet = ss.getSheetByName('Completed');
  var summarySheet = ss.getSheetByName('OKR Summary');

  // Create the OKR Summary tab if it does not exist yet
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
