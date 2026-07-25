# CodexPro Native Compatibility Layer

## Final objective

Implement and verify a safe, opt-in Codex compatibility layer for
`juliaError/codexpro_mo` that dynamically reads the user's current Codex
instructions and skills without copying the whole Codex home directory or
exposing credentials, sessions, logs, or other runtime state.

## Repository state

- Fork: `juliaError/codexpro_mo`
- Upstream: `rebel0789/codexpro`
- Baseline version: `0.29.0`
- Baseline commit: `bbc789e57012af2f46c005f5d54db17e50e1b7f0`
- Working branch: `agent/codex-native-compat`
- Fork and upstream were identical before implementation.

## Immutable boundaries

- Do not modify the globally installed CodexPro package.
- Do not modify files under the user's real `~/.codex` or `~/.codexpro`.
- Do not expose or copy `auth.json`, sessions, archived sessions, logs,
  credentials, private keys, or unrelated Codex runtime files.
- Do not present ChatGPT/MCP behavior as identical to the native Codex runtime.
- Keep compatibility opt-in until the full regression and security suite passes.
- Do not open a pull request against the upstream author's repository.

## Target behavior

1. Add `--codex-compat <off|safe|strict>`.
2. Add `codex_bootstrap` to dynamically assemble the effective instruction
   chain:
   - `$CODEX_HOME/AGENTS.override.md`, otherwise `$CODEX_HOME/AGENTS.md`;
   - project instructions from project root down to the requested target path;
   - one instruction file per directory using Codex precedence.
3. Return instruction text, source scope, canonical display path, precedence
   order, size, SHA-256, and an aggregate context hash.
4. Discover current skills from supported project, user, plugin, admin, and
   system-compatible locations without copying them.
5. Add bounded `load_skill_resource` for relative text resources inside an
   already discovered skill root.
6. In strict mode, require a fresh bootstrap before `write`, `edit`,
   `apply_patch`, or `bash`; invalidate it if the instruction or skill manifest
   changes.
7. Report which Codex configuration concepts are applied, informational only,
   or unsupported rather than silently claiming compatibility.

## Security acceptance gates

- Canonical `realpath` validation blocks `..`, absolute resource paths, and
  symlink escape.
- Sensitive basenames and blocked globs remain inaccessible.
- Skill-resource reads are text-only and bounded by explicit byte limits.
- Bootstrap never enumerates arbitrary files inside `CODEX_HOME`.
- A token is bound to the workspace, target path, compatibility mode, and
  aggregate context hash.
- Strict-mode mutations fail closed when bootstrap is absent or stale.
- Off mode preserves existing CodexPro behavior.

## Workflow versions

### v1: Fork and baseline

- [x] Verified fork and upstream were identical.
- [x] Cloned the fork into the task workspace.
- [x] Added `upstream`.
- [x] Created `agent/codex-native-compat`.
- [x] Installed dependencies with `npm ci`.
- [x] Ran the unmodified `npm run build` successfully.
- [x] Ran the full unmodified `npm run smoke` successfully outside the sandbox.
  The first sandboxed run reached the HTTP smoke test and failed only because
  binding `127.0.0.1` returned `EPERM`; the elevated rerun passed.
- [x] Recorded the dependency baseline: `npm ci` reports 3 moderate and 2 high
  vulnerabilities plus pending install-script review for `esbuild` and
  `fsevents`. No automatic audit fix was applied.

### v2: Design and implementation

- [x] Audit repository architecture and existing tool-mode/config/profile paths.
- [x] Freeze the compatibility API and security contract in
  `docs/CODEX_COMPAT.md`.
- [x] Implement instruction-chain and skill-resource modules.
- [x] Register MCP tools and strict-mode mutation gates.
- [x] Add CLI/profile/HTTP configuration and English/Chinese documentation.

#### Frozen v2 decisions

- Compatibility defaults to `off`; existing tool lists and behavior remain
  unchanged unless explicitly enabled.
- `safe` exposes compatibility tools without changing mutation order.
- `strict` keeps bootstrap state only in the MCP server process and recomputes
  context immediately before each mutating tool.
- Instructions and skills are read dynamically from canonical paths. They are
  never copied into the fork or synchronized manually.
- Only `project_doc_fallback_filenames` and `project_doc_max_bytes` are applied
  from Codex TOML configuration. All other keys are reported without values as
  informational or unsupported.
- The compatibility layer does not import authentication, sessions, memories,
  logs, plugin runtime state, MCP configuration, approval policies, or sandbox
  settings.
- The isolated compatibility smoke test passed with a temporary HOME,
  CODEX_HOME, workspace, nested rules, large skill, plugin skill, symlink
  escape, binary file, stale-hash, safe-mode, and off-mode fixtures.
- Focused `settings-smoke` could not bind `127.0.0.1` inside the filesystem
  sandbox (`listen EPERM`). It must be rerun with the same elevated network
  allowance used by the unmodified baseline HTTP smoke suite.
- The final elevated full smoke suite passed, including analysis, stdio, Codex
  compatibility, HTTP, widget, Pro, doctor, settings, handoff, and release
  guard coverage.
- The final stress suite passed after isolating its pre-existing global-skill
  fixture under a temporary HOME instead of writing to the user's real
  `~/.codex/skills`.
- `npm pack --dry-run` passed with an isolated `/tmp` npm cache and included
  `dist/codexCompat.js`, its source map, compatibility docs, and smoke script.
  The first dry-run attempt compiled successfully but npm could not write the
  user's existing global cache; no permissions were changed.
- A read-only integration bootstrap against the user's current Codex home
  succeeded without printing instruction or skill bodies: 1 global instruction
  layer, 54 skills discovered (50 active; 38 plugin and 16 user), and the
  supported configuration projection was hashed successfully.

### v3: Verification and publication

- [x] Build, smoke, stress, security, and regression tests pass.
- [x] Inspect the packaged artifact and full intended diff.
- [x] Commit only intended files to the feature branch after final checks.
- [x] Push the feature branch to `juliaError/codexpro_mo`.
- [x] Create draft PR
  [`juliaError/codexpro_mo#1`](https://github.com/juliaError/codexpro_mo/pull/1),
  targeting the fork's `main`.

## Publication result

GitHub authentication was confirmed outside the filesystem sandbox for account
`juliaError`. The branch and draft PR were published on 2026-07-25. No PR was
opened against `rebel0789/codexpro`.
