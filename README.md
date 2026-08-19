# Office Task Tracker — ежедневная автоматизация через GitHub

Этот репозиторий запускает автоматизацию Google-таблицы **из GitHub Actions**
(раз в день по расписанию), а не изнутри Google Apps Script. Скрипт на Node.js
подключается к таблице через Google Sheets API и вносит в неё изменения.

## Что делает

Каждый день (по будням) GitHub Actions запускает `src/index.js`, который:

1. **Переносит старые завершённые задачи** (`moveOldCompletedTasks`) — задачи со
   статусом `Completed`, у которых с даты `Due date` прошло более 7 дней,
   перемещаются с листа `Tasks` на лист `Completed`.
2. **Считает % задач, выполненных в срок** (`logDailyOkrCompliance`) — по будням
   считает долю задач, завершённых не позже `Due date`, и дописывает строку на
   лист `OKR Summary` (лист создаётся автоматически, если его нет).

Логика полностью повторяет исходный `Code.gs`.

## Что осталось в Google Apps Script

Функция **`onEdit`** — это интерактивный триггер: он срабатывает в момент, когда
человек редактирует ячейку, и автозаполняет поля (дата получения, приоритет,
даты старта/завершения и т.д.). Такое поведение нельзя перенести на «раз в день
на GitHub», потому что оно реагирует на действия пользователя в реальном
времени. Поэтому `onEdit` **остаётся жить в `Code.gs` внутри таблицы** — просто
оставьте его там. Всю ежедневную работу теперь делает GitHub.

## Структура

```
src/index.js   — точка входа (запускается в GitHub Actions)
src/jobs.js    — бизнес-логика (перенос задач + расчёт OKR)
src/sheets.js  — обёртка над Google Sheets API (аутентификация, чтение/запись)
.github/workflows/daily.yml — расписание запуска (cron)
Code.gs        — исходный Apps Script (нужен только ради onEdit)
```

## Настройка (делается один раз)

### 1. Создать сервис-аккаунт Google

1. Откройте [Google Cloud Console](https://console.cloud.google.com/) → создайте
   (или выберите) проект.
2. **APIs & Services → Library** → включите **Google Sheets API**.
3. **APIs & Services → Credentials → Create Credentials → Service account**.
4. У созданного сервис-аккаунта: **Keys → Add key → Create new key → JSON**.
   Скачается файл-ключ (JSON). Он понадобится для секрета (шаг 3).

### 2. Дать сервис-аккаунту доступ к таблице

1. Скопируйте e-mail сервис-аккаунта (вида
   `имя@проект.iam.gserviceaccount.com`) из JSON-ключа (поле `client_email`).
2. Откройте свою Google-таблицу → **Share (Поделиться)** → добавьте этот e-mail
   с правами **Editor (Редактор)**.

### 3. Добавить секреты в GitHub

В репозитории: **Settings → Secrets and variables → Actions → New repository secret**.
Создайте два секрета:

| Имя секрета                   | Значение                                                     |
| ----------------------------- | ------------------------------------------------------------ |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Полное содержимое скачанного JSON-ключа (весь файл целиком). |
| `SPREADSHEET_ID`              | ID таблицы из её URL (см. ниже).                             |

ID таблицы — это часть URL между `/d/` и `/edit`:
```
https://docs.google.com/spreadsheets/d/  ЭТОТ_ID  /edit
```

### 4. (Опционально) Настроить часовой пояс и время запуска

В `.github/workflows/daily.yml`:

- `cron: '0 6 * * *'` — запуск каждый день в 06:00 **UTC**. Поменяйте при
  необходимости (cron в GitHub всегда в UTC).
- `TZ` и `TIMEZONE` — часовой пояс, в котором скрипт определяет «сегодня» и
  выходные (например, `Europe/Kyiv`).

## Как запустить вручную (проверка)

Вкладка **Actions → Daily Task Tracker Automation → Run workflow**. Так можно
проверить настройку, не дожидаясь расписания.

## Локальный запуск (для разработки)

```bash
npm install
export SPREADSHEET_ID="..."
export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"
npm start            # обе задачи
npm run move-old     # только перенос
npm run okr          # только OKR
```

> ⚠️ Не коммитьте JSON-ключ сервис-аккаунта в репозиторий — он в `.gitignore`.
