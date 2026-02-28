/** Viewer World Map - Google Apps Script (backend 100% gratuit)
 *
 * Sheet tabs needed:
 *  - visits: timestamp | pseudo | countryName | action
 *  - rate_limit: pseudo | lastTs
 *  - bans: pseudo
 *  - settings: A1=LOCK, B1=FALSE/TRUE
 *
 * Endpoints:
 *  - GET  ?route=state
 *  - POST ?route=update   body: { pseudo, countryName, action }
 */

const SHEET_VISITS = 'visits';
const SHEET_RATE = 'rate_limit';
const SHEET_BANS = 'bans';
const SHEET_SETTINGS = 'settings';

const RATE_LIMIT_SECONDS = 8; // 1 action / 8s / pseudo
const MAX_COUNTRIES_PER_USER = 400;

function doGet(e) {
  const route = (e && e.parameter && e.parameter.route) ? e.parameter.route : 'state';
  if (route === 'state') return json_(buildState_());
  if (route === 'ping') return json_({ ok: true, ts: Date.now() });
  return json_({ ok: false, error: 'Unknown route' });
}

function doPost(e) {
  const route = (e && e.parameter && e.parameter.route) ? e.parameter.route : '';
  if (route !== 'update') return json_({ ok: false, error: 'Unknown route' });

  if (isLocked_()) return json_({ ok: false, error: 'LOCKED' });

  let payload;
  try { payload = JSON.parse(e.postData.contents || '{}'); }
  catch (err) { return json_({ ok: false, error: 'Invalid JSON' }); }

  const pseudo = normalizePseudo_(payload.pseudo);
  const countryName = normalizeCountryName_(payload.countryName);
  const action = String(payload.action || '').trim().toLowerCase(); // add/remove

  if (!isValidPseudo_(pseudo)) return json_({ ok: false, error: 'INVALID_PSEUDO' });
  if (!isValidCountryName_(countryName)) return json_({ ok: false, error: 'INVALID_COUNTRY' });
  if (!(action === 'add' || action === 'remove')) return json_({ ok: false, error: 'INVALID_ACTION' });

  if (isBanned_(pseudo)) return json_({ ok: false, error: 'BANNED' });

  const now = Date.now();
  const rl = checkAndUpdateRateLimit_(pseudo, now);
  if (!rl.ok) return json_({ ok: false, error: 'RATE_LIMIT', retryAfterSec: rl.retryAfterSec });

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_VISITS) || ss.insertSheet(SHEET_VISITS);
  ensureHeaders_(sh, ['timestamp','pseudo','countryName','action']);
  sh.appendRow([new Date(now).toISOString(), pseudo, countryName, action]);

  return json_({ ok: true });
}

function buildState_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_VISITS);
  if (!sh) return { ok: true, globalCountries: [], byUser: {}, updatedAt: Date.now() };

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: true, globalCountries: [], byUser: {}, updatedAt: Date.now() };

  const header = values[0].map(String);
  const idxPseudo = header.indexOf('pseudo');
  const idxCountry = header.indexOf('countryName');
  const idxAction = header.indexOf('action');

  if (idxPseudo < 0 || idxCountry < 0 || idxAction < 0) {
    return { ok: false, error: 'Bad headers in visits sheet' };
  }

  const byUser = {}; // pseudo -> Set(countryName)
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const pseudo = normalizePseudo_(row[idxPseudo]);
    const countryName = normalizeCountryName_(row[idxCountry]);
    const action = String(row[idxAction] || '').trim().toLowerCase();

    if (!isValidPseudo_(pseudo)) continue;
    if (!isValidCountryName_(countryName)) continue;
    if (!(action === 'add' || action === 'remove')) continue;

    if (!byUser[pseudo]) byUser[pseudo] = new Set();
    if (action === 'add') byUser[pseudo].add(countryName);
    else byUser[pseudo].delete(countryName);

    if (byUser[pseudo].size > MAX_COUNTRIES_PER_USER) {
      byUser[pseudo] = new Set(Array.from(byUser[pseudo]).slice(0, MAX_COUNTRIES_PER_USER));
    }
  }

  const global = new Set();
  Object.keys(byUser).forEach(p => byUser[p].forEach(c => global.add(c)));

  const byUserObj = {};
  Object.keys(byUser).forEach(p => byUserObj[p] = Array.from(byUser[p]).sort());

  return { ok: true, globalCountries: Array.from(global).sort(), byUser: byUserObj, updatedAt: Date.now() };
}

function isLocked_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) return false;
  const v = String(sh.getRange('B1').getValue() || '').trim().toUpperCase();
  return v === 'TRUE';
}

function isBanned_(pseudo) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_BANS);
  if (!sh) return false;
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return false;

  const header = values[0].map(v => String(v).trim().toLowerCase());
  const idx = header.indexOf('pseudo');
  if (idx < 0) return false;

  for (let i = 1; i < values.length; i++) {
    const p = normalizePseudo_(values[i][idx]);
    if (p && p === pseudo) return true;
  }
  return false;
}

function checkAndUpdateRateLimit_(pseudo, nowMs) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_RATE) || ss.insertSheet(SHEET_RATE);
  ensureHeaders_(sh, ['pseudo','lastTs']);

  const values = sh.getDataRange().getValues();
  const header = values[0].map(String);
  const idxPseudo = header.indexOf('pseudo');
  const idxLast = header.indexOf('lastTs');

  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    if (normalizePseudo_(values[i][idxPseudo]) === pseudo) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    sh.appendRow([pseudo, nowMs]);
    return { ok: true };
  }

  const last = Number(sh.getRange(rowIndex, idxLast + 1).getValue() || 0);
  const diffSec = (nowMs - last) / 1000;
  if (diffSec < RATE_LIMIT_SECONDS) return { ok: false, retryAfterSec: Math.ceil(RATE_LIMIT_SECONDS - diffSec) };

  sh.getRange(rowIndex, idxLast + 1).setValue(nowMs);
  return { ok: true };
}

function ensureHeaders_(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  const existing = range.getValues()[0].map(v => String(v).trim().toLowerCase());
  const target = headers.map(h => h.trim().toLowerCase());
  let match = true;
  for (let i = 0; i < target.length; i++) if (existing[i] !== target[i]) { match = false; break; }
  if (!match) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function normalizePseudo_(s) { return String(s || '').trim().toLowerCase(); }
function isValidPseudo_(p) { return /^[a-z0-9_]{3,25}$/.test(p); }

function normalizeCountryName_(s) { return String(s || '').trim(); }
function isValidCountryName_(n) { return n.length > 0 && n.length <= 80; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
