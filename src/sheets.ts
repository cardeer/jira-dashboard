import axios from 'axios';
import { ApiError } from './api';
import type { Holiday, Leave } from '../shared/types';

/**
 * Holidays and leaves live in a Google Sheet behind an Apps Script web app (scripts/sheets-api.gs).
 * The key only keeps out drive-by requests: it ships in the bundle, so anyone with the site can find it.
 */
const URL_ = import.meta.env.VITE_SHEETS_URL as string | undefined;
const KEY = import.meta.env.VITE_SHEETS_KEY as string | undefined;

export const sheetsConfigured = Boolean(URL_ && KEY);

type Table = 'Holidays' | 'Leaves';
type Reply<T> = ({ ok: true } & T) | { ok: false; error: string };

async function call<T>(req: Promise<{ data: Reply<T> }>): Promise<T> {
  let data: Reply<T>;
  try {
    data = (await req).data;
  } catch (e) {
    if (axios.isCancel(e)) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    throw new ApiError(0, 'Couldn’t reach the Google Sheet. Check VITE_SHEETS_URL and the Apps Script deployment.');
  }
  // Apps Script always answers 200; failures come back as { ok: false }.
  if (!data || typeof data !== 'object') throw new ApiError(0, 'The Apps Script returned an unexpected response.');
  if (!data.ok) throw new ApiError(data.error === 'Unauthorized' ? 403 : 500, data.error);
  return data;
}

function post<T>(body: object) {
  // text/plain keeps this a "simple" request: Apps Script can't answer a CORS preflight.
  return call<T>(axios.post(URL_!, JSON.stringify({ key: KEY, ...body }), { headers: { 'Content-Type': 'text/plain' } }));
}

export const sheets = {
  list: (signal?: AbortSignal) =>
    call<{ holidays: Holiday[]; leaves: Leave[] }>(axios.get(URL_!, { params: { key: KEY }, signal })),
  saveHoliday: (row: Omit<Holiday, 'id'> & { id?: string }) =>
    post<{ row: Holiday }>({ action: 'upsert', table: 'Holidays' satisfies Table, row }).then((r) => r.row),
  saveLeave: (row: Omit<Leave, 'id'> & { id?: string }) =>
    post<{ row: Leave }>({ action: 'upsert', table: 'Leaves' satisfies Table, row }).then((r) => r.row),
  remove: (table: Table, id: string) => post<object>({ action: 'delete', table, id }),
};
