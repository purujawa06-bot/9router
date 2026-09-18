// RTDB sync (fork feature) — boot push, change push, restart restore.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const RTDB_URL = "https://test-9router-default-rtdb.firebaseio.com";

let tempDir;
let fetchMock;
let sigintBefore = [];
let sigtermBefore = [];

function freshTempDir() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-rtdb-"));
  process.env.DATA_DIR = tempDir;
}

async function freshImports() {
  delete globalThis._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  const rtdb = await import("@/lib/db/rtdbSync.js");
  return { db, rtdb };
}

function mockFetch({ getBody = null } = {}) {
  const calls = [];
  fetchMock = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    if ((options.method || "GET") === "GET") {
      return { ok: true, status: 200, json: async () => getBody };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RTDB_URL;
  delete process.env.PUBLIC_RTDB;
  delete process.env.RTDB_PATH;
  delete process.env.RTDB_AUTH;
  delete process.env.RTDB_DEBOUNCE_MS;
  delete process.env.RTDB_RESTORE;
  sigintBefore = process.listeners("SIGINT").slice();
  sigtermBefore = process.listeners("SIGTERM").slice();
  freshTempDir();
});

afterEach(async () => {
  // Close the open sqlite handle (else rmSync → EPERM on Windows) and drop
  // shutdown listeners registered by the fresh rtdb module instance.
  try {
    const { getAdapterSync } = await import("@/lib/db/driver.js");
    try { getAdapterSync().close?.(); } catch {}
  } catch {}
  for (const l of process.listeners("SIGINT")) {
    if (!sigintBefore.includes(l)) process.removeListener("SIGINT", l);
  }
  for (const l of process.listeners("SIGTERM")) {
    if (!sigtermBefore.includes(l)) process.removeListener("SIGTERM", l);
  }
  vi.unstubAllGlobals();
  delete globalThis._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("RTDB sync — disabled by default", () => {
  it("no env → no fetch calls on boot or write", async () => {
    const calls = mockFetch();
    const { db, rtdb } = await freshImports();
    expect(rtdb.isRtdbEnabled()).toBe(false);
    await db.initDb();
    await db.updateSettings({ theme: "dark" });
    await db.createCombo({ name: "c1", models: ["openai:gpt-4"] });
    expect(calls.length).toBe(0);
  });
});

describe("RTDB sync — enabled", () => {
  it("boot pushes full dump via PUT to <url>/<path>.json", async () => {
    process.env.RTDB_URL = RTDB_URL;
    const calls = mockFetch({ getBody: null });
    const { db } = await freshImports();
    await db.initDb();
    await db.createCombo({ name: "c1", models: ["openai:gpt-4"] });
    // Boot push happens inside initDb (local empty + no remote → fresh + push)
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.length).toBeGreaterThanOrEqual(1);
    expect(puts[0].url).toBe(`${RTDB_URL}/9router.json`);
    const payload = JSON.parse(puts[0].body);
    expect(payload.app).toBe("9router");
    expect(payload.v).toBe(1);
    expect(typeof payload.updatedAt).toBe("string");
    expect(Array.isArray(payload.db.combos)).toBe(true);
  });

  it("PUBLIC_RTDB alias + RTDB_PATH + auth query are honored", async () => {
    process.env.PUBLIC_RTDB = `${RTDB_URL}/`;
    process.env.RTDB_PATH = "vps1";
    process.env.RTDB_AUTH = "secret-token";
    const calls = mockFetch({ getBody: null });
    const { db, rtdb } = await freshImports();
    expect(rtdb.isRtdbEnabled()).toBe(true);
    await db.initDb();
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.length).toBeGreaterThanOrEqual(1);
    expect(puts[0].url).toBe(`${RTDB_URL}/vps1.json?auth=secret-token`);
  });

  it("write after boot triggers debounced push automatically", async () => {
    process.env.RTDB_URL = RTDB_URL;
    process.env.RTDB_DEBOUNCE_MS = "40";
    const calls = mockFetch({ getBody: null });
    const { db } = await freshImports();
    await db.initDb();
    const putsAfterBoot = calls.filter((c) => c.method === "PUT").length;
    await db.createCombo({ name: "auto", models: [] });
    await new Promise((r) => setTimeout(r, 400));
    const putsAfterWrite = calls.filter((c) => c.method === "PUT").length;
    expect(putsAfterWrite).toBeGreaterThan(putsAfterBoot);
    const last = JSON.parse(calls.filter((c) => c.method === "PUT").at(-1).body);
    expect(last.db.combos.some((c) => c.name === "auto")).toBe(true);
  });

  it("restart with empty local DB restores rows from remote backup", async () => {
    process.env.RTDB_URL = RTDB_URL;
    const bootCalls = mockFetch({ getBody: null });
    let { db } = await freshImports();
    await db.initDb();
    await db.createCombo({ name: "keep-me", models: ["openai:gpt-4"] });
    await db.updateSettings({ locale: "id" });
    const rtdb = await import("@/lib/db/rtdbSync.js");
    await rtdb.flushRtdbNow();
    const lastPut = bootCalls.filter((c) => c.method === "PUT").at(-1);
    expect(lastPut).toBeDefined();
    const remoteBody = JSON.parse(lastPut.body);

    // Simulate VPS wipe: close sqlite handle, then brand-new empty data dir.
    const { getAdapterSync } = await import("@/lib/db/driver.js");
    getAdapterSync().close?.();
    fs.rmSync(tempDir, { recursive: true, force: true });
    freshTempDir();
    mockFetch({ getBody: remoteBody });
    ({ db } = await freshImports());
    await db.initDb();
    const combos = await db.getCombos();
    expect(combos.some((c) => c.name === "keep-me")).toBe(true);
    const settings = await db.getSettings();
    expect(settings.locale).toBe("id");
  });

  it("RTDB_RESTORE=0 skips restore (push-only mode)", async () => {
    process.env.RTDB_URL = RTDB_URL;
    process.env.RTDB_RESTORE = "0";
    const remoteBody = { v: 1, app: "9router", db: { combos: [{ id: "x", name: "remote", kind: null, models: "[]", createdAt: "t", updatedAt: "t" }] } };
    mockFetch({ getBody: remoteBody });
    const { db } = await freshImports();
    await db.initDb();
    const combos = await db.getCombos();
    expect(combos.some((c) => c.name === "remote")).toBe(false);
    delete process.env.RTDB_RESTORE;
  });
});

describe("RTDB key sanitization", () => {
  it("forbidden chars round-trip", async () => {
    const { rtdb } = await freshImports();
    const keys = ["gpt-4o.mini", "a$b", "a#b", "a[b]", "a/b", "100%"];
    for (const k of keys) {
      expect(rtdb.decodeRtdbKey(rtdb.encodeRtdbKey(k))).toBe(k);
      // Encoded form must not contain RTDB-forbidden chars (. $ # [ ] /).
      // ("%" is the escape char itself, so it legitimately appears.)
      expect(/[.$#[\]/]/.test(rtdb.encodeRtdbKey(k))).toBe(false);
    }
    const nested = { "a.b": [{ "x/y": 1 }], plain: 2 };
    expect(rtdb.desanitizeFromRtdb(rtdb.sanitizeForRtdb(nested))).toEqual(nested);
  });
});
