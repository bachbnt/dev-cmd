---
name: devcmd-add-lifecycle-adapter
description: Add or update DevCmd project detection and lifecycle behavior. Use when supporting a new project type, adding or changing a lifecycle action, workspace filtering, .devcmd.json profile behavior, or fixing inconsistencies between project inspection and command execution.
---

<!-- Copyright (c) 2026 bachbnt -->

# Add A Lifecycle Adapter

Implement detection and lifecycle actions through the shared project adapter architecture.

## Workflow

1. Inspect `src/constants.js`, `src/recipes/schema.js`, `src/recipes/engine.js`, `src/openers/`, `src/projects/detect.js`, `src/projects/workspaces.js`, `src/projects/profile.js`, `src/projects/adapters/`, `src/commands/lifecycle.js`, inspection, and lifecycle tests.
2. Prefer recipe detection rules and lifecycle actions for custom project types; use a named adapter only for shared behavior that cannot remain declarative.
3. Resolve declarative recipe actions through the recipe engine and named adapter actions through the shared adapter registry; both must produce `{ executable, args, cwd? }` commands.
4. Return an explicit unsupported reason for unavailable actions instead of inventing a fallback.
5. Register the adapter once so inspect and execution resolve through the same implementation.
6. Add fixtures covering detection from both the project root and a child directory.
7. Test every supported action and at least one unsupported action.
8. When changing `dev open`, use the opener registry for IDE selection and preserve recipe-defined open actions unless the user selects an explicit opener.
9. Add a new lifecycle action once to `LIFECYCLE_COMMANDS` in `src/constants.js`; recipe schema validation, inspect, MCP, help, and completion derive from it. Implement it in each adapter that supports it and let the rest fall through to `unsupported`.
10. Adapters receive `{ config, filter, fix, trustFile }`. Workspace targeting (`--filter`) belongs to the node adapter only and must reject actions that cannot be filtered; other adapters must refuse `--filter` through `buildLifecycleCommands`.
11. `.devcmd.json` overrides are resolved in `buildLifecycleCommands` before the adapter. They must stay behind the trust check in `src/projects/profile.js` and reuse the recipe engine so shell executables are rejected.

## Guardrails

- Prefer project-local tools and virtual environments.
- Never use shell command strings or `shell: true`.
- Avoid false-positive detection from nested mobile directories.
- Keep clean operations restricted to known generated paths.
- Never let a profile, task, or workspace filter bypass the trust check or the `{ executable, args, cwd? }` command shape.
- Update README, help, completion, and the MCP tool descriptions when lifecycle behavior becomes user-visible.

## Verify

Run `npm test`, `dev inspect <fixture>`, a representative lifecycle dry run, and `git diff --check`.
