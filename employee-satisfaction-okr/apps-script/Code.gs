/**
 * Employee Satisfaction OKR — Google Apps Script
 * ------------------------------------------------
 * Bound to the Polly "office satisfaction" spreadsheet.
 *
 * What it does:
 *   1. Reads the raw weekly Polly responses.
 *   2. Groups responses by Polly Id (one Polly Id == one weekly survey).
 *   3. Computes an office-satisfaction % per week from the rating columns
 *      J ("How would you rate your office experience this week?") and
 *      M ("How quickly were office issues resolved this week?").
 *      Formula:  satisfaction% = sum(ratings) / (scale * count(ratings)) * 100
 *      e.g. 10 people all voting 5 on a 5-point scale -> 100%.
 *      The scale (5 vs 10) is auto-detected per week so historical 10-point
 *      polls are handled correctly too.
 *   4. Writes the per-week result into a separate tab "OKR Satisfaction".
 *   5. Exposes a token-protected web endpoint (doGet/doPost) that the GitHub
 *      Action calls every Friday to (a) refresh the summary tab and
 *      (b) get the latest completed week's value to push into GetOKRs.
 *
 * This runs as YOU (the spreadsheet owner) — no Google service account needed.
 *
 * ONE-TIME SETUP (see the folder README for the full checklist):
 *   1. Extensions -> Apps Script, paste this file (and appsscript.json).
 *   2. Run setup() once, authorize, and copy the API_TOKEN it logs.
 *   3. Deploy -> New deployment -> Web app -> Execute as: Me,
 *      Who has access: Anyone. Copy the /exec URL.
 *   4. Put the URL + token into the GitHub repo secrets
 *      (APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN).
 */

// ----------------------------- Configuration -------------------------------

var CONFIG = {
  SUMMARY_SHEET_NAME: 'OKR Satisfaction',
  // 1-based column indexes in the raw responses sheet.
  COL_POLLY_ID: 1,   // A
  COL_POLLY_DATE: 7, // G
  COL_RATING_1: 10,  // J - office experience rating
  COL_RATING_2: 13,  // M - issue resolution rating
  HEADER_MARKER: 'Polly Id' // used to auto-detect the raw sheet / header row
};

// ------------------------------- Public API --------------------------------

/**
 * Run this ONCE from the Apps Script editor. Generates and stores the shared
 * token the GitHub Action uses to authenticate, and prints it to the log.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('API_TOKEN');
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('API_TOKEN', token);
  }
  Logger.log('API_TOKEN = ' + token);
  Logger.log('Add this as the GitHub secret APPS_SCRIPT_TOKEN.');
  return token;
}

/**
 * Refresh the summary tab from the current raw data. Safe to run manually
 * from the editor or the custom menu, or on a time-based trigger.
 */
function refreshSummary() {
  var weeks = computeWeeks_();
  writeSummarySheet_(weeks);
  return weeks;
}

/** Adds a small helper menu when the spreadsheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('OKR Automation')
    .addItem('Refresh satisfaction summary now', 'refreshSummary')
    .addToUi();
}

/** GitHub Action entry point (GET). Token via ?token=... */
function doGet(e) {
  return handleRequest_(e);
}

/** GitHub Action entry point (POST). Token via ?token=... or JSON body. */
function doPost(e) {
  return handleRequest_(e);
}

// ------------------------------ Request handling ---------------------------

function handleRequest_(e) {
  try {
    if (!isAuthorized_(e)) {
      return jsonOut_({ ok: false, error: 'unauthorized' });
    }
    var weeks = computeWeeks_();
    writeSummarySheet_(weeks);
    var latest = weeks.length ? weeks[0] : null; // weeks[0] == most recent
    return jsonOut_({
      ok: true,
      generated_at: new Date().toISOString(),
      spreadsheet_id: SpreadsheetApp.getActiveSpreadsheet().getId(),
      latest: latest,
      weeks: weeks
    });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function isAuthorized_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected) return false; // setup() not run yet -> deny by default
  var provided = '';
  if (e && e.parameter && e.parameter.token) {
    provided = e.parameter.token;
  } else if (e && e.postData && e.postData.contents) {
    try {
      provided = (JSON.parse(e.postData.contents) || {}).token || '';
    } catch (ignore) {}
  }
  return provided && provided === expected;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------ Core computation ---------------------------

/**
 * Returns an array of week objects, most recent first:
 *   { polly_id, week_date (yyyy-MM-dd), participants, ratings_counted,
 *     scale, avg_score, satisfaction_pct }
 */
function computeWeeks_() {
  var sheet = findRawSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var groups = {}; // polly_id -> aggregate
  for (var r = 1; r < values.length; r++) { // skip header row
    var row = values[r];
    var pollyId = String(row[CONFIG.COL_POLLY_ID - 1] || '').trim();
    if (!pollyId) continue;

    var g = groups[pollyId];
    if (!g) {
      g = { polly_id: pollyId, week_date: '', ratings: [], participants: 0 };
      groups[pollyId] = g;
    }
    g.participants += 1;

    var d = normalizeDate_(row[CONFIG.COL_POLLY_DATE - 1]);
    if (d && (!g.week_date || d < g.week_date)) g.week_date = d;

    var r1 = toRating_(row[CONFIG.COL_RATING_1 - 1]);
    if (r1 !== null) g.ratings.push(r1);
    var r2 = toRating_(row[CONFIG.COL_RATING_2 - 1]);
    if (r2 !== null) g.ratings.push(r2);
  }

  var weeks = [];
  for (var key in groups) {
    var grp = groups[key];
    if (!grp.ratings.length) continue; // no numeric ratings -> skip
    var maxRating = Math.max.apply(null, grp.ratings);
    var scale = maxRating > 5 ? 10 : 5;
    var sum = grp.ratings.reduce(function (a, b) { return a + b; }, 0);
    var satisfaction = (sum / (scale * grp.ratings.length)) * 100;
    weeks.push({
      polly_id: grp.polly_id,
      week_date: grp.week_date,
      participants: grp.participants,
      ratings_counted: grp.ratings.length,
      scale: scale,
      avg_score: round_(sum / grp.ratings.length, 2),
      satisfaction_pct: round_(satisfaction, 1)
    });
  }

  // Most recent first. Fall back to polly_id when dates are missing/equal.
  weeks.sort(function (a, b) {
    if (a.week_date === b.week_date) return a.polly_id < b.polly_id ? 1 : -1;
    return a.week_date < b.week_date ? 1 : -1;
  });
  return weeks;
}

/** Locates the raw responses sheet by its header, defaulting to the first. */
function findRawSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === CONFIG.SUMMARY_SHEET_NAME) continue;
    var lastCol = sheets[i].getLastColumn();
    if (lastCol < 1) continue;
    var header = sheets[i].getRange(1, 1, 1, lastCol).getValues()[0];
    for (var c = 0; c < header.length; c++) {
      if (String(header[c]).trim() === CONFIG.HEADER_MARKER) return sheets[i];
    }
  }
  return sheets[0];
}

/** Writes/overwrites the summary tab (most recent week first). */
function writeSummarySheet_(weeks) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SUMMARY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SUMMARY_SHEET_NAME);
  sheet.clear();

  var header = ['Week (Polly Date)', 'Polly Id', 'Participants',
                'Ratings counted', 'Scale', 'Avg score', 'Satisfaction %'];
  var rows = [header];
  for (var i = 0; i < weeks.length; i++) {
    var w = weeks[i];
    rows.push([w.week_date, w.polly_id, w.participants, w.ratings_counted,
               w.scale, w.avg_score, w.satisfaction_pct]);
  }
  sheet.getRange(1, 1, rows.length, header.length).setValues(rows);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Footer note with the last refresh time.
  sheet.getRange(rows.length + 2, 1)
       .setValue('Last updated: ' + new Date().toISOString() +
                 '  (auto-generated — do not edit by hand)');
  sheet.autoResizeColumns(1, header.length);
}

// -------------------------------- Helpers ----------------------------------

/** Parses a rating cell into a positive number, or null if not a rating. */
function toRating_(value) {
  if (value === '' || value === null || value === undefined) return null;
  var n = Number(value);
  if (isNaN(n) || n <= 0) return null;
  return n;
}

/** Normalizes a Polly Date cell (Date or string) to a yyyy-MM-dd string. */
function normalizeDate_(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Etc/UTC', 'yyyy-MM-dd');
  }
  var s = String(value).trim();
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, 'Etc/UTC', 'yyyy-MM-dd');
  }
  return '';
}

function round_(n, places) {
  var f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
