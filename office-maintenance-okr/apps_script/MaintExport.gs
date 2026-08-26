/**
 * Weekly maintenance-checklist reader for the KR
 * "[Leading] Complete weekly preventive office maintenance checklist".
 *
 * COMPANION to your existing Code.gs — it has NO doGet (yours already has one).
 * Add this as a SEPARATE file in the same Apps Script project, then add the
 * `action === 'maint'` branch to your existing doGet (see doGet_router_snippet.js).
 *
 * It looks at the "Form Responses 2" tab (weekly Google Form) and counts the
 * responses whose Timestamp (column A) falls in the CURRENT week
 * (Monday 00:00 local → now). Returns value = 1 if at least one response this
 * week, else 0.
 *
 * All names are prefixed `maint`/`MAINT_` so nothing collides with your script.
 */

var MAINT_SHEET_NAME = 'Form Responses 2';
var MAINT_TS_COL = 1; // A — form Timestamp

function readMaintValue_(overrideDate) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MAINT_SHEET_NAME);
  if (!sh) throw new Error('sheet "' + MAINT_SHEET_NAME + '" not found');

  var tz = ss.getSpreadsheetTimeZone();
  // overrideDate (YYYY-MM-DD) is only for manual testing; default is "now".
  var now = overrideDate ? new Date(overrideDate + 'T23:50:00') : new Date();

  // Week window: Monday 00:00 (local) of the current week → now.
  var dow = now.getDay();            // 0=Sun .. 6=Sat
  var daysSinceMon = (dow + 6) % 7;  // Mon→0, ... Sun→6
  var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMon, 0, 0, 0);

  var values = sh.getDataRange().getValues();
  var count = 0;
  var latest = null;
  for (var i = 0; i < values.length; i++) {
    var d = maintParseDate_(values[i][MAINT_TS_COL - 1]);
    if (!d) continue; // header row / blank cells are skipped
    if (d >= weekStart && d <= now) {
      count++;
      if (!latest || d > latest) latest = d;
    }
  }

  return {
    ok: true,
    week_start: Utilities.formatDate(weekStart, tz, 'yyyy-MM-dd'),
    week_end: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    count: count,
    value: count >= 1 ? 1 : 0,
    latest_response: latest ? Utilities.formatDate(latest, tz, 'yyyy-MM-dd HH:mm') : null
  };
}

/** Google Form timestamps come back as real Date objects; strings are parsed too. */
function maintParseDate_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  if (!s) return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function maintJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
