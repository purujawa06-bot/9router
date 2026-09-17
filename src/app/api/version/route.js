import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

// Update source follows the purujawa06-bot fork (not upstream npm).
// Notification is tag-driven: if the newest v* tag on the fork is newer
// than the running version, an update is available.
// Override with UPDATE_CHECK_REPO=owner/repo if needed.
const UPDATE_CHECK_REPO = process.env.UPDATE_CHECK_REPO || "purujawa06-bot/9router";
const VERSION_CACHE_TTL_MS = 3600000; // cache tags lookup for 1h

// Survive hot reload; one cache per process
const versionCache = (global.__forkVersionCache ??= { value: null, fetchedAt: 0 });

// Pick the newest x.y.z from a GitHub tags list (tag names like "v0.5.76").
export function pickLatestTagVersion(tags) {
  let latest = null;
  for (const t of tags || []) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(t?.name || "");
    if (!m) continue;
    const v = `${m[1]}.${m[2]}.${m[3]}`;
    if (!latest || compareVersions(v, latest) > 0) latest = v;
  }
  return latest;
}

// Fetch newest release tag from the fork
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.github.com/repos/${UPDATE_CHECK_REPO}/tags?per_page=100`,
      {
        timeout: 8000,
        headers: {
          "User-Agent": "9router-update-check",
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(pickLatestTagVersion(JSON.parse(data)));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

async function getLatestVersionCached() {
  if (versionCache.value && Date.now() - versionCache.fetchedAt < VERSION_CACHE_TTL_MS) {
    return versionCache.value;
  }
  const latest = await fetchLatestVersion();
  if (latest) {
    versionCache.value = latest;
    versionCache.fetchedAt = Date.now();
  }
  return latest;
}

export async function GET() {
  const latestVersion = await getLatestVersionCached();
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  return Response.json({ currentVersion, latestVersion, hasUpdate });
}
