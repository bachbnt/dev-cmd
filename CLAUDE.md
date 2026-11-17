<!-- Copyright (c) 2026 bachbnt -->

# DevCmd Claude Code Instructions

## Project

DevCmd is a CommonJS Node.js CLI. It scaffolds projects and runs development lifecycle commands through structured child-process definitions.

## Engineering Rules

- Read the relevant implementation and tests before editing.
- Keep process execution as `{ executable, args, cwd? }`; never enable a shell or concatenate user input into command strings.
- Start every child process through `src/runner/spawn.js`. On Windows it uses `cross-spawn` so `.cmd` and `.bat` shims (npm, npx, pnpm, yarn, code, gradlew.bat) can run; that is the only sanctioned use of `cmd.exe`, and the wrapper rejects arguments containing `%` or line breaks for those shims.
- Use built-in recipes as the source of framework capabilities and `package.json` as the source of the CLI version.
- Implement framework scaffolding through `src/recipes/built-ins.json` and the recipe engine; do not add framework-specific branches to CLI handlers.
- Implement project opening through `src/openers/built-ins.json` and the opener engine; preserve `android` and `ios` aliases.
- Follow existing handlers, project adapters, and runner APIs instead of adding parallel execution paths.
- Add `// Copyright (c) 2026 bachbnt` at the beginning of new JavaScript files.
- Keep changes scoped and preserve unrelated working-tree changes.
- Update tests and README for user-visible behavior.

## Verification

Run `npm test` and `git diff --check`. For CLI behavior, also run a representative command with `--dry-run` or use a temporary project fixture.

## Skills

Reusable AI skills live in `.ai/skills`. Claude Code discovers the same canonical skills through the `.claude/skills` symlink.
