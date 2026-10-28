// Lazy loader for heavy optional runtime deps (playwright-core, wreq-js).
//
// They are devDependencies only, so end-user installs stay small. On first
// use the package is downloaded into <DATA_DIR>/runtime (same pattern as
// cli/hooks/sqliteRuntime.js) and imported from there. Resolution order:
// app node_modules (dev / traced standalone) → runtime dir → npm install.
//
// Never throws at import time of THIS module — failures surface from
// loadRuntimeDep() with a manual-install hint.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getWritableDataDir } from "../utils/writableDataDir.js";

// Keep in sync with package.json devDependencies.
const LAZY_DEP_VERSIONS = {
  "playwright-core": "^1.62.1",
  "wreq-js": "^3.2.0",
};

function getRuntimeDir() {
  return path.join(getWritableDataDir(), "runtime");
}

function isModuleMissing(error) {
  const code = String(error?.code || "");
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
}

function moduleNotFound(pkg) {
  const error = new Error(`Cannot find module '${pkg}'`);
  error.code = "MODULE_NOT_FOUND";
  return error;
}

// Resolve a package from <dir>/node_modules without createRequire. Webpack
// constant-folds createRequire(...) to undefined in the standalone CLI build,
// which made the old code throw "reading 'resolve'" before ever reaching the
// on-demand install. Reading the package manifest keeps this bundler-safe.
function resolveRuntimeEntry(dir, pkg) {
  const pkgDir = path.join(dir, "node_modules", pkg);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  } catch {
    throw moduleNotFound(pkg);
  }
  const exportsField = manifest.exports;
  let entry;
  if (typeof exportsField === "string") {
    entry = exportsField;
  } else if (exportsField && typeof exportsField === "object") {
    const root = exportsField["."] ?? exportsField;
    if (typeof root === "string") entry = root;
    else if (root && typeof root === "object") entry = root.import || root.default || root.require;
  }
  entry ||= manifest.module || manifest.main || "index.js";
  return pathToFileURL(path.join(pkgDir, entry)).href;
}

async function importFromRuntime(dir, pkg) {
  // webpackIgnore is essential: without it webpack replaces this dynamic import
  // with a context module that always throws MODULE_NOT_FOUND in the standalone
  // CLI, so the runtime install could never be loaded.
  return await import(/* webpackIgnore: true */ resolveRuntimeEntry(dir, pkg));
}

function npmInstall(pkg, version) {
  const cwd = getRuntimeDir();
  fs.mkdirSync(cwd, { recursive: true });
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // --prefix is required: without it npm walks up from cwd and installs into
  // an unrelated package.json's workspace (often the user's home directory),
  // leaving the runtime dir empty.
  const args = ["install", "--prefix", cwd, "--no-audit", "--no-fund", "--prefer-online", `${pkg}@${version}`];
  return new Promise((resolve) => {
    const child = spawn(npm, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolve({ ok: false, stderr: String(error.message || error) }));
    child.on("close", (status) => resolve({ ok: status === 0, stderr }));
  });
}

const inflight = new Map();

async function load(pkg) {
  // 1) Resolvable from the app install (dev machine / traced standalone).
  try {
    return await import(/* webpackIgnore: true */ pkg);
  } catch (error) {
    if (!isModuleMissing(error)) throw error;
  }
  // 2) Already present in the runtime dir from a previous install.
  try {
    return await importFromRuntime(getRuntimeDir(), pkg);
  } catch (error) {
    if (!isModuleMissing(error)) throw error;
  }
  // 3) Download on demand, then import from the runtime dir.
  const version = LAZY_DEP_VERSIONS[pkg] || "latest";
  const dir = getRuntimeDir();
  const res = await npmInstall(pkg, version);
  if (!res.ok) {
    const reason = (res.stderr.match(/npm ERR! ?(.+)/) || [])[1] || res.stderr.split("\n").filter(Boolean).pop() || "unknown npm error";
    throw new Error(
      `${pkg} is missing and the on-demand install failed (${String(reason).slice(0, 160)}) — ` +
      `install it manually: cd "${dir}" && npm install ${pkg}@${version}`
    );
  }
  return importFromRuntime(dir, pkg);
}

export function loadRuntimeDep(pkg) {
  if (!inflight.has(pkg)) {
    inflight.set(pkg, load(pkg).finally(() => inflight.delete(pkg)));
  }
  return inflight.get(pkg);
}
