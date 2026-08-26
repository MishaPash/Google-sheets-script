#!/usr/bin/env python3
"""Push the weekly maintenance-checklist result into the GetOKRs KR.

KR: "[Leading] Complete weekly preventive office maintenance checklist
     (# of checklists completed per week)".

Flow (runs every Friday night, Florida time):
  1. Ask the bound Apps Script web app (action=maint) whether the "Form
     Responses 2" tab has at least one Google-Form response this week.
  2. Create a check-in on the KR with value 1 (a response exists) or 0 (none).
     Skipped if a check-in already exists for the current week, so re-runs are
     idempotent.
  3. Write a small report + data file so the opened PR is an audit trail.

Only the Python standard library is used (no pip install needed).

Environment variables:
  APPS_SCRIPT_URL    (secret) Apps Script /exec web-app URL (same one the
                              office-issues automation uses)
  APPS_SCRIPT_TOKEN  (secret) the WEBAPP_TOKEN Script Property value
  OKRS_API_KEY       (secret) GetOKRs API key (Bearer)
  OKRS_ORG_ID   (var, optional)  defaults to the Appodeal org id below
  OFFICE_MAINT_KR_ID (var, opt.) defaults to the KR id below
  OKRS_API_BASE (optional)   defaults to https://api.getokrs.com
  DRY_RUN       (optional)    "1" = compute + write report, do NOT call GetOKRs
  FORCE         (optional)    "1" = post even if a check-in exists this week
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# Non-secret identifiers. Override with env vars if the KR/org ever changes.
DEFAULT_ORG_ID = "6b23a391-b1cf-4f4a-8f82-151f2fb8782e"  # Appodeal
DEFAULT_KR_ID = "2d3db272-6b01-4b9d-86fb-d889ab8afbb0"   # weekly-maintenance KR
DEFAULT_API_BASE = "https://api.getokrs.com"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # office-maintenance-okr/

UA = "Mozilla/5.0 (office-maintenance-okr bot)"


def die(msg):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(1)


def http_get(url, headers=None, timeout=60):
    hdr = {"User-Agent": UA}
    hdr.update(headers or {})
    req = urllib.request.Request(url, headers=hdr, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", None) or resp.getcode()
        final_host = urllib.parse.urlparse(resp.geturl()).netloc
        return status, final_host, resp.read().decode("utf-8", "ignore")


def post_json(url, payload, headers=None, timeout=60):
    data = json.dumps(payload).encode("utf-8")
    hdr = {"Content-Type": "application/json", "User-Agent": UA}
    hdr.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=hdr, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return resp.status, (json.loads(body) if body.strip() else {})


def set_output(name, value):
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write("{}={}\n".format(name, value))
    print("output {}={}".format(name, value))


def read_maintenance():
    url = os.environ.get("APPS_SCRIPT_URL", "").strip()
    token = os.environ.get("APPS_SCRIPT_TOKEN", "").strip()
    if not url:
        die("APPS_SCRIPT_URL is not set")
    if not token:
        die("APPS_SCRIPT_TOKEN is not set")

    full = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(
        {"token": token, "action": "maint"})
    try:
        status, final_host, raw = http_get(full)
    except urllib.error.HTTPError as e:
        die("Apps Script HTTP {}: {}".format(e.code, e.read().decode("utf-8", "ignore")[:400]))
    except Exception as e:  # noqa: BLE001
        die("Apps Script request failed: {}".format(e))

    print("Apps Script: HTTP {}, final host {}, {} bytes".format(status, final_host, len(raw)))
    try:
        data = json.loads(raw)
    except ValueError:
        snippet = " ".join(raw.split())[:400] or "<empty response>"
        die("Apps Script did not return JSON. First chars: {}".format(snippet))

    if not data.get("ok"):
        die("Apps Script returned: {}".format(json.dumps(data)))
    return data


def already_checked_in_this_week(api_base, org_id, kr_id, api_key, monday_key):
    """Best-effort: True if a check-in already exists on/after this Monday (UTC)."""
    url = "{}/api/organizations/{}/okrs/{}/check-ins/".format(api_base, org_id, kr_id)
    try:
        _, _, raw = http_get(url, headers={"Authorization": "Bearer " + api_key})
        data = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        print("WARN: could not list existing check-ins ({}); will post anyway.".format(e))
        return False
    items = data.get("result", data) if isinstance(data, dict) else data
    if not isinstance(items, list):
        return False
    for it in items:
        if isinstance(it, dict):
            stamp = str(it.get("created_at") or it.get("date") or "")[:10]
            if stamp and stamp >= monday_key:
                return True
    return False


def main():
    org_id = os.environ.get("OKRS_ORG_ID", "").strip() or DEFAULT_ORG_ID
    kr_id = os.environ.get("OFFICE_MAINT_KR_ID", "").strip() or DEFAULT_KR_ID
    api_base = (os.environ.get("OKRS_API_BASE", "").strip() or DEFAULT_API_BASE).rstrip("/")
    api_key = os.environ.get("OKRS_API_KEY", "").strip()
    dry_run = os.environ.get("DRY_RUN", "0") == "1"
    force = os.environ.get("FORCE", "0") == "1"

    m = read_maintenance()
    value = 1 if int(m.get("value", 0)) >= 1 else 0
    count = m.get("count")
    week_start = m.get("week_start", "")
    week_end = m.get("week_end", "")

    now = datetime.now(timezone.utc)
    monday_key = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")

    print("Form Responses 2: {} response(s) in week {}..{} -> value {}".format(
        count, week_start, week_end, value))

    comment = (
        "Automated weekly check-in. Maintenance checklist {} this week "
        "({} form response(s) in {}..{}).".format(
            "COMPLETED" if value else "NOT completed", count, week_start, week_end)
    )

    posted = False
    skipped_reason = ""

    if dry_run:
        skipped_reason = "DRY_RUN"
        print("DRY_RUN=1 -> not calling GetOKRs.")
    else:
        if not api_key:
            die("OKRS_API_KEY is not set")
        if not force and already_checked_in_this_week(api_base, org_id, kr_id, api_key, monday_key):
            skipped_reason = "already checked in this week"
            print("A check-in already exists for the week of {} -> skipping (FORCE=1 to override).".format(monday_key))
        else:
            url = "{}/api/organizations/{}/okrs/{}/check-ins/".format(api_base, org_id, kr_id)
            payload = {"value": value, "comment": comment, "created_at": now.isoformat()}
            try:
                status, _ = post_json(url, payload, headers={"Authorization": "Bearer " + api_key})
            except urllib.error.HTTPError as e:
                die("GetOKRs HTTP {}: {}".format(e.code, e.read().decode("utf-8", "ignore")[:400]))
            except Exception as e:  # noqa: BLE001
                die("GetOKRs request failed: {}".format(e))
            print("GetOKRs check-in created (HTTP {}).".format(status))
            posted = True

    # --- audit-trail artifacts -------------------------------------------
    data_dir = os.path.join(ROOT, "data")
    reports_dir = os.path.join(ROOT, "reports")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(reports_dir, exist_ok=True)

    record = {
        "run_at_utc": now.isoformat(),
        "week_start": week_start,
        "week_end": week_end,
        "response_count": count,
        "value": value,
        "latest_response": m.get("latest_response"),
        "kr_id": kr_id,
        "org_id": org_id,
        "posted": posted,
        "skipped_reason": skipped_reason,
    }
    with open(os.path.join(data_dir, "latest.json"), "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)
        fh.write("\n")

    report_path = os.path.join(reports_dir, "{}.md".format(week_end or monday_key))
    with open(report_path, "w", encoding="utf-8") as fh:
        fh.write("# Weekly maintenance KR check-in — week ending {}\n\n".format(week_end or monday_key))
        fh.write("- **KR:** [Leading] Complete weekly preventive office maintenance checklist\n")
        fh.write("- **Value pushed:** {}\n".format(value))
        fh.write("- **Form responses this week ({}..{}):** {}\n".format(week_start, week_end, count))
        fh.write("- **Latest response:** {}\n".format(m.get("latest_response") or "—"))
        fh.write("- **Check-in posted:** {}{}\n".format(
            posted, "" if posted else " ({})".format(skipped_reason or "n/a")))
        fh.write("\n_Generated by the `office-maintenance-okr` GitHub Action._\n")

    set_output("value", str(value))
    set_output("week_end", week_end or monday_key)
    set_output("count", str(count))
    set_output("posted", "true" if posted else "false")
    set_output("changed", "true")  # always open a PR as an audit trail


if __name__ == "__main__":
    main()
