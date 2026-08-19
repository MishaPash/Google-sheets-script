/**
 * Тонкая обёртка над Google Sheets API.
 *
 * Аутентификация — через сервис-аккаунт Google. Ключ сервис-аккаунта (JSON)
 * передаётся в переменной окружения GOOGLE_SERVICE_ACCOUNT_JSON (в GitHub —
 * это Secret). ID таблицы — в переменной SPREADSHEET_ID.
 */

import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * Читает и валидирует переменные окружения.
 * @returns {{ credentials: object, spreadsheetId: string, timeZone: string }}
 */
export function readConfig() {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (!rawKey) {
    throw new Error(
      'Не задана переменная окружения GOOGLE_SERVICE_ACCOUNT_JSON ' +
        '(JSON-ключ сервис-аккаунта Google).'
    );
  }
  if (!spreadsheetId) {
    throw new Error(
      'Не задана переменная окружения SPREADSHEET_ID (ID Google-таблицы).'
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(rawKey);
  } catch (err) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON содержит некорректный JSON: ' + err.message
    );
  }

  // Часовой пояс, в котором считаем "сегодня" и выходные. По умолчанию — UTC.
  const timeZone = process.env.TIMEZONE || 'UTC';

  return { credentials, spreadsheetId, timeZone };
}

/**
 * Создаёт авторизованный клиент Google Sheets API.
 * @param {object} credentials — распарсенный JSON-ключ сервис-аккаунта
 */
export async function createSheetsClient(credentials) {
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

/**
 * Возвращает карту "имя листа -> sheetId (gid)" и список имён листов.
 */
export async function getSheetMeta(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  });
  const byName = new Map();
  for (const s of res.data.sheets || []) {
    byName.set(s.properties.title, s.properties.sheetId);
  }
  return byName;
}

/**
 * Читает все значения листа. Возвращает массив строк (массив массивов).
 * Пустой лист -> [].
 */
export async function getValues(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return res.data.values || [];
}

/**
 * Дописывает одну строку в конец листа (аналог Apps Script appendRow).
 * Значения интерпретируются как при ручном вводе (USER_ENTERED), поэтому
 * даты и числа распознаются автоматически.
 */
export async function appendRow(sheets, spreadsheetId, sheetName, rowValues) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] },
  });
}

/**
 * Удаляет строки по их 0-индексам (индексы в массиве getValues).
 * Удаление идёт сверху вниз по убыванию индексов, чтобы индексы не сбивались.
 */
export async function deleteRows(sheets, spreadsheetId, sheetId, zeroBasedRowIndexes) {
  if (zeroBasedRowIndexes.length === 0) return;
  const sorted = [...zeroBasedRowIndexes].sort((a, b) => b - a);
  const requests = sorted.map((idx) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: idx,
        endIndex: idx + 1,
      },
    },
  }));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

/**
 * Создаёт новый лист, если его ещё нет. Возвращает sheetId.
 */
export async function ensureSheet(sheets, spreadsheetId, sheetName) {
  const meta = await getSheetMeta(sheets, spreadsheetId);
  if (meta.has(sheetName)) return meta.get(sheetName);

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}
