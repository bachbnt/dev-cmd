---
name: devcmd-review-command-safety
description: Audit DevCmd command parsing, validation, process execution, history replay, and filesystem operations for injection or unsafe behavior. Use for security reviews, changes involving child processes or user input, and fixes related to shell injection, path traversal, signals, or destructive cleanup.
---

<!-- Copyright (c) 2026 bachbnt -->

# Review Command Safety

Review untrusted input from parsing through process execution and persisted replay.

## Review Order

1. Trace inputs through `src/utils/args.js`, handlers, command builders, and `src/runner/`.
2. Confirm processes use structured `{ executable, args, cwd? }` values and never enable the child-process `shell` option.
3. Include recipe and opener loading, placeholder resolution, file destinations, copy sources, executable mappings, user overrides, `.devcmd.json` profiles and their trust hashes in `~/.devcmd/trusted.json`, workspace `--filter` values, and MCP tool arguments in the input trace.
4. Check project names, paths, executable overrides, history entries, and config values before use.
5. Verify formatting functions are display-only and never become executable input.
6. Review clean/delete behavior for root escape, symlink, and overbroad deletion risks.
7. Check missing executable handling, child exit codes, `SIGINT`, and `SIGTERM` forwarding, including the parallel runner and MCP background processes (`stop_process`, server shutdown).
8. Confirm no MCP tool or handler can approve a profile on the user's behalf, that `scaffold_project` validates every argument before building its `dev` child process, and that `dev env` never prints or overwrites values.
9. Add adversarial tests using metacharacters, whitespace, malformed persisted data, unsafe recipes and profiles, option-like values such as `--evil`, and missing binaries.

## Findings

Report concrete findings first, ordered by severity, with file and line references. Distinguish exploitable behavior from hardening opportunities. If no issue is found, state remaining test gaps.

## Verify

Run focused security tests, then `npm test` and `git diff --check`.
