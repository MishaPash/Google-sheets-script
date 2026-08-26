// ===========================================================================
// HOW TO MERGE INTO YOUR EXISTING Code.gs
//
// You already added the `action === 'okr'` branch for the office-issues KR.
// Now add a second branch, `action === 'maint'`, for the weekly-maintenance KR.
// Do NOT add another doGet — just add the marked block to your EXISTING doGet,
// after the token check (and alongside the okr branch), before the daily jobs.
//
// The maint branch only fires when the request has ?action=maint, so nothing
// else changes.
// ===========================================================================

function doGet(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('WEBAPP_TOKEN');
  var provided = (e && e.parameter && e.parameter.token) ? e.parameter.token : '';

  if (!expected || provided !== expected) {
    return ContentService
      .createTextOutput('Forbidden: missing or invalid token')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  // office-issues KR reader (added earlier) — helpers in OkrExport.gs
  if (e && e.parameter && e.parameter.action === 'okr') {
    try {
      return okrJson_(readOkrValue_(e.parameter.date));
    } catch (err) {
      return okrJson_({ ok: false, error: String(err) });
    }
  }

  // ---- BEGIN new block: weekly-maintenance KR reader --------------------
  // Called as ...?token=XXX&action=maint  ->  {ok, count, value(1/0), ...}
  // (Helpers live in the separate file MaintExport.gs.)
  if (e && e.parameter && e.parameter.action === 'maint') {
    try {
      return maintJson_(readMaintValue_(e.parameter.date));
    } catch (err) {
      return maintJson_({ ok: false, error: String(err) });
    }
  }
  // ---- END new block ----------------------------------------------------

  // ---- Your existing code below stays UNCHANGED -------------------------
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
