---
name: devcmd-release-check
description: Validate and prepare DevCmd GitHub releases. Use when reviewing release readiness, changing version or release automation, creating tags, checking installation from GitHub, or diagnosing failed commit, push, tag, or GitHub Release steps.
---

<!-- Copyright (c) 2026 bachbnt -->

# Check A Release

Treat release publication as consequential: validate first and publish only when explicitly requested.

## Workflow

1. Inspect `package.json`, `package-lock.json`, `scripts/release.sh`, `scripts/release-version.js`, `scripts/sync-release-version.js`, `commands/release.command`, `.github/workflows/`, and release tests.
2. Confirm the branch is `main`, `origin` is correct, local is not behind remote, and the target tag does not exist.
3. Confirm package and lockfile versions match the `vX.Y.Z` tag.
4. Run `npm test`, `npm pack --dry-run`, `git diff --check`, and `npm run release -- <selection> --dry-run`.
5. Verify the package exposes both `dev` and `devcmd` and excludes development-only files.
6. Test installation from the target GitHub tag in a temporary npm prefix when the tag exists.
7. Confirm the README pinned release tag matches the release being prepared and installation examples use `@bachbntdev/devcmd` or an explicit `bachbnt/dev-cmd` GitHub URL, never the unscoped `devcmd` name.
8. Review the complete release commit file list before approval.

## Publication Rules

- Never publish, push, tag, or create a GitHub Release unless the user explicitly requests it.
- Never rewrite an existing release tag.
- Do not run `npm publish` locally. npm publication happens only through `.github/workflows/publish.yml` when a GitHub Release is published and the `NPM_TOKEN` secret exists; check `gh run list --workflow publish.yml` after a release.
- Do not test with `npm install --global devcmd`; that npm registry name belongs to an unrelated project. Use the scoped name or the GitHub tag archive.
- A draft release does not publish to npm.
- Report partial external success precisely if branch push, tag push, or release creation diverge.
- Prefer generated GitHub release notes unless curated notes are provided.

## Result

Report the target version, checks run, package contents, commit scope, and whether publication was performed or only previewed.
