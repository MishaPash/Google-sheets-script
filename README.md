# Office Task Tracker — daily run via GitHub

The automation code lives in **Google Apps Script** (inside the spreadsheet), and
**GitHub triggers it once a day** via a secret URL. No Google Cloud project and no
service account are required — this approach works even on a corporate account
where creating Cloud projects is blocked.

## How it works

1. The spreadsheet contains `Code.gs` with the automation functions.
2. The `doGet` function is published as a Web App → you get a secret URL like
   `https://script.google.com/macros/s/.../exec`.
3. GitHub Actions opens that URL with a secret token once a day.
4. Apps Script runs the daily jobs and updates the spreadsheet.

## What the daily run does

- **`moveOldCompletedTasks`** — moves tasks with status `Completed` whose `Due date`
  is more than 7 days in the past from the `Tasks` sheet to the `Completed` sheet.
- **`logDailyOkrCompliance`** — on weekdays, computes the % of tasks completed on
  time and appends a row to the `OKR Summary` sheet (created automatically).

The **`onEdit`** function (auto-fill on manual input) keeps working inside the
spreadsheet as usual — it does not need to be changed.

## Setup (one time)

### Step 1. Pick a token

Choose any long random string — this is the "password" for the URL. For example:
`taskbot-2026-k7Qz93mLp-x8`. Write it down; you will need it twice.

### Step 2. Store the token in Apps Script

1. Spreadsheet → **Extensions → Apps Script**.
2. Left side ⚙️ **Project Settings**.
3. Section **Script Properties → Add script property**:
   - Property: `WEBAPP_TOKEN`
   - Value: your token from Step 1
   - **Save script properties**.

### Step 3. Publish the web app

1. In the Apps Script editor, top right: **Deploy → New deployment**.
2. Gear ⚙️ next to "Select type" → choose **Web app**.
3. Fill in:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. **Deploy** → approve the access request (**Authorize access**, pick your
   account, "Allow").
5. Copy the **Web app URL** (it ends with `/exec`) — needed in Step 4.

### Step 4. Add secrets in GitHub

Repository → **Settings → Secrets and variables → Actions → New repository secret**.
Create two secrets:

| Name           | Value                                       |
| -------------- | ------------------------------------------- |
| `WEBAPP_URL`   | The Web app URL from Step 3 (the `/exec` one). |
| `WEBAPP_TOKEN` | The same token as in Step 1.                |

### Step 5. Test

GitHub → **Actions → Daily Task Tracker Automation → Run workflow**.
Refresh after ~30 seconds:

- ✅ green check — it works, check the `OKR Summary` sheet in the spreadsheet;
- ❌ red cross — open the run, read "Response from Apps Script", and share the text.

After that it runs on its own every day at 06:00 UTC.

## Changing the schedule

In `.github/workflows/daily.yml`, the line `cron: '0 6 * * *'` means 06:00 **UTC**
(GitHub cron is always UTC).

## Important: re-deploying after code changes

If you **change the code** in `Code.gs`, the web app URL does **not** update
automatically. You need to: **Deploy → Manage deployments → ✏️ Edit → Version: New
version → Deploy**. The URL stays the same.
