# Misha OKR automations

Monorepo of GitHub-driven automations that push metrics into GetOKRs key
results. Each automation lives in its own top-level folder and has its own
GitHub Actions workflow.

## Layout

```
.
├── .github/workflows/
│   ├── auto-approve.yml          # shared: auto-approves & merges my PRs
│   ├── office-satisfaction.yml   # workflow for the office-satisfaction automation
│   └── <next-automation>.yml     # one workflow per automation
│
├── office-satisfaction/          # automation #1 — office satisfaction rate ≥90%
│   ├── README.md                 # what it does + setup
│   ├── apps-script/              # Google Apps Script (lives in the Sheet; copy here for reference)
│   │   ├── Code.gs
│   │   └── appsscript.json
│   ├── scripts/push_to_okr.py    # run by the workflow: compute + GetOKRs check-in
│   ├── data/history.csv          # pushed-weeks history (idempotency)
│   └── reports/                  # per-week markdown reports
│
└── <next-automation>/            # automation #2, #3, … same shape
```

## Conventions for a new automation

1. Create a folder `<name>/` with `scripts/`, `data/`, `reports/`, and a
   `README.md`. Keep everything self-contained in that folder.
2. Add `.github/workflows/<name>.yml` (workflows must live at the repo root).
   Point its run step at `<name>/scripts/...` and its PR `add-paths` at
   `<name>/reports/**` and `<name>/data/**`. Use a unique PR `branch:` name.
3. Reuse the shared secrets where possible: `OKRS_API_KEY`, `GH_PAT`. Add
   per-automation secrets only when needed (e.g. `APPS_SCRIPT_URL`).
4. `auto-approve.yml` is shared — it auto-approves and merges any PR opened by
   the owner account, so every automation's weekly PR merges itself.

## Automations

| Folder | KR | Cadence | Source |
|---|---|---|---|
| `office-satisfaction/` | `[Lagging] Achieve an employee satisfaction rate of at least 90%` | Weekly (Fri) | Slack Polly office survey (Google Sheet) |

## One-time repository setup

- **Secrets** (Settings → Secrets and variables → Actions): `OKRS_API_KEY`,
  `GH_PAT`, plus per-automation secrets (`APPS_SCRIPT_URL`, `APPS_SCRIPT_TOKEN`).
- **Settings → Actions → General → Workflow permissions:** *Read and write* +
  *Allow GitHub Actions to create and approve pull requests*.
- In `auto-approve.yml`, set the guarded login (`github.actor == '...'`).

See each automation's own `README.md` for its specific setup.
