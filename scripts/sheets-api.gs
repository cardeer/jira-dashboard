/**
 * Google Apps Script backend for holidays and leaves, stored in the "jira-dashboard-db" sheet.
 *
 * Setup (once):
 * 1. In the sheet: Extensions → Apps Script, replace Code.gs with this file, save.
 * 2. Project Settings → Script properties → add API_KEY = any long random string.
 * 3. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.
 * 4. Put the /exec URL and the API_KEY in .env as VITE_SHEETS_URL and VITE_SHEETS_KEY.
 * After editing this file, use Deploy → Manage deployments → edit → New version (the URL stays).
 *
 * GET  ?key=…                                   → { ok, holidays: [...], leaves: [...] }
 * POST {key, action:'upsert', table, row}       → { ok, row }   (row without id is inserted)
 * POST {key, action:'delete', table, id}        → { ok }
 * POST bodies are sent as text/plain so the browser skips the CORS preflight Apps Script can't answer.
 */

const TABLES = {
  Holidays: ['id', 'start_date', 'end_date', 'name', 'note'],
  Leaves: ['id', 'account_id', 'name', 'start_date', 'end_date', 'start_time', 'end_time', 'type', 'note'],
};

// Reads are cached so repeated GETs skip the sheet. Writes from the app and edits made by hand
// in the sheet (onEdit below) clear it. 6 hours is the longest CacheService keeps anything.
const CACHE_KEY = 'list';
const CACHE_SECONDS = 21600;

function doGet(e) {
  return respond(() => {
    checkKey(e.parameter.key);
    const cache = CacheService.getScriptCache();
    const hit = cache.get(CACHE_KEY);
    if (hit) return JSON.parse(hit);
    const out = { holidays: readTable('Holidays'), leaves: readTable('Leaves') };
    try {
      cache.put(CACHE_KEY, JSON.stringify(out), CACHE_SECONDS);
    } catch (err) {
      // Over the 100 KB cache limit: serve uncached.
    }
    return out;
  });
}

/** Simple trigger: runs on any manual edit in the sheet. */
function onEdit() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

function doPost(e) {
  return respond(() => {
    const body = JSON.parse(e.postData.contents);
    checkKey(body.key);
    if (!TABLES[body.table]) throw new Error('Unknown table: ' + body.table);
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    CacheService.getScriptCache().remove(CACHE_KEY);
    try {
      if (body.action === 'upsert') return { row: upsert(body.table, body.row) };
      if (body.action === 'delete') {
        deleteRow(body.table, body.id);
        return {};
      }
      throw new Error('Unknown action: ' + body.action);
    } finally {
      lock.releaseLock();
    }
  });
}

function respond(fn) {
  let out;
  try {
    out = Object.assign({ ok: true }, fn());
  } catch (err) {
    out = { ok: false, error: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!expected || key !== expected) throw new Error('Unauthorized');
}

function sheet(table) {
  const s = SpreadsheetApp.getActive().getSheetByName(table);
  if (!s) throw new Error('Missing tab: ' + table);
  return s;
}

/** Cells typed by hand may come back as Date objects; the app expects yyyy-MM-dd / HH:mm strings. */
function cellToString(v, column) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(v, tz, column.endsWith('_time') ? 'HH:mm' : 'yyyy-MM-dd');
  }
  return v === null || v === undefined ? '' : String(v);
}

function readTable(table) {
  const cols = TABLES[table];
  const s = sheet(table);
  const last = s.getLastRow();
  if (last < 2) return [];
  return s
    .getRange(2, 1, last - 1, cols.length)
    .getValues()
    .filter((r) => r[0] !== '')
    .map((r) => Object.fromEntries(cols.map((c, i) => [c, cellToString(r[i], c)])));
}

function findRowIndex(s, id) {
  const last = s.getLastRow();
  if (last < 2) return -1;
  const ids = s.getRange(2, 1, last - 1, 1).getValues();
  const i = ids.findIndex((r) => String(r[0]) === String(id));
  return i < 0 ? -1 : i + 2;
}

function upsert(table, row) {
  const cols = TABLES[table];
  const s = sheet(table);
  const record = Object.assign({}, row, { id: row.id || Utilities.getUuid() });
  const values = [cols.map((c) => (record[c] === undefined || record[c] === null ? '' : String(record[c])))];
  const at = row.id ? findRowIndex(s, row.id) : -1;
  if (row.id && at < 0) throw new Error('Not found: ' + row.id);
  const target = at > 0 ? at : s.getLastRow() + 1;
  s.getRange(target, 1, 1, cols.length).setNumberFormat('@').setValues(values);
  return Object.fromEntries(cols.map((c, i) => [c, values[0][i]]));
}

function deleteRow(table, id) {
  const s = sheet(table);
  const at = findRowIndex(s, id);
  if (at < 0) throw new Error('Not found: ' + id);
  s.deleteRow(at);
}
