/**
 * OKR Summary reader — "Resolve office-related issues within deadline ≥ 90%".
 *
 * Bind this script to the spreadsheet:
 *   https://docs.google.com/spreadsheets/d/1JxIYSMaKzENPfJu7KuZD8kk30vzm5Jy9OJlCuag7Cl4/
 * (Extensions -> Apps Script from inside that sheet, paste this file).
 *
 * It reads the "OKR Summary" tab and returns the "% on-time" value (column E)
 * for today's date. If today has no row yet (weekend / before the daily
 * recalculation) it falls back to the most recent row on or before today.
 *
 * Deploy: Deploy -> New deployment -> Web app
 *   - Execute as: Me
 *   - Who has access: Anyone with the link
 * Then copy the /exec URL into the GitHub secret OFFICE_ISSUES_APPS_SCRIPT_URL.
 *
 * Auth: set a Script Property OKR_TOKEN (Project Settings -> Script properties)
 * to a long random string, and store the same string in the GitHub secret
 * OFFICE_ISSUES_APPS_SCRIPT_TOKEN. The web app rejects calls without it.
 */

var SHEET_NAME = 'OKR Summary';
var DATE_COL = 1; // A — Date (may include a time component)
var TOTAL_COL = 2; // B — Total completed
var ONTIME_COL = 3; // C — On-time
var LATE_COL = 4; // D — Late
var PCT_COL = 5; // E — % on-time  <-- the value we push to the KR

function doGet(e) {
  try {
    var expected = PropertiesService.getScriptProperties().getProperty('OKR_TOKEN');
    var got = (e && e.parameter && e.parameter.token) || '';
    if (!expected || got !== expected) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    // Optional ?date=YYYY-MM-DD override, mainly for testing.
    var override = e && e.parameter && e.parameter.date;
    return json_(readValue_(override));
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function readValue_(overrideDate) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('sheet "' + SHEET_NAME + '" not found');

  var tz = ss.getSpreadsheetTimeZone();
  var today = overrideDate ? new Date(overrideDate + 'T12:00:00') : new Date();
  var todayKey = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  // getDisplayValues() returns exactly what a human sees in the cell:
  // dates like "8/26/2026 2:11:17" and percentages like "100%".
  var rows = sh.getDataRange().getDisplayValues();

  // Locate the header row of the "% on-time" table.
  var start = 0;
  for (var i = 0; i < rows.length; i++) {
    var a = String(rows[i][DATE_COL - 1]).trim().toLowerCase();
    var e5 = String(rows[i][PCT_COL - 1]).trim().toLowerCase();
    if (a === 'date' && e5.indexOf('on-time') !== -1) {
      start = i + 1;
      break;
    }
  }
  if (start === 0) throw new Error('could not find the "Date / % on-time" header row');

  var todayRow = null; // exact match for today (last one wins)
  var best = null; // most recent row on or before today

  for (var r = start; r < rows.length; r++) {
    var rawDate = String(rows[r][DATE_COL - 1]).trim();
    if (!rawDate) continue;
    var d = parseDate_(rawDate);
    if (!d) continue;
    var key = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    if (key > todayKey) continue; // ignore future-dated rows

    var pct = parsePct_(rows[r][PCT_COL - 1]);
    if (pct === null) continue;

    var rec = {
      matched_date: key,
      value: pct,
      total: toNum_(rows[r][TOTAL_COL - 1]),
      on_time: toNum_(rows[r][ONTIME_COL - 1]),
      late: toNum_(rows[r][LATE_COL - 1])
    };
    if (key === todayKey) todayRow = rec;
    if (!best || key >= best.matched_date) best = rec;
  }

  var picked = todayRow || best;
  if (!picked) return { ok: false, error: 'no data rows found in OKR Summary' };

  picked.ok = true;
  picked.requested_date = todayKey;
  picked.exact_today = !!todayRow;
  return picked;
}

/** "100%" -> 100, "98%" -> 98, "0.98" -> 98, "" -> null */
function parsePct_(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  if (s === '') return null;
  var hadPct = s.indexOf('%') !== -1;
  var n = parseFloat(s.replace('%', '').replace(',', '.'));
  if (isNaN(n)) return null;
  if (!hadPct && n <= 1) n = n * 100; // a bare fraction like 0.98
  return Math.round(n * 100) / 100;
}

/** Parse "8/26/2026", "8/26/2026 2:11:17", "8/26/26" -> Date (local). */
function parseDate_(s) {
  s = String(s).trim();
  var datePart = s.split(' ')[0];
  var m = datePart.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!m) {
    var d0 = new Date(s);
    return isNaN(d0.getTime()) ? null : d0;
  }
  var mm = parseInt(m[1], 10);
  var dd = parseInt(m[2], 10);
  var yy = parseInt(m[3], 10);
  if (yy < 100) yy += 2000;
  return new Date(yy, mm - 1, dd);
}

function toNum_(v) {
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
