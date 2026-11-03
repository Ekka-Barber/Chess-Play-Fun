// lib/online.js — the opt-in online layer: lichess tablebase and cloud-eval lookups behind a disk cache.
// LOCAL-FIRST CONTRACT: this module never decides on its own to go online. The server routes call it only
// after settings.onlineFeatures is on AND the FEN was proven to be a position of the current game, so the
// app can never become an open proxy. Upstream trouble is always rewrapped into one honest sentence — a
// raw fetch error or an HTML error page must never reach the client.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const CLOUD_HOST = 'https://lichess.org';
// lichess.org/api/tablebase/standard now answers 404 HTML; tablebase.lichess.org is the live official host
// for the same service (lichess.org's own CSP allowlists it).
const TABLEBASE_HOST = 'https://tablebase.lichess.org';
// Lichess asks API callers to name themselves; this is a personal local app, not a crawler.
const USER_AGENT = 'chess-play-fun/4.0 (local personal chess app)';
const TIMEOUT_MS = 4000;
// Cloud evals are live snapshots of crowd-sourced analysis that keep deepening, so one day is fresh enough
// for a study tool while sparing lichess a request per click. Tablebase facts are mathematically immutable,
// so those entries are cached forever.
const CLOUD_TTL_MS = 24 * 60 * 60 * 1000;

// Errors carry an HTTP status so the server's JSON error handler needs no extra mapping per code.
class OnlineError extends Error {
  constructor(code, message, { status = 502, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OnlineError'; this.code = code; this.status = status;
  }
}

const normalizeFen = (fen) => String(fen).trim().split(/\s+/).join(' ');
// The normalized FEN is the cache identity; hashing it keeps one safe filename per position.
const cacheFile = (kind, fen) => path.join(kind, `${createHash('sha256').update(normalizeFen(fen)).digest('hex')}.json`);
// Lichess dropped the wdl field, so it is derived from category the way lichess's own UI reads it: maybe-*
// are unproven under the 50-move rule but still one-sided; cursed/blessed stay one-sided too.
const WDL = { win: 1, 'maybe-win': 1, 'cursed-win': 1, draw: 0, 'blessed-loss': -1, 'maybe-loss': -1, loss: -1 };

function mapTablebase(json) {
  const move = ({ uci, san, category, dtz, dtm }) => ({ uci, san, category, wdl: WDL[category] ?? null, dtz: dtz ?? null, dtm: dtm ?? null });
  // Lichess orders moves best-first; ten is plenty for a study panel and keeps the JSON small.
  return { category: json.category ?? 'unknown', wdl: WDL[json.category] ?? null, dtz: json.dtz ?? null, preciseDtz: json.precise_dtz ?? null, dtm: json.dtm ?? null, checkmate: Boolean(json.checkmate), stalemate: Boolean(json.stalemate), insufficientMaterial: Boolean(json.insufficient_material), moves: (json.moves ?? []).slice(0, 10).map(move) };
}
// cloud-eval cp/mate are from White's point of view (verified: after 1.e4, Black to move, cp stays +18), so
// the field keeps the app-wide whiteCp name; multiPv=1 keeps the answer to a single line.
function mapCloudEval(json) {
  return { fen: json.fen, depth: json.depth, knodes: json.knodes, pvs: (json.pvs ?? []).map(({ cp, mate, moves }) => ({ whiteCp: Number.isFinite(cp) ? cp : null, mate: Number.isFinite(mate) ? mate : null, moves: String(moves ?? '').split(' ').filter(Boolean) })) };
}

function createOnline({ cacheDir = path.join(process.cwd(), '.cache', 'online'), fetchImpl = fetch, now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  // Best-effort cache: a missing or unreadable entry is just a miss, and a failed write never fails a lookup.
  async function readCache(kind, fen) {
    try { return JSON.parse(await fsp.readFile(path.join(cacheDir, cacheFile(kind, fen)), 'utf8')); } catch { return null; }
  }
  async function writeCache(kind, fen, payload) {
    try {
      const file = path.join(cacheDir, cacheFile(kind, fen));
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, `${JSON.stringify({ cachedAt: now(), payload })}\n`);
    } catch (error) { console.warn(`[online] cache write skipped: ${error.message}`); }
  }
  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs); // a hung upstream must not hang the route
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: controller.signal });
      // A 404 is an expected "no stored answer for that position", not an upstream failure.
      if (response.status === 404) throw new OnlineError('NO_UPSTREAM_ANSWER', 'Lichess has no stored answer for that position.', { status: 404 });
      if (!response.ok) throw new OnlineError('UPSTREAM_ERROR', `Lichess answered HTTP ${response.status}. Try again later.`);
      const json = await response.json();
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new OnlineError('UPSTREAM_ERROR', 'Lichess sent an unreadable answer. Try again later.');
      return json;
    } catch (error) {
      if (error instanceof OnlineError) throw error;
      // Abort, DNS, socket reset… all collapse into one honest sentence; the cause stays attached for logs.
      throw new OnlineError('LICHESS_UNREACHABLE', 'Lichess could not be reached. Check your connection and try again.', { cause: error });
    } finally { clearTimeout(timer); }
  }
  async function tablebase(fen) {
    const cached = await readCache('tablebase', fen);
    if (cached) return { ...cached.payload, source: 'cache' }; // tablebase facts are immutable: kept forever
    const data = mapTablebase(await fetchJson(`${TABLEBASE_HOST}/standard?fen=${encodeURIComponent(normalizeFen(fen))}`));
    await writeCache('tablebase', fen, data);
    return { ...data, source: 'live' };
  }
  async function cloudEval(fen) {
    const cached = await readCache('cloud-eval', fen);
    if (cached && now() - cached.cachedAt < CLOUD_TTL_MS) return { ...cached.payload, source: 'cache' };
    const data = mapCloudEval(await fetchJson(`${CLOUD_HOST}/api/cloud-eval?fen=${encodeURIComponent(normalizeFen(fen))}&multiPv=1`));
    await writeCache('cloud-eval', fen, data);
    return { ...data, source: 'live' };
  }
  return { tablebase, cloudEval, cacheDir };
}

module.exports = { createOnline, OnlineError, CLOUD_TTL_MS };
