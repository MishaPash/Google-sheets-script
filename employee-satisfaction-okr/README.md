# Employee Satisfaction OKR — автоматизация

Каждую пятницу автоматически:

1. читает еженедельный опрос удовлетворённости офисом (Slack Polly) из
   Google-таблицы,
2. считает процент удовлетворённости по неделям и пишет их в **отдельный лист
   `OKR Satisfaction`** в той же таблице,
3. отправляет значение за **последнюю завершённую неделю** в GetOKRs как
   check-in в KR
   *«[Lagging] Achieve an employee satisfaction rate of at least 90% …»*,
4. открывает pull request с отчётом (для аудита).

```
Google Sheet ──(читает как владелец)──> Apps Script (Web App)
                                          │ считает % по неделям
                                          │ пишет лист "OKR Satisfaction"
                                          └── отдаёт JSON последней недели
                                                     ▲  (token)
                     GitHub Action (пятница, cron) ──┘
                           │ POST check-in → GetOKRs (Bearer API key)
                           └── открывает PR с отчётом
```

Service account **не нужен**: Apps Script выполняется от имени владельца
таблицы и читает/пишет её напрямую.

## Формула

Для каждой недели (одинаковый **Polly Id**, колонка A) берутся все заполненные
числовые оценки из колонок **J** («How would you rate your office experience
this week?») и **M** («How quickly were office issues resolved this week?»):

```
удовлетворённость % = сумма_оценок / (макс_балл × количество_оценок) × 100
```

- Если все проголосовали 5 по 5-балльной шкале → 100%.
- Шкала (5 или 10) определяется автоматически по неделе: если в неделе есть
  оценка > 5, считается 10-балльной (так корректно обрабатываются старые
  10-балльные опросы).

Пример реальных данных: неделя `2026-08-17` → 100%, `2026-07-06` → 92%,
`2026-04-24` (10-балльная) → 98.6%.

## Файлы

| Файл | Назначение |
|---|---|
| `apps-script/Code.gs` | Apps Script: расчёт, запись листа `OKR Satisfaction`, веб-эндпоинт |
| `apps-script/appsscript.json` | Манифест Apps Script (веб-приложение) |
| `scripts/push_to_okr.py` | Скрипт Action: дергает Apps Script, пишет check-in, формирует отчёт |
| `../.github/workflows/employee-satisfaction-okr.yml` | Расписание (пятница) + открытие PR |
| `data/history.csv` | История отправленных недель (заполняется автоматически, идемпотентность) |
| `reports/*.md` | Понедельные отчёты (создаются автоматически) |

---

## Настройка (один раз)

### Часть A. Google Apps Script (~5 минут)

1. Открой таблицу → **Extensions → Apps Script**.
2. Вставь содержимое `apps-script/Code.gs` в файл `Code.gs`.
   Если хочешь, включи манифест: **Project Settings → «Show appsscript.json»**,
   затем вставь `apps-script/appsscript.json`.
3. Выбери функцию **`setup`** и нажми **Run**. Разреши доступ (authorize).
   В логе (**View → Logs**) появится строка `API_TOKEN = …` — **скопируй токен**.
4. **Deploy → New deployment → тип «Web app»**:
   - *Execute as:* **Me** (владелец таблицы),
   - *Who has access:* **Anyone**.
   - Нажми **Deploy**, скопируй **Web app URL** (заканчивается на `/exec`).
5. (Опционально) проверь в браузере: `<URL>?token=<токен>` — должен вернуться
   JSON `{"ok":true,...}`, а в таблице появится лист **`OKR Satisfaction`**.

> Токен также сохранён в Script Properties (ключ `API_TOKEN`). Повторный запуск
> `setup` его не меняет.

### Часть B. GitHub Secrets

В репозитории → **Settings → Secrets and variables → Actions → New repository
secret** добавь:

| Secret | Значение |
|---|---|
| `APPS_SCRIPT_URL` | Web app URL из шага A.4 (`…/exec`) |
| `APPS_SCRIPT_TOKEN` | токен из шага A.3 |
| `OKRS_API_KEY` | API-ключ GetOKRs (создаётся в GetOKRs → настройки → API keys) |

Идентификаторы KR/организации уже зашиты в `scripts/push_to_okr.py` по
умолчанию. Если нужно переопределить — добавь **Variables** (не Secrets)
`OKRS_ORG_ID` и `OKRS_KR_ID`.

### Часть C. Проверка

**Actions → «Employee satisfaction OKR (weekly)» → Run workflow**.
Для безопасной проверки поставь галочку **dry_run = true** — тогда посчитается
всё и откроется PR, но запись в GetOKRs не произойдёт. Убедившись, что числа
верны, запусти без dry_run (или дождись пятницы).

---

## Авто-одобрение и авто-мёрдж PR

`../.github/workflows/auto-approve.yml` автоматически одобряет и мёрджит
**любой PR, открытый указанным аккаунтом** (`github.actor == 'MishaPash'`), —
как в `appodeal/appodeal-pulse`. По согласованию с DevOps auto-approve своих
PR разрешён при работе в одиночку.

Почему так (правило двух личностей):
- GitHub запрещает одобрять свой же PR — значит открывает PR один аккаунт, а
  одобряет **другой**. Здесь PR открывает пользователь, а одобряет
  `github-actions[bot]`.
- PR, созданный дефолтным `GITHUB_TOKEN`, вообще не триггерит этот workflow.
  Поэтому автоматизация должна открывать PR под **PAT** нужного аккаунта.

Настройка:
1. Создай **fine-grained PAT** (доступ к репо: *Contents: R/W*,
   *Pull requests: R/W*) → секрет **`GH_PAT`**. Тогда еженедельный PR откроется
   от твоего имени и попадёт под auto-approve (и зачтётся в Culture Health как
   твой PR).
2. Включи **Settings → Actions → General → Allow GitHub Actions to create and
   approve pull requests**.
3. Убедись, что branch protection принимает одобрение `github-actions[bot]`
   (1 required review, без обязательных CODEOWNERS). Если правило строже —
   добавь аккаунт/GitHub App в **Bypass list** ruleset'а.

Запись в GetOKRs от мёрджа PR не зависит — она происходит в самом прогоне.

## Как это работает еженедельно

- Расписание: `cron: '0 15 * * 5'` — пятница 15:00 UTC. Изменить — в
  `../.github/workflows/employee-satisfaction-okr.yml`.
- Каждый запуск отправляет **только новую** неделю. Если неделя уже была
  отправлена (есть в `data/history.csv`), запись в GetOKRs и PR пропускаются —
  повторные запуски безопасны (идемпотентность).
- Полный список недель всегда доступен на листе `OKR Satisfaction` в таблице.

## Отладка

- **Apps Script вернул не JSON / `unauthorized`** — не совпал токен
  (`APPS_SCRIPT_TOKEN` ≠ Script Property `API_TOKEN`) или деплой сделан не как
  «Anyone».
- **GetOKRs 401/403** — недействительный `OKRS_API_KEY`.
- **PR не создался** — значит новых недель нет (уже отправлено) — это норма.

## Локальный прогон

```bash
export APPS_SCRIPT_URL='https://script.google.com/macros/s/XXX/exec'
export APPS_SCRIPT_TOKEN='...'
export OKRS_API_KEY='...'
export DRY_RUN=1   # не писать в GetOKRs
python employee-satisfaction-okr/scripts/push_to_okr.py
```
