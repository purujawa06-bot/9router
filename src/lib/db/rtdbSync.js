// Optional Firebase Realtime Database sync — VPS auto-backup (fork feature).
//
// When enabled, the whole SQLite database is mirrored to RTDB as JSON:
//   - on server boot (restore first if local DB is empty, then push), and
//   - after every write (debounced), plus a best-effort push on shutdown.
//
// Fully optional: if no URL env is set, this module is a no-op and the app
// behaves exactly like upstream.
//
// Env contract (all optional):
//   RTDB_URL | PUBLIC_RTDB  RTDB base URL, e.g.
//                            https://xxx-default-rtdb.firebaseio.com
//   RTDB_PATH              node path inside RTDB (default: "9router")
//   RTDB_AUTH | RTDB_SECRET database secret / auth token for `?auth=` (if rules require it)
//   RTDB_DEBOUNCE_MS       delay after last write before push (default: 30000)
//   RTDB_TIMEOUT_MS        HTTP timeout per request (default: 15000)
//   RTDB_EXCLUDE_TABLES    comma list, extra tables to skip (default: "requestDetails"
//                          — huge observability log, same exclusion as file backups)
//   RTDB_RESTORE=0         skip restore-on-boot (push-only mode)
import { getAppVersion } from "./version.js";

// Tables never synced (large, non-critical, auto-pruned observability log).
const DEFAULT_EXCLUDE_TABLES = ["requestDetails"];

const ENCODE_MAP = { "%": "%25", ".": "%2E", "$": "%24", "#": "%23", "[": "%5B", "]": "%5D", "/": "%2F" };
const DECODE_MAP = { "%25": "%", "%2E": ".", "%24": "$", "%23": "#", "%5B": "[", "%5D": "]", "%2F": "/" };

// RTDB forbids . $ # [ ] / (and %) in keys — percent-encode them.
export function encodeRtdbKey(key) {
  return String(key).replace(/[%.$#[\]/]/g, (c) => ENCODE_MAP[c]);
}

export function decodeRtdbKey(key) {
  return String(key).replace(/%(25|2E|24|23|5B|5D|2F)/gi, (m) => DECODE_MAP[m.toUpperCase()] ?? m);
}

export function sanitizeForRtdb(value) {
  if (Array.isArray(value)) return value.map(sanitizeForRtdb);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[encodeRtdbKey(k)] = sanitizeForRtdb(v);
    return out;
  }
  return value;
}

export function desanitizeFromRtdb(value) {
  if (Array.isArray(value)) return value.map(desanitizeFromRtdb);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[decodeRtdbKey(k)] = desanitizeFromRtdb(v);
    return out;
  }
  return value;
}

function parseNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getRtdbConfig() {
  const baseUrl = (process.env.RTDB_URL || process.env.PUBLIC_RTDB || "").trim()
    .replace(/\/+$/, "")
    .replace(/\.json$/, "");
  if (!baseUrl) return { enabled: false };
  const extraExclude = (process.env.RTDB_EXCLUDE_TABLES || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return {
    enabled: true,
    baseUrl,
    path: (process.env.RTDB_PATH || "9router").trim().replace(/^\/+|\/+$/g, "") || "9router",
    auth: process.env.RTDB_AUTH || process.env.RTDB_SECRET || "",
    debounceMs: parseNumberEnv("RTDB_DEBOUNCE_MS", 30000),
    timeoutMs: parseNumberEnv("RTDB_TIMEOUT_MS", 15000),
    excludeTables: new Set([...DEFAULT_EXCLUDE_TABLES, ...extraExclude]),
    restoreOnBoot: process.env.RTDB_RESTORE !== "0",
  };
}

export function isRtdbEnabled() {
  return getRtdbConfig().enabled;
}

function nodeUrl(config) {
  const auth = config.auth ? `?auth=${encodeURIComponent(config.auth)}` : "";
  return `${config.baseUrl}/${config.path}.json${auth}`;
}

async function fetchWithTimeout(url, options = {}) {
  const config = getRtdbConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Full DB dump: { [table]: [rows] }. Generic over sqlite_master so it stays
// correct across future schema changes without per-table code.
export function dumpDatabase(adapter, excludeTables = new Set(DEFAULT_EXCLUDE_TABLES)) {
  const tables = adapter
    .all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .map((t) => t.name)
    .filter((name) => !excludeTables.has(name));
  const out = {};
  for (const table of tables) {
    out[table] = adapter.all(`SELECT * FROM "${table.replace(/"/g, '""')}"`);
  }
  return out;
}

export function restoreDatabase(adapter, dump) {
  if (!dump || typeof dump !== "object") throw new Error("[RTDB] invalid restore payload");
  const entries = Object.entries(dump);
  adapter.exec(`PRAGMA foreign_keys = OFF`);
  try {
    adapter.transaction(() => {
      for (const [table, rows] of entries) {
        const safe = table.replace(/"/g, '""');
        adapter.exec(`DELETE FROM "${safe}"`);
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const cols = Object.keys(rows[0]);
        const colList = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
        const placeholders = cols.map(() => "?").join(", ");
        for (const row of rows) {
          adapter.run(
            `INSERT OR REPLACE INTO "${safe}" (${colList}) VALUES (${placeholders})`,
            cols.map((c) => row[c] ?? null)
          );
        }
      }
    });
  } finally {
    adapter.exec(`PRAGMA foreign_keys = ON`);
  }
  return entries.reduce((n, [, rows]) => n + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function isLocalDbEmpty(adapter) {
  const tables = adapter
    .all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .map((t) => t.name);
  return tables.every((table) => {
    const row = adapter.get(`SELECT COUNT(*) AS n FROM "${table.replace(/"/g, '""')}"`);
    return !row || row.n === 0;
  });
}

export async function pushToRtdb(adapter) {
  const config = getRtdbConfig();
  if (!config.enabled) return null;
  const source = adapter || (await getAdapter());
  const dump = dumpDatabase(source, config.excludeTables);
  const tableCount = Object.keys(dump).length;
  const rowCount = Object.values(dump).reduce((n, rows) => n + rows.length, 0);
  const payload = {
    v: 1,
    app: "9router",
    appVersion: getAppVersion(),
    updatedAt: new Date().toISOString(),
    db: sanitizeForRtdb(dump),
  };
  const body = JSON.stringify(payload);
  const res = await fetchWithTimeout(nodeUrl(config), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`[RTDB] push failed: HTTP ${res.status}`);
  console.log(`[RTDB] pushed ${tableCount} tables (${rowCount} rows, ${(body.length / 1024).toFixed(1)} KB) → ${config.baseUrl}/${config.path}`);
  return { tableCount, rowCount, bytes: body.length };
}

async function getAdapter() {
  const { getAdapter } = await import("./driver.js");
  return getAdapter();
}

export async function pullFromRtdb() {
  const config = getRtdbConfig();
  if (!config.enabled) return null;
  let res;
  try {
    res = await fetchWithTimeout(nodeUrl(config), { method: "GET" });
  } catch (e) {
    console.warn(`[RTDB] pull failed: ${e.message}`);
    return null;
  }
  if (!res.ok) {
    console.warn(`[RTDB] pull failed: HTTP ${res.status}`);
    return null;
  }
  const json = await res.json().catch(() => null);
  if (!json || typeof json !== "object" || !json.db || typeof json.db !== "object") return null;
  return { ...json, db: desanitizeFromRtdb(json.db) };
}

// ---- adapter binding / debounce -------------------------------------------

let boundAdapter = null;
let debounceTimer = null;
let pushInFlight = false;
let repushRequested = false;
let shutdownHooked = false;

async function pushNow() {
  if (pushInFlight) {
    repushRequested = true;
    return;
  }
  pushInFlight = true;
  try {
    await pushToRtdb(boundAdapter);
  } catch (e) {
    console.warn(e.message || "[RTDB] push failed");
  } finally {
    pushInFlight = false;
    if (repushRequested) {
      repushRequested = false;
      await pushNow();
    }
  }
}

export function notifyRtdbChanged() {
  const config = getRtdbConfig();
  if (!config.enabled || !boundAdapter) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pushNow();
  }, config.debounceMs);
  if (typeof debounceTimer.unref === "function") debounceTimer.unref();
}

// Test helper: cancel pending debounce and push immediately.
export async function flushRtdbNow() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await pushNow();
}

// Test helper: reset module state (fresh import via vi.resetModules is preferred).
export function __resetRtdbStateForTests() {
  boundAdapter = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  pushInFlight = false;
  repushRequested = false;
}

function hookShutdown() {
  if (shutdownHooked) return;
  shutdownHooked = true;
  // Best-effort: fire the pending push immediately on shutdown. The process
  // may exit before it lands — the debounced change-sync above is the real
  // safety bound, this just narrows the window.
  const flush = () => {
    if (!getRtdbConfig().enabled || !boundAdapter) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pushNow();
  };
  process.once("SIGINT", flush);
  process.once("SIGTERM", flush);
}

function wrapAdapter(adapter) {
  return {
    ...adapter,
    run(sql, params) {
      const out = adapter.run(sql, params);
      notifyRtdbChanged();
      return out;
    },
    exec(sql) {
      const out = adapter.exec(sql);
      notifyRtdbChanged();
      return out;
    },
    transaction(fn) {
      const out = adapter.transaction(fn);
      notifyRtdbChanged();
      return out;
    },
  };
}

// Called once from driver.js after the adapter + migrations are ready.
// `fresh` comes from migrate.js (true = DB file had no _meta on entry,
// i.e. brand-new / wiped volume). Returns the adapter to use (wrapped when
// RTDB is enabled).
export async function rtdbOnAdapterReady(adapter, { fresh } = {}) {
  const config = getRtdbConfig();
  if (!config.enabled) return adapter;

  console.log(`[RTDB] sync enabled → ${config.baseUrl}/${config.path} (debounce ${config.debounceMs}ms)`);

  // Restore first: fresh VPS / wiped volume + existing remote backup → pull it.
  // (`fresh` is captured by migrate.js BEFORE _meta is stamped — checking row
  // counts here would misclassify a new DB, since migrations seed _meta.)
  const isFresh = fresh === true ? true : fresh === false ? false : isLocalDbEmpty(adapter);
  if (config.restoreOnBoot && isFresh) {
    try {
      const remote = await pullFromRtdb();
      const remoteRows = remote ? Object.values(remote.db).reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0) : 0;
      if (remote && remoteRows > 0) {
        const restored = restoreDatabase(adapter, remote.db);
        console.log(`[RTDB] restored ${restored} rows from remote backup (updated ${remote.updatedAt || "unknown"})`);
      } else {
        console.log("[RTDB] local DB empty, no remote backup found — starting fresh");
      }
    } catch (e) {
      console.warn(`[RTDB] restore skipped: ${e.message}`);
    }
  }

  // Push current state so the remote is fresh right after boot.
  try {
    await pushToRtdb(adapter);
  } catch (e) {
    console.warn(e.message || "[RTDB] initial push failed");
  }

  boundAdapter = adapter;
  hookShutdown();
  return wrapAdapter(adapter);
}
