# AGENTS.md — repo-level working rules

## Release process (manual tags)

- NEVER create or push git tags (`v*`) automatically. Commits go to `master`
  only; the user creates/pushes release tags manually.
- Pushing a `v*` tag triggers `.github/workflows/publish-npm.yml`, which
  publishes `@rikipurpur/9router` to npm — so a tag push IS a release.
- Version bumps (`package.json`, `cli/package.json`) only when explicitly
  asked; keep both files in sync.
- npm scope is `@rikipurpur/9router` (token owner `rikipurpur`). GitHub/GHCR
  refs stay `purujawa06-bot/9router`.
