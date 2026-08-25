# Office satisfaction — OKR automation

Every Friday this automation:

1. Reads the weekly Slack Polly office-satisfaction survey from the Google
   Sheet (via a bound Apps Script web app).
2. Computes a satisfaction % per week and writes it to a separate
   **`OKR Satisfaction`** tab in the same spreadsheet.
3. Pushes the **latest completed week's** satisfaction % into the GetOKRs key
   result *"[Lagging] Achieve an employee satisfaction rate of at least 90% …"*
   as a check-in.
4. Opens a pull request with the report as an audit trail (auto-approved and
   merged by the shared `auto-approve.yml`).

```
Google Sheet ──(read as the owner)──> Apps Script (Web App)
                                        │ computes % per week
                                        │ writes the "OKR Satisfaction" tab
                                        └── returns the latest week as JSON
                                                   ▲  (token)
                    GitHub Action (Friday, cron) ──┘
                          │ POST check-in → GetOKRs (Bearer API key)
                          └── opens a PR with the report
```

No Google service account is required: the Apps Script runs as the spreadsheet
owner and reads/writes the sheet directly.

## Formula

For each week (same **Polly Id**, column A) the automation takes every filled-in
numeric rating from columns **J** ("How would you rate your office experience
this week?") and **M** ("How quickly were office issues resolved this week?"):

```
satisfaction % = sum(ratings) / (max_scale × count(ratings)) × 100
```

- If everyone votes 5 on a 5-point scale → 100%.
- The scale (5 or 10) is auto-detected per week, so historical 10-point polls
  are handled correctly too.

Real examples: week `2026-08-17` → 100%, `2026-07-06` → 92%, `2026-04-24`
(10-point) → 98.6%.

## Files

| File | Purpose |
|---|---|
| `apps-script/Code.gs` | Apps Script: compute, write the `OKR Satisfaction` tab, token-protected web endpoint |
| `apps-script/appsscript.json` | Apps Script manifest (web app) |
| `scripts/push_to_okr.py` | Run by the workflow: fetch from Apps Script, post the GetOKRs check-in, write report + history |
| `../.github/workflows/office-satisfaction.yml` | Friday schedule + PR creation |
| `data/history.csv` | History of pushed weeks (auto-filled; provides idempotency) |
| `reports/*.md` | Per-week reports (auto-created) |

## Secrets

Set these in the repository (Settings → Secrets and variables → Actions):

| Secret | Where to get it |
|---|---|
| `APPS_SCRIPT_URL` | Apps Script → Deploy → Manage deployments → the Web app URL (ends with `/exec`) |
| `APPS_SCRIPT_TOKEN` | Apps Script → run `setup()` → View → Logs → the `API_TOKEN = …` line |
| `OKRS_API_KEY` | GetOKRs → Settings → API keys → Create |
| `GH_PAT` | GitHub fine-grained PAT (owner: appodeal, this repo; Contents R/W + Pull requests R/W) — lets the weekly PR be opened by you so `auto-approve.yml` can merge it |

`OKRS_ORG_ID` and `OKRS_KR_ID` are baked into `scripts/push_to_okr.py` as
defaults; override them with repository **Variables** only if the KR/org changes.

## One-time setup

### 1. Google Apps Script

1. Spreadsheet → **Extensions → Apps Script**. Paste `apps-script/Code.gs`
   (and, via Project Settings → "Show appsscript.json", the manifest).
2. Run **`setup`** once, authorize, and copy the `API_TOKEN` from the log →
   secret `APPS_SCRIPT_TOKEN`.
3. **Deploy → New deployment → Web app**, *Execute as:* **Me**,
   *Who has access:* **Anyone**. Copy the `/exec` URL → secret `APPS_SCRIPT_URL`.

### 2. Repository

- Add the four secrets above.
- **Settings → Actions → General → Workflow permissions:** *Read and write* +
  *Allow GitHub Actions to create and approve pull requests*.

## How it runs weekly

- Schedule: `cron: '0 15 * * 5'` — Fridays 15:00 UTC. Change it in
  `../.github/workflows/office-satisfaction.yml`.
- Each run pushes **only a new** week. If the week was already pushed (present
  in `data/history.csv`), the GetOKRs write and the PR are skipped — re-runs are
  safe (idempotent).
- The full week-by-week list is always on the `OKR Satisfaction` tab.

## Verifying it works

1. **Dry run (no KR write).** Actions → *Employee satisfaction OKR (weekly)* →
   **Run workflow** → tick **dry_run = true**. Check: green run, the computed
   value in the log, the `OKR Satisfaction` tab updated, and **nothing** written
   to GetOKRs.
2. **Real run.** Run again with **dry_run = false**. Check: a new check-in on
   the KR, the PR opened and auto-merged, and a new row in `data/history.csv`.
3. **Autonomy.** From then on the Friday cron does check-in + PR + merge by
   itself.

## Local run

```bash
export APPS_SCRIPT_URL='https://script.google.com/macros/s/XXX/exec'
export APPS_SCRIPT_TOKEN='...'
export OKRS_API_KEY='...'
export DRY_RUN=1   # do not write to GetOKRs
python office-satisfaction/scripts/push_to_okr.py
```

## Troubleshooting

- **Apps Script returns non-JSON / `unauthorized`** — token mismatch
  (`APPS_SCRIPT_TOKEN` ≠ Script Property `API_TOKEN`) or the deployment is not
  "Anyone".
- **GetOKRs 401/403** — invalid `OKRS_API_KEY`.
- **PR isn't auto-merged** — the "Allow GitHub Actions to create and approve
  pull requests" setting is off, the PR was opened by `github-actions` (so
  `GH_PAT` wasn't picked up), or the `github.actor` guard in `auto-approve.yml`
  isn't your login.
- **No PR at all** — there is no new week to push (already done); this is normal.
