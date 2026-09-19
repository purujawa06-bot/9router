# AGENTS.md — repo-level working rules

## Release process (manual, via Actions)

- NEVER create or push git tags (`v*`) automatically. Commits go to `master`
  only; releases are cut via Actions > Release > Run workflow
  (`.github/workflows/release.yml` — the only release workflow), which in
  one run creates the tag + GitHub Release with AI-written bilingual notes,
  then publishes `@rikipurpur/9router` to npm and the Docker image to
  GHCR — so a Release run IS the release.
- Version bumps (`package.json`, `cli/package.json`) only when explicitly
  asked; keep both files in sync. `release.yml` reads the version from
  `cli/package.json` and refuses to run if the tag already exists.
- npm scope is `@rikipurpur/9router` (token owner `rikipurpur`). GitHub/GHCR
  refs stay `purujawa06-bot/9router`.
