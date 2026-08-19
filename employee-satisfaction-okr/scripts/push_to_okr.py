#!/usr/bin/env python3
"""
Weekly office-satisfaction -> GetOKRs check-in.

Runs from the GitHub Action every Friday. Steps:
  1. Call the bound Google Apps Script web app (token-protected). It refreshes
     the "OKR Satisfaction" tab in the spreadsheet and returns the computed
     per-week satisfaction, most recent week first.
  2. Push the latest completed week's satisfaction % into the GetOKRs KR as a
     check-in (idempotent: a given week is only pushed once).
  3. Write a Markdown report + append a row to data/history.csv so the run is
     recorded in the pull request the Action opens.

Only the Python standard library is used (no pip install needed).

Environment variables (set as GitHub secrets / vars):
  APPS_SCRIPT_URL    - the Apps Script web app /exec URL          (required)
  APPS_SCRIPT_TOKEN  - shared token printed by the script setup()  (required)
  OKRS_API_KEY       - GetOKRs API key (Bearer)                    (required)
  OKRS_ORG_ID        - GetOKRs organization id     (default: Appodeal org)
  OKRS_KR_ID         - GetOKRs key-result id        (default: the satisfaction KR)
  OKRS_API_BASE      - default https://api.getokrs.com
  DRY_RUN            - "1" to skip the GetOKRs write (compute + report only)
"""

import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# --- Defaults (non-secret identifiers; overridable via env) -----------------
DEFAULT_ORG_ID = "6b23a391-b1cf-4f4a-8f82-151f2fb8782e"           # Appodeal
DEFAULT_KR_ID = "fea75b19-4c65-4071-adbb-affbaf27c0ce"            # Office satisfaction KR
DEFAULT_API_BASE = "https://api.getokrs.com"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                     # employee-satisfaction-okr/
HISTORY_CSV = os.path.join(ROOT, "data", "history.csv")
REPORTS_DIR = os.path.join(ROOT, "reports")

HISTORY_FIELDS = [
    "week_date", "polly_id", "participants", "ratings_counted",
    "scale", "avg_score", "satisfaction_pct", "pushed_at",
]


def env(name, default=None, required=False):
    val = os.environ.get(name, default)
    if required and not val:
        sys.exit(f"ERROR: missing required environment variable {name}")
    return val


def fetch_from_apps_script(url, token):
    """GET the Apps Script web app and return the parsed JSON payload."""
    full = url + ("&" if "?" in url else "?") + urllib.parse.urlencode({"token": token})
    req = urllib.request.Request(full, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit("ERROR: Apps Script did not return JSON. First 300 chars:\n" + raw[:300])
    if not data.get("ok"):
        sys.exit(f"ERROR: Apps Script returned an error: {data.get('error')}")
    return data


def load_pushed_weeks():
    """Return the set of week_date values already recorded as pushed."""
    if not os.path.exists(HISTORY_CSV):
        return set()
    with open(HISTORY_CSV, newline="", encoding="utf-8") as fh:
        return {row["week_date"] for row in csv.DictReader(fh) if row.get("week_date")}


def append_history(week, pushed_at):
    os.makedirs(os.path.dirname(HISTORY_CSV), exist_ok=True)
    exists = os.path.exists(HISTORY_CSV)
    with open(HISTORY_CSV, "a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=HISTORY_FIELDS)
        if not exists:
            writer.writeheader()
        writer.writerow({
            "week_date": week["week_date"],
            "polly_id": week["polly_id"],
            "participants": week["participants"],
            "ratings_counted": week["ratings_counted"],
            "scale": week["scale"],
            "avg_score": week["avg_score"],
            "satisfaction_pct": week["satisfaction_pct"],
            "pushed_at": pushed_at,
        })


def push_check_in(api_base, org_id, kr_id, api_key, week):
    """Create a GetOKRs check-in with the week's satisfaction %."""
    url = f"{api_base}/api/organizations/{org_id}/okrs/{kr_id}/check-ins/"
    comment = (
        f"Weekly Slack Polly office satisfaction survey "
        f"({week['week_date']}): {week['satisfaction_pct']}% "
        f"(avg {week['avg_score']}/{week['scale']}, "
        f"{week['participants']} participants, {week['ratings_counted']} ratings). "
        f"Auto-pushed from Google Sheet by GitHub Actions."
    )
    payload = {
        "value": week["satisfaction_pct"],
        "comment": comment,
        "week_update": comment,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        sys.exit(f"ERROR: GetOKRs check-in failed ({e.code}): {detail}")


def write_report(week, status_line):
    os.makedirs(REPORTS_DIR, exist_ok=True)
    path = os.path.join(REPORTS_DIR, f"{week['week_date']}.md")
    lines = [
        f"# Office satisfaction — week {week['week_date']}",
        "",
        f"- **Satisfaction:** {week['satisfaction_pct']}%",
        f"- **Average score:** {week['avg_score']} / {week['scale']}",
        f"- **Participants:** {week['participants']}",
        f"- **Ratings counted (columns J + M):** {week['ratings_counted']}",
        f"- **Polly Id:** `{week['polly_id']}`",
        f"- **GetOKRs KR:** `{env('OKRS_KR_ID', DEFAULT_KR_ID)}`",
        "",
        f"_{status_line}_",
        "",
    ]
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return path


def set_output(name, value):
    """Expose a value to later workflow steps, when running in GitHub Actions."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"{name}={value}\n")


def main():
    apps_url = env("APPS_SCRIPT_URL", required=True)
    apps_token = env("APPS_SCRIPT_TOKEN", required=True)
    api_key = env("OKRS_API_KEY", required=False)
    org_id = env("OKRS_ORG_ID", DEFAULT_ORG_ID)
    kr_id = env("OKRS_KR_ID", DEFAULT_KR_ID)
    api_base = env("OKRS_API_BASE", DEFAULT_API_BASE).rstrip("/")
    dry_run = env("DRY_RUN", "0") == "1"

    data = fetch_from_apps_script(apps_url, apps_token)
    latest = data.get("latest")
    if not latest:
        print("No weekly data with ratings found — nothing to push.")
        set_output("changed", "false")
        return

    print(f"Latest week: {latest['week_date']} -> {latest['satisfaction_pct']}% "
          f"(avg {latest['avg_score']}/{latest['scale']}, "
          f"{latest['participants']} participants)")

    already = load_pushed_weeks()
    if latest["week_date"] in already:
        print(f"Week {latest['week_date']} was already pushed — skipping (idempotent).")
        set_output("changed", "false")
        return

    if dry_run:
        status = "DRY RUN — check-in not sent to GetOKRs."
        print(status)
    elif not api_key:
        sys.exit("ERROR: OKRS_API_KEY is required unless DRY_RUN=1.")
    else:
        result = push_check_in(api_base, org_id, kr_id, api_key, latest)
        status = (f"Pushed to GetOKRs — check-in id {result.get('id')}, "
                  f"value {result.get('value')}, progress {result.get('progress')}%.")
        print(status)

    pushed_at = datetime.now(timezone.utc).isoformat()
    append_history(latest, pushed_at if not dry_run else "DRY_RUN")
    report_path = write_report(latest, status)
    print(f"Wrote report: {os.path.relpath(report_path, ROOT)}")

    set_output("changed", "true")
    set_output("week_date", latest["week_date"])
    set_output("satisfaction", str(latest["satisfaction_pct"]))


if __name__ == "__main__":
    main()
