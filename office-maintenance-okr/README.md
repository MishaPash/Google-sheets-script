# office-maintenance-okr

Weekly automation for the KR
**`[Leading] Complete weekly preventive office maintenance checklist (# of checklists completed per week)`**.

Every **Friday night (Florida time)** it:

1. asks the bound Apps Script web app (`action=maint`) whether the
   **`Form Responses 2`** tab of the source sheet
   ([spreadsheet `1JxIYSMaKzENPfJu7KuZD8kk30vzm5Jy9OJlCuag7Cl4`](https://docs.google.com/spreadsheets/d/1JxIYSMaKzENPfJu7KuZD8kk30vzm5Jy9OJlCuag7Cl4/edit))
   has a Google-Form response for the **current week** (Monday 00:00 → now);
2. creates a **check-in** on the KR with value **1** (a response exists) or
   **0** (none);
3. opens a **pull request** with a small report — the existing auto-approve
   workflow then approves and merges it.

Re-runs in the same week do **not** create a duplicate check-in (unless `FORCE=1`).

## Files

```
office-maintenance-okr/
  apps_script/MaintExport.gs             # companion file (no doGet); counts this week's responses
  apps_script/doGet_router_snippet.js    # how to add the action=maint branch to your existing doGet
  scripts/push_to_okr.py                 # reads the web app, posts the 1/0 check-in, writes the report
  reports/                               # one YYYY-MM-DD.md per week
  data/latest.json                       # last run's raw numbers
.github/workflows/office-maintenance-okr.yml   # the weekly schedule + PR
```

## One-time setup

### 1. Extend the sheet's EXISTING Apps Script (no new deployment)

This reuses the **same** bound `Code.gs` / web app / `WEBAPP_TOKEN` that the
office-issues automation already uses. Do **not** create a new `doGet` or a new
deployment.

1. Open the source sheet → **Extensions → Apps Script**.
2. Add `apps_script/MaintExport.gs` as a **new file** (it has no `doGet`, all
   names are prefixed `maint`/`MAINT_`, so nothing collides).
3. In your **existing** `doGet`, add the `action === 'maint'` branch shown in
   `apps_script/doGet_router_snippet.js` (right next to the `action === 'okr'`
   branch you already added).
4. **Manage deployments → edit the existing web-app deployment → New version →
   Deploy** (keeps the same `/exec` URL).
5. (Sanity check) open `<exec-url>?token=YOUR_WEBAPP_TOKEN&action=maint` — you
   should get JSON like
   `{"ok":true,"count":1,"value":1,"week_start":"2026-08-24","week_end":"2026-08-28",...}`.

### 2. GitHub secrets & variables

**No new secrets needed** — the workflow reuses the ones the office-issues
automation already has:

| Secret | Reused from |
| --- | --- |
| `OFFICE_ISSUES_APPS_SCRIPT_URL` | office-issues (same web app) |
| `OFFICE_ISSUES_APPS_SCRIPT_TOKEN` | office-issues (`WEBAPP_TOKEN`) |
| `OKRS_API_KEY` | existing |
| `Moa_PAT` | existing (so the PR is auto-approvable) |

**Variables** are optional — the script has the correct defaults baked in:

| Variable | Default in script |
| --- | --- |
| `OKRS_ORG_ID` | `6b23a391-b1cf-4f4a-8f82-151f2fb8782e` (Appodeal) |
| `OFFICE_MAINT_KR_ID` | `2d3db272-6b01-4b9d-86fb-d889ab8afbb0` |

### 3. Test it

Actions → **Office maintenance OKR (weekly)** → **Run workflow** → tick
**dry_run** for a safe first run (opens a PR, does not touch GetOKRs). Then
re-run without dry_run to post the real check-in.

## Schedule

`50 3 * * 6` — Saturday 03:50 **UTC**. Cron is UTC and ignores DST, so in
Florida this is **Friday 23:50 (EDT, summer)** or **Friday 22:50 (EST, winter)**
— both Friday evening, after the weekly checklist is submitted.

## Notes

- The value is **1/0** (completed / not), as requested. To push the actual
  number of responses instead, change `value` in `push_to_okr.py` to use
  `count` directly.
- "This week" = Monday 00:00 local → now, computed in the Apps Script using the
  spreadsheet's timezone.
