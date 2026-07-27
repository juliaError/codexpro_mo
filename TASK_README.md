# CodexPro Native Compatibility Layer

## Final objective

Implement and verify a safe Codex compatibility layer for
`juliaError/codexpro_mo` that dynamically reads the user's current Codex
instructions and skills without copying the whole Codex home directory or
exposing credentials, sessions, logs, or other runtime state. As explicitly
requested in v5, this fork now defaults to strict compatibility without
per-workspace enablement.

## Repository state

- Fork: `juliaError/codexpro_mo`
- Upstream: `rebel0789/codexpro`
- Baseline version: `0.29.0`
- Baseline commit: `bbc789e57012af2f46c005f5d54db17e50e1b7f0`
- Working branch: `agent/codex-native-compat`
- Fork and upstream were identical before implementation.

## Immutable boundaries

- Do not modify the globally installed CodexPro package unless separately
  authorized. The user explicitly authorized replacing it with this fork on
  2026-07-25 for workflow v7.
- Do not modify files under the user's real `~/.codex` or `~/.codexpro`.
- Do not expose or copy `auth.json`, sessions, archived sessions, logs,
  credentials, private keys, or unrelated Codex runtime files.
- Do not present ChatGPT/MCP behavior as identical to the native Codex runtime.
- Keep compatibility opt-in until the original regression and security suite
  passes; only then may a separately authorized default change be applied.
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

### v4: Simplified strict-mode startup

Superseded by v5: the shortcut remains, but plain `codexpro start` is now the
recommended default-strict command.

- [x] Preserve `off` as the default for backward compatibility.
- [x] Add `codexpro native` as an explicit shortcut that always selects strict
  Codex compatibility, even when a saved profile or command-line option says
  otherwise.
- [x] Document the existing one-time profile alternative:
  `codexpro settings set --codex-compat strict`, followed by plain
  `codexpro start`.
- [x] Run focused help-output and build checks, then the full `npm run smoke`
  suite, including the settings/runtime shortcut test.
- [x] Commit and update draft PR
  [`juliaError/codexpro_mo#1`](https://github.com/juliaError/codexpro_mo/pull/1).

### v5: Default strict compatibility without per-project setup

- [x] Supersede the v2/v4 default-off decision at the user's explicit request.
- [x] Make missing or empty compatibility configuration resolve to `strict` in
  both the launcher and direct MCP server.
- [x] Treat old workspace profiles without `codexCompat` as strict.
- [x] Persist explicit `off` so users can still opt out intentionally.
- [x] Make plain `codexpro start` the documented normal command.
- [x] Run focused default/opt-out tests plus full smoke and stress suites.
- [x] Verify the installable artifact with isolated-cache `npm pack --dry-run`;
  the package includes the rebuilt strict-default configuration, launcher,
  compatibility module, tests, and documentation.
- [x] Commit and update draft PR
  [`juliaError/codexpro_mo#1`](https://github.com/juliaError/codexpro_mo/pull/1).

### v6: GitHub-install-ready artifact

- [x] Merge PR
  [`juliaError/codexpro_mo#1`](https://github.com/juliaError/codexpro_mo/pull/1)
  into the fork's `main` as
  `00c53a993726a9c0810d2e8d6f3f7fcfc4641f50`.
- [x] Verify the merged `main` tree matches the fully tested feature tree.
- [x] Run an isolated install from `github:juliaError/codexpro_mo`.
- [x] Record the installation failure accurately: npm installed the source but
  omitted ignored `dist/` output because Git-dependency lifecycle builds were
  skipped under the local npm security policy.
- [x] Stop relying on lifecycle execution by tracking the compiled `dist/`
  output in this fork.
- [x] Verify build reproducibility, package contents, and an isolated GitHub
  branch install with `--ignore-scripts`, executable `codexpro`, required
  `dist` files, and doctor reporting default strict mode.
- [x] Commit, publish, and merge the install-readiness follow-up into `main`.

### v7: Authorized global installation

- [x] Receive explicit user authorization to replace the globally installed
  CodexPro with `github:juliaError/codexpro_mo`.
- [x] Record the existing executable, package identity, active process state,
  and hashes of existing `~/.codexpro` files without printing their contents.
- [x] Attempt the direct GitHub global install with `--ignore-scripts`. Although
  npm returned success, artifact verification found an empty/incomplete global
  package, no CLI entry point, and no `dist/`; do not treat this attempt as a
  successful installation.
- [x] Recover by installing a verified package artifact built from fork commit
  `53665676ee118376743097ba1ba5580609ae8400`, without running dependency
  lifecycle scripts globally. The package SHA-256 was
  `36d30f8b593d86e07787b17d10d6e92b6a0af33949f871bf285792a440f63265`.
- [x] Verify executable resolution, package contents, CLI version, default
  strict compatibility, and unchanged `~/.codexpro` file hashes.
- [x] Validate a reliable one-command GitHub reinstall form for this machine:
  `npm install -g github:juliaError/codexpro_mo --ignore-scripts
  --install-links=true`. An isolated-prefix install produced a real package
  directory, a working CLI, the compatibility module, and the exact expected
  `dist/config.js` SHA-256.
- [x] Update the English and Chinese README files to use the verified
  one-command GitHub installation form; `git diff --check` passes.
- [x] Publish the documentation correction to the fork through draft PR
  [`juliaError/codexpro_mo#3`](https://github.com/juliaError/codexpro_mo/pull/3).

### v8: Strict bootstrap connector diagnosis

- [x] Record the observed production symptom: reads succeed, but every bash or
  write call reports `Strict Codex compatibility requires a fresh
  codex_bootstrap` even after root and target bootstraps.
- [x] Trace bootstrap state ownership across HTTP/MCP requests: the workspace
  manager is shared, but `createCodexProServer()` creates a new
  `CodexBootstrapRegistry` for each MCP session, so bootstrap hashes are not
  visible to another session. The failing comparison used the same `.` target,
  ruling out a target-path mismatch.
- [x] Reproduce the failure with an isolated strict HTTP server: bootstrap plus
  `bash pwd` succeeded in session A, while the same bash call in session B
  failed with the production `fresh codex_bootstrap` message. This is connector
  session-state loss, not a project-data or spreadsheet error.
- [x] Keep this phase diagnostic-only; do not change or publish runtime code
  without a separate user request to fix the defect.

### v9: Permanent cross-session strict-mode repair

The user explicitly authorized a permanent repair on 2026-07-27. This
supersedes the v8 diagnostic-only boundary for the scoped runtime and test
changes below.

- [x] Freeze the repair contract: one HTTP service shares one bootstrap
  registry across its authenticated MCP sessions; each mutation still rebuilds
  the current context and must match a stored workspace/target context hash.
- [x] Inject service-owned shared bootstrap state into every HTTP MCP server
  session without making it global across independent HTTP service instances.
- [x] Add a strict HTTP regression proving pre-bootstrap failure,
  cross-session success, stale-context failure, and cross-session refresh
  recovery. The first run correctly exposed a fixture mistake
  (`CODEX_HOME` instead of `CODEXPRO_CODEX_DIR`); the corrected test passes.
- [x] Rebuild tracked `dist/` output; focused HTTP, full `npm run smoke`, and
  `npm run stress` pass. Two consecutive builds produced the same aggregate
  `dist/` SHA-256
  `221af649c4e5d27692548f84ead206ca9e048de24d5e683f712376e694f50db0`.
  The isolated package SHA-256 is
  `ce14b5a12aa31d0892d09084c6e1c4b3ca06b37e487e704d073927432ad71ca3`,
  and its `dist/server.js` matches the tested working tree.
- [x] Publish and merge PR
  [`juliaError/codexpro_mo#3`](https://github.com/juliaError/codexpro_mo/pull/3)
  into fork `main` as
  `2342b5c50381820763eb3f72ff10d56dfb384ec7`, then install that exact tree
  globally with the reliable GitHub install command.
- [x] Verify the installed `dist/http.js` and `dist/server.js` hashes match
  fork `main`; the six persistent profile files retain aggregate SHA-256
  `d9259af7c00feaa0dd6f2a75d3dd93b9379aa2135eeaadadadb491cda3994e6c`
  and the non-runtime `~/.codexpro` aggregate remains
  `6c409defedba4af13db3309d36d6208fdf195c4fabed5bbbd6091ab093ac82a0`.
- [x] Restart the `/Volumes/ORICO/美国出口和对美信任` service on
  `127.0.0.1:8788` with `strict` compatibility and `bash=safe`; a real
  installed-build test bootstrapped in session A, closed it, and successfully
  ran `bash pwd` in session B against the intended workspace.
- [x] Copy the restarted Cloudflare quick-tunnel Server URL to the system
  clipboard without printing or recording its authentication token. Because a
  quick-tunnel hostname changes on restart, the user must paste this new URL
  into the existing `CodexPro_america1` connector once.

### v10: Stable Tailscale Funnel and credential-safe launcher output

The user chose a stable public connector URL that does not require a privately
owned domain. This phase replaces the current workspace's Cloudflare quick
tunnel with a device-stable Tailscale Funnel while preserving strict Codex
compatibility and safe bash defaults.

- [x] Install the official Tailscale 1.98.9 standalone macOS package and let the
  user approve its system/VPN extension and complete personal-account login.
- [x] Verify the client is running, MagicDNS is enabled, and the Mac has a
  stable device-specific `*.ts.net` Funnel hostname. Keep the actual hostname
  out of the public repository audit record.
- [x] Enable Funnel once and verify that it proxies the existing local CodexPro
  service at `127.0.0.1:8788` through the stable HTTPS hostname.
- [x] Change only the `/Volumes/ORICO/美国出口和对美信任` saved profile from
  `cloudflare` to `tailscale`; preserve port 8788, agent mode, strict Codex
  compatibility, and the saved authentication-token behavior.
- [x] Detect that the launcher printed the full token-bearing Server URL,
  immediately stop the exposed instance, and rotate its token before any
  ChatGPT connector was created from it.
- [x] Change launcher and control-panel output so the full Server URL is copied
  to the clipboard but every terminal preview is redacted, including initial
  startup, `u`, `p`, copy-failure, and local-status fallbacks. Update English
  and Chinese documentation accordingly.
- [x] Verify initial, `u`, and `p` output with a synthetic token; no synthetic
  token text appeared. `git diff --check`, build, the full smoke suite, and the
  stress suite pass.
- [x] After explicit approval, package and globally install the tested fork. The
  package SHA-256 is
  `6411a6df6f3e7b59e343d679b4903e6a03beac99a288b51a71b87ce0c31811ae`;
  the installed launcher SHA-256 matches the tested source at
  `f59c42dfde58abea418b3485beba2ad37a8681e2b1b978677eddafbf92826fd6`.
- [x] Restart the real service with the global CLI. The terminal prints only a
  redacted Server URL while `pbcopy` contains a valid 64-character-token URL.
  Public health returns HTTP 200 for the intended workspace with `bash=safe`;
  session A bootstrap followed by session B `bash pwd` succeeds in strict mode.
  `codexpro doctor --port 8799` reports ready while the production service
  remains active on port 8788.

#### Project-switching boundary

- The fixed `ts.net` hostname belongs to this Mac, not to one repository, so a
  ChatGPT connector can retain the same hostname when CodexPro changes projects.
- Workspace profiles currently store authentication tokens independently. A
  one-connector/no-per-project-setup workflow therefore still needs an explicit
  shared-connector-default feature or an intentionally broad allowed-root hub;
  do not silently broaden access from one project to an entire drive.

### v11: Global default connector with current-directory workspace isolation

The user explicitly requested on 2026-07-27 that a new project should start
with only `cd /path/to/project` followed by `codexpro start`, without a
per-project setup prompt or `settings use` command.

- [x] Add one permission-protected global default connector profile containing
  reusable connection and safety settings, but never a workspace root or extra
  allowed roots.
- [x] When a workspace has no saved profile, materialize the global default for
  that exact current directory before first-run setup; explicit CLI/environment
  tunnel settings and `--no-profile` must continue to take precedence.
- [x] Add explicit show/set/delete commands for the global default so its state
  is auditable and reversible without displaying saved tokens.
- [x] Verify that a fresh workspace starts non-interactively with the shared
  Tailscale hostname/token while the runtime workspace and allowed-root remain
  the fresh current directory only.
- [x] Run focused, full smoke, stress, package, global-install, and live
  workspace-switch checks before treating the workflow as complete.

The focused settings regression, full smoke suite, and stress suite pass. The
new regression proves that Tailscale hostname/token settings materialize into a
fresh workspace, an interactive fresh workspace reaches the control panel
without a setup question, the global file is mode `0600` and omits roots, token
output stays redacted, `--no-profile` bypasses inheritance, and `/healthz`
reports exactly the fresh current directory as both `defaultRoot` and the sole
`allowedRoots` entry. The first focused run exposed an incomplete persistent
Tailscale test double that could not satisfy public `ts.net` health; the test
was corrected to separate Tailscale command/profile inheritance from a
local-only live scope probe without weakening the production acceptance
contract.

The installable v11 package SHA-256 is
`7b91e46602203b80ef4e19171ca5abccb0da0d02f56f5cdadc06536ff2148391`.
After explicit approval, the global launcher hash matches the tested source at
`0ec95ff6bd09624cb2f4c43a0ec36a6bae4d54ec9bb43c530e78ffc5b59ac248`.
The pre/post aggregate hash of all workspace profiles remains
`ce5e9446ff4f8bd72d0662304d1d5d824840c2e6c27d614acfd7b26abe07bd59`.
The new global default is mode `0600`, has SHA-256
`a41f04670e0dbf01e8b8b833417a256157dd300f6efe281e11fb2750cc3a7f2b`,
stores a token without printing it, and contains none of `root`, `profilePath`,
`defaultProfilePath`, `allowRoots`, `allowHome`, or `host`.

A real temporary new directory was started using exactly `codexpro start` with
no project settings command. Public health reported that directory as both
`defaultRoot` and the sole `allowedRoots` entry with `bash=safe` and
`codexCompatMode=strict`. Its generated workspace profile and temporary
directory were removed, while the global default was retained. The original
`/Volumes/ORICO/美国出口和对美信任` service was then restored; its public health
again reports only that workspace with the same safe/strict policy.
