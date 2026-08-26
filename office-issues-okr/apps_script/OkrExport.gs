/**
 * OKR export helpers for the office-issues KR automation.
 *
 * This is a COMPANION to your existing Code.gs — it does NOT contain a doGet
 * (your Code.gs already has one). Add this as a SEPARATE file in the same
 * Apps Script project, then add the small `action === 'okr'` router branch to
 * your existing doGet (see doGet_router_snippet.js).
 *
 * It reads the "OKR Summary" tab and returns the "% on-time" value (column E)
 * for today's date as JSON. If today has no row yet (weekend / before the daily
 * job ran) it falls back to the most recent row on or before today.
 *
 * All names are prefixed `okr`/`OKR_` so nothing collides with your script.
 */

var OKR_SHEET_NAME = 'OKR Summary';
var OKR_DATE_COL = 1;   // A — Date (may include a time component)
var OKR_TOTAL_COL = 2;  // B — Total completed
var OKR_ONTIME_COL = 3; // C — On-time
var OKR_LATE_COL = 4;   // D — Late
var OKR_PCT_COL = 5;    // E — % on-time  <-- the value pushed to the KR

function readOkrValue_(overrideDate) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(OKR_SHEET_NAME);
  if (!sh) throw new Error('sheet "' + OKR_SHEET_NAME + '" not found');

  var tz = ss.getSpreadsheetTimeZone();
  var today = overrideDate ? new Date(overrideDate + 'T12:00:00') : new Date();
  var todayKey = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  // Display values = exactly what a human sees: "8/26/2026 2:11:17" and "100%".
  var rows = sh.getDataRange().getDisplayValues();

  var start = 0;
  for (var i = 0; i < rows.length; i++) {
    var a = String(rows[i][OKR_DATE_COL - 1]).trim().toLowerCase();
    var e5 = String(rows[i][OKR_PCT_COL - 1]).trim().toLowerCase();
    if (a === 'date' && e5.indexOf('on-time') !== -1) { start = i + 1; break; }
  }
  if (start === 0) throw new Error('could not find the "Date / % on-time" header row');

  var todayRow = null; // exact match for today (last one wins)
  var best = null;     // most recent row on or before today

  for (var r = start; r < rows.length; r++) {
    var rawDate = String(rows[r][OKR_DATE_COL - 1]).trim();
    if (!rawDate) continue;
    var d = okrParseDate_(rawDate);
    if (!d) continue;
    var key = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    if (key > todayKey) continue; // ignore future-dated rows

    var pct = okrParsePct_(rows[r][OKR_PCT_COL - 1]);
    if (pct === null) continue;

    var rec = {
      matched_date: key,
      value: pct,
      total: okrToNum_(rows[r][OKR_TOTAL_COL - 1]),
      on_time: okrToNum_(rows[r][OKR_ONTIME_COL - 1]),
      late: okrToNum_(rows[r][OKR_LATE_COL - 1])
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
function okrParsePct_(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  if (s === '') return null;
  var hadPct = s.indexOf('%') !== -1;
  var n = parseFloat(s.replace('%', '').replace(',', '.'));
  if (isNaN(n)) return null;
  if (!hadPct && n <= 1) n = n * 100;
  return Math.round(n * 100) / 100;
}

/** Parse "8/26/2026", "8/26/2026 2:11:17", "8/26/26" -> Date (local). */
function okrParseDate_(s) {
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

function okrToNum_(v) {
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function okrJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
