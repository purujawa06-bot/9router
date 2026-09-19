# AGENTS.md — repo-level working rules

## Release process (manual, via Actions)

- NEVER create or push git tags (`v*`) automatically. Commits go to `master`
  only; releases are cut via Actions > Create Release Tag > Run workflow
  (`.github/workflows/create-release.yml`), which creates the tag + GitHub
  Release with AI-written bilingual notes.
- Publishing a GitHub Release triggers `.github/workflows/publish.yml`,
  which publishes `@rikipurpur/9router` to npm and the Docker image to
  GHCR — so a Release IS the release. It never runs on tag push.
- Version bumps (`package.json`, `cli/package.json`) only when explicitly
  asked; keep both files in sync. `publish.yml` refuses to run if the
  release tag does not match `cli/package.json`.
- npm scope is `@rikipurpur/9router` (token owner `rikipurpur`). GitHub/GHCR
  refs stay `purujawa06-bot/9router`.
