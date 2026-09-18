# 9Router — Community Fork (purujawa06-bot)

[![npm version](https://img.shields.io/npm/v/@rikipurpur%2F9router?label=npm)](https://www.npmjs.com/package/@rikipurpur/9router)
[![npm downloads](https://img.shields.io/npm/dt/@rikipurpur%2F9router?label=downloads)](https://www.npmjs.com/package/@rikipurpur/9router)
[![GitHub tag](https://img.shields.io/github/v/tag/purujawa06-bot/9router?label=release)](https://github.com/purujawa06-bot/9router/tags)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Unofficial community fork of [decolua/9router](https://github.com/decolua/9router) — the FREE AI router & token saver.**
> This fork exists for one reason: **ship upstream fixes and community PRs faster.**
> Pull requests from the original repository are reviewed, merged, and released here as soon as they're ready —
> via npm and Docker — without waiting for the upstream release cycle.

**Never stop coding. Save 20–40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

Connect Claude Code, Codex, Cursor, Cline, Copilot, Antigravity and more to 40+ AI providers & 100+ models
through a single OpenAI-compatible endpoint (`/v1/*`).

---

## Why this fork?

| | Upstream (`decolua/9router`) | This fork (`purujawa06-bot/9router`) |
|---|---|---|
| Source of features | Original development | Synced from upstream |
| Community PRs | Wait for upstream review cycle | Merged and released as soon as verified |
| npm releases | Upstream schedule | Published on every `v*` tag, automatically |
| Docker images | Upstream schedule | Built on every `v*` tag (`ghcr.io`) |
| In-app updates | Upstream tags | Follows this fork's tags — update notifications keep working |

**In short:** upstream builds it, this fork makes sure you get it — tested, packaged, and installable — sooner.

---

## Key features

- **RTK Token Saver** — auto-compresses tool outputs (`git diff`, `grep`, `ls`…), saving 20–40% input tokens per request
- **Smart 3-tier fallback** — Subscription → Cheap → Free, automatic, zero downtime
- **Real-time quota tracking** — token usage + reset countdowns per provider
- **Format translation** — OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex and more
- **Multi-account support** — round-robin / priority routing per provider
- **OAuth + API key + FREE providers** — Claude Code, Codex, Copilot, Kiro, OpenCode Free, Vertex, GLM, MiniMax, OpenRouter, 40+ more
- **Web dashboard** — providers, combos, usage analytics, cloud sync
- **CLI with auto-update** — update notifications powered by npm, one command to upgrade

Full feature documentation lives upstream: [decolua/9router](https://github.com/decolua/9router).

---

## Install

### npm (recommended for CLI)

```bash
npm install -g @rikipurpur/9router
9router
```

Dashboard opens at `http://localhost:20128`. Upgrade anytime:

```bash
npm install -g @rikipurpur/9router@latest
```

### Docker

```bash
docker run -d --name 9router -p 20128:20128 ghcr.io/purujawa06-bot/9router:latest
```

Or with Docker Compose — see [`docker-compose.yml`](docker-compose.yml) and [`DOCKER.md`](DOCKER.md).

### From source

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Production:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

- Dashboard: `http://localhost:20128/dashboard`
- OpenAI-compatible API: `http://localhost:20128/v1`

---

## Quick start

1. **Install** (npm or Docker, see above) — dashboard opens automatically.
2. **Connect a provider** — Dashboard → Providers. For zero cost, connect **Kiro AI** or **OpenCode Free**.
3. **Point your AI tool at 9Router:**

```
Endpoint: http://localhost:20128/v1
API Key:  [copy from dashboard]
Model:    kr/claude-sonnet-4.5   (or any connected model / combo)
```

Works with Claude Code, Codex, OpenClaw, Cursor, Cline, Copilot, Antigravity, OpenCode, and any tool that supports a custom OpenAI endpoint.

4. **Stay updated** — the dashboard and CLI notify you when a new `v*` release is out. One `npm install -g` (or image pull) and you're current.

---

## Release process

- Every `v*` git tag triggers an automated release: npm package [`@rikipurpur/9router`](https://www.npmjs.com/package/@rikipurpur/9router) + Docker image (`ghcr.io/purujawa06-bot/9router`).
- Tags are created **manually** by the maintainer — no automated version bumps.
- The in-app updater checks npm first, GitHub tags as fallback.

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

---

## Contributing

PRs are welcome — especially backports of fixes from upstream and improvements to packaging (npm/Docker/CLI).

1. Fork & branch from `master`
2. Keep changes focused; add/extend tests under `tests/` where it makes sense
3. Open a PR with a clear description of what it fixes and how it was verified

---

## Credits

All core functionality is built by [decolua](https://github.com/decolua) and the upstream contributors of
[decolua/9router](https://github.com/decolua/9router) (29k+ stars). This fork only adds faster release
packaging and selected community fixes on top. Please star the upstream repo too.

## Links

- Upstream project: [decolua/9router](https://github.com/decolua/9router)
- Blog: [puruboy-api.vercel.app](https://puruboy-api.vercel.app)

## License

[MIT](LICENSE)
