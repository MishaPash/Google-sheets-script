#!/usr/bin/env python3
"""Push the daily "% on-time" from the OKR Summary sheet into the GetOKRs KR.

KR: "[Leading] Resolve office-related issues within deadline >= 90%".

Flow:
  1. Read column E ("% on-time") for today's date from the "OKR Summary" tab,
     via the bound Apps Script web app (returns JSON).
  2. Create a check-in on the KR in GetOKRs with that value (skipped if a
     check-in already exists for today, so re-runs are idempotent).
  3. Write a small report + data file so the opened PR is an audit trail.

Only the Python standard library is used (no pip install needed).

Environment variables:
  OFFICE_ISSUES_APPS_SCRIPT_URL    (secret) Apps Script /exec web-app URL
  OFFICE_ISSUES_APPS_SCRIPT_TOKEN  (secret) shared token (Script property OKR_TOKEN)
  OKRS_API_KEY                     (secret) GetOKRs API key (Bearer)
  OKRS_ORG_ID    (var, optional)   defaults to the Appodeal org id below
  OFFICE_ISSUES_KR_ID (var, opt.)  defaults to the KR id below
  OKRS_API_BASE  (optional)        defaults to https://api.getokrs.com
  DRY_RUN        (optional)        "1" = compute + write report, do NOT call GetOKRs
  FORCE          (optional)        "1" = post a check-in even if one exists for today
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# Non-secret identifiers. Override with env vars if the KR/org ever changes.
DEFAULT_ORG_ID = "6b23a391-b1cf-4f4a-8f82-151f2fb8782e"  # Appodeal
DEFAULT_KR_ID = "0299405b-1a72-4113-8736-7bba4eedac81"   # the office-issues KR
DEFAULT_API_BASE = "https://api.getokrs.com"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # office-issues-okr/


def die(msg):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(1)


def get_json(url, headers=None, timeout=60):
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def post_json(url, payload, headers=None, timeout=60):
    data = json.dumps(payload).encode("utf-8")
    hdr = {"Content-Type": "application/json"}
    hdr.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=hdr, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return resp.status, (json.loads(body) if body.strip() else {})


def set_output(name, value):
    """Expose a value to later GitHub Actions steps."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write("{}={}\n".format(name, value))
    print("output {}={}".format(name, value))


def read_sheet_value():
    url = os.environ.get("OFFICE_ISSUES_APPS_SCRIPT_URL", "").strip()
    token = os.environ.get("OFFICE_ISSUES_APPS_SCRIPT_TOKEN", "").strip()
    if not url:
        die("OFFICE_ISSUES_APPS_SCRIPT_URL is not set")
    if not token:
        die("OFFICE_ISSUES_APPS_SCRIPT_TOKEN is not set")

    full = url + ("&" if "?" in url else "?") + urllib.parse.urlencode({"token": token})
    try:
        data = get_json(full)
    except urllib.error.HTTPError as e:
        die("Apps Script HTTP {}: {}".format(e.code, e.read().decode("utf-8", "ignore")[:300]))
    except Exception as e:  # noqa: BLE001
        die("Apps Script request failed: {}".format(e))

    if not data.get("ok"):
        die("Apps Script returned: {}".format(json.dumps(data)))
    if data.get("value") is None:
        die("Apps Script returned no value: {}".format(json.dumps(data)))
    return data


def already_checked_in_today(api_base, org_id, kr_id, api_key, today_key):
    """Best-effort: True if a check-in already exists for today (UTC)."""
    url = "{}/api/organizations/{}/okrs/{}/check-ins/".format(api_base, org_id, kr_id)
    try:
        data = get_json(url, headers={"Authorization": "Bearer " + api_key})
    except Exception as e:  # noqa: BLE001
        print("WARN: could not list existing check-ins ({}); will post anyway.".format(e))
        return False
    items = data.get("result", data) if isinstance(data, dict) else data
    if not isinstance(items, list):
        return False
    for it in items:
        if not isinstance(it, dict):
            continue
        stamp = it.get("created_at") or it.get("date") or ""
        if str(stamp)[:10] == today_key:
            return True
    return False


def main():
    org_id = os.environ.get("OKRS_ORG_ID", "").strip() or DEFAULT_ORG_ID
    kr_id = os.environ.get("OFFICE_ISSUES_KR_ID", "").strip() or DEFAULT_KR_ID
    api_base = (os.environ.get("OKRS_API_BASE", "").strip() or DEFAULT_API_BASE).rstrip("/")
    api_key = os.environ.get("OKRS_API_KEY", "").strip()
    dry_run = os.environ.get("DRY_RUN", "0") == "1"
    force = os.environ.get("FORCE", "0") == "1"

    sheet = read_sheet_value()
    value = float(sheet["value"])
    matched_date = sheet.get("matched_date", "")
    now = datetime.now(timezone.utc)
    today_key = now.strftime("%Y-%m-%d")

    print("OKR Summary -> % on-time = {} (row dated {}, exact_today={})".format(
        value, matched_date, sheet.get("exact_today")))

    value_str = ("%g" % value)
    comment = (
        "Automated daily check-in. % on-time = {}% (OKR Summary row dated {}). "
        "Completed={} On-time={} Late={}.".format(
            value_str, matched_date or today_key,
            sheet.get("total"), sheet.get("on_time"), sheet.get("late"))
    )

    posted = False
    skipped_reason = ""

    if dry_run:
        skipped_reason = "DRY_RUN"
        print("DRY_RUN=1 -> not calling GetOKRs.")
    else:
        if not api_key:
            die("OKRS_API_KEY is not set")
        if not force and already_checked_in_today(api_base, org_id, kr_id, api_key, today_key):
            skipped_reason = "already checked in today"
            print("A check-in already exists for {} -> skipping POST (set FORCE=1 to override).".format(today_key))
        else:
            url = "{}/api/organizations/{}/okrs/{}/check-ins/".format(api_base, org_id, kr_id)
            payload = {
                "value": value,
                "comment": comment,
                "created_at": now.isoformat(),
            }
            try:
                status, resp = post_json(
                    url, payload, headers={"Authorization": "Bearer " + api_key})
            except urllib.error.HTTPError as e:
                die("GetOKRs HTTP {}: {}".format(e.code, e.read().decode("utf-8", "ignore")[:400]))
            except Exception as e:  # noqa: BLE001
                die("GetOKRs request failed: {}".format(e))
            print("GetOKRs check-in created (HTTP {}).".format(status))
            posted = True

    # --- write audit-trail artifacts -------------------------------------
    data_dir = os.path.join(ROOT, "data")
    reports_dir = os.path.join(ROOT, "reports")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(reports_dir, exist_ok=True)

    record = {
        "run_at_utc": now.isoformat(),
        "matched_date": matched_date,
        "value_percent": value,
        "total_completed": sheet.get("total"),
        "on_time": sheet.get("on_time"),
        "late": sheet.get("late"),
        "exact_today": sheet.get("exact_today"),
        "kr_id": kr_id,
        "org_id": org_id,
        "posted": posted,
        "skipped_reason": skipped_reason,
    }
    with open(os.path.join(data_dir, "latest.json"), "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)
        fh.write("\n")

    report_path = os.path.join(reports_dir, "{}.md".format(today_key))
    with open(report_path, "w", encoding="utf-8") as fh:
        fh.write("# Office-issues KR check-in — {}\n\n".format(today_key))
        fh.write("- **KR:** [Leading] Resolve office-related issues within deadline >= 90%\n")
        fh.write("- **% on-time (pushed):** {}%\n".format(value_str))
        fh.write("- **Source row date:** {}\n".format(matched_date or today_key))
        fh.write("- **Completed / On-time / Late:** {} / {} / {}\n".format(
            sheet.get("total"), sheet.get("on_time"), sheet.get("late")))
        fh.write("- **Check-in posted:** {}{}\n".format(
            posted, "" if posted else " ({})".format(skipped_reason or "n/a")))
        fh.write("\n_Generated by the `office-issues-okr` GitHub Action._\n")

    # --- GitHub Actions outputs ------------------------------------------
    set_output("value", value_str)
    set_output("date", today_key)
    set_output("matched_date", matched_date or today_key)
    set_output("posted", "true" if posted else "false")
    # Always open a PR so every daily run leaves an audit trail.
    set_output("changed", "true")


if __name__ == "__main__":
    main()
