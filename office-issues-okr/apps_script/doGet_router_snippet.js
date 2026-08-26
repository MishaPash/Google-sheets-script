// ===========================================================================
// HOW TO MERGE INTO YOUR EXISTING Code.gs
//
// Your Code.gs already has a doGet(e) that (a) checks WEBAPP_TOKEN and then
// (b) runs the daily jobs. Do NOT add a second doGet. Instead, paste the
// marked block below into your EXISTING doGet, right AFTER the token check and
// BEFORE the "run the daily jobs" part. Everything else in your doGet stays.
//
// The new branch only fires when the request has ?action=okr, so the existing
// daily trigger (which calls without action=) keeps running the jobs exactly
// as before.
// ===========================================================================

function doGet(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('WEBAPP_TOKEN');
  var provided = (e && e.parameter && e.parameter.token) ? e.parameter.token : '';

  if (!expected || provided !== expected) {
    return ContentService
      .createTextOutput('Forbidden: missing or invalid token')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  // ---- BEGIN new block: OKR reader for the office-issues KR automation ----
  // Called as ...?token=XXX&action=okr  ->  returns today's "% on-time" JSON.
  // (Helpers live in the separate file OkrExport.gs.)
  if (e && e.parameter && e.parameter.action === 'okr') {
    try {
      return okrJson_(readOkrValue_(e.parameter.date));
    } catch (err) {
      return okrJson_({ ok: false, error: String(err) });
    }
  }
  // ---- END new block ------------------------------------------------------

  // ---- Your existing code below stays UNCHANGED ---------------------------
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
