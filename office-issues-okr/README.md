# office-issues-okr

Daily automation for the KR
**`[Leading] Resolve office-related issues within deadline ≥ 90%`**.

Every day it:

1. reads the **`% on-time`** value (column **E**) for **today's date** from the
   **`OKR Summary`** tab of the source sheet
   ([spreadsheet `1JxIYSMaKzENPfJu7KuZD8kk30vzm5Jy9OJlCuag7Cl4`](https://docs.google.com/spreadsheets/d/1JxIYSMaKzENPfJu7KuZD8kk30vzm5Jy9OJlCuag7Cl4/edit?gid=1021438337#gid=1021438337)),
   via a bound Apps Script web app;
2. creates a **check-in** on the KR in GetOKRs with that value;
3. opens a **pull request** with a small report as an audit trail — the existing
   auto-approve workflow then approves and merges it.

If today has no row yet (weekend / before the sheet's daily recalculation) it
falls back to the most recent row on or before today. Re-runs on the same day
do **not** create a duplicate check-in (unless `FORCE=1`).

## Files

```
office-issues-okr/
  apps_script/Code.gs           # bound to the sheet, returns today's % on-time as JSON
  apps_script/appsscript.json   # web-app manifest
  scripts/push_to_okr.py        # reads the web app, posts the check-in, writes the report
  reports/                      # one YYYY-MM-DD.md per day (audit trail)
  data/latest.json              # last run's raw numbers
.github/workflows/office-issues-okr.yml   # the daily schedule + PR
```

The daily PR is auto-approved by the **existing** `.github/workflows/auto-approve.yml`
— no changes needed there.

## One-time setup

### 1. Extend the sheet's EXISTING Apps Script (no new deployment)

The sheet already has a bound `Code.gs` with a `doGet(e)` (guarded by the
Script Property `WEBAPP_TOKEN`) that a daily trigger calls to compute the
"OKR Summary" tab. We reuse that same web app — do **not** create a second
`doGet` or a new deployment.

1. Open the source sheet → **Extensions → Apps Script**.
2. Add `apps_script/OkrExport.gs` as a **new file** (it has no `doGet`, so it
   can't collide). All its names are prefixed `okr`/`OKR_`.
3. In your **existing** `doGet`, right after the `WEBAPP_TOKEN` check, add the
   `action === 'okr'` branch shown in `apps_script/doGet_router_snippet.js`.
   Everything else in your `doGet` stays as-is.
4. **Manage deployments → edit the existing web-app deployment → New version →
   Deploy.** This keeps the SAME `/exec` URL, now serving the new branch too.
5. (Sanity check) open `<exec-url>?token=YOUR_WEBAPP_TOKEN&action=okr` in a
   browser — you should get JSON like
   `{"ok":true,"value":100,"matched_date":"2026-08-26",...}`.

### 2. Add GitHub secrets & variables (repo → Settings)

**Secrets** (Settings → Secrets and variables → Actions → *Secrets*):

| Secret | Value |
| --- | --- |
| `OFFICE_ISSUES_APPS_SCRIPT_URL` | the existing web-app `/exec` URL (the Python script appends `&action=okr`) |
| `OFFICE_ISSUES_APPS_SCRIPT_TOKEN` | the value of the `WEBAPP_TOKEN` Script Property |
| `OKRS_API_KEY` | GetOKRs API key *(already present for the other automation — reuse it)* |
| `Moa_PAT` | PAT of `MishaPash` *(already present for the other automation — reuse it, so the PR is auto-approvable)* |

**Variables** are optional — the script already has the correct defaults baked in:

| Variable | Default in script |
| --- | --- |
| `OKRS_ORG_ID` | `6b23a391-b1cf-4f4a-8f82-151f2fb8782e` (Appodeal) |
| `OFFICE_ISSUES_KR_ID` | `0299405b-1a72-4113-8736-7bba4eedac81` |

Only set these variables if the org/KR ever changes.

### 3. Test it

Actions → **Office issues OKR (daily)** → **Run workflow** →
check **“Compute + open PR but do NOT write to GetOKRs”** (`dry_run`) for a safe
first run. It should open a PR with today's report and *not* touch GetOKRs.
Re-run with `dry_run` unchecked to post the real check-in.

## Schedule

`0 14 * * *` — every day at **14:00 UTC** (~10:00 America/New_York), after the
sheet's early-morning recalculation. Adjust the cron in the workflow if you want
a different time.
