# Codex compatibility mode

CodexPro can expose a small, opt-in compatibility layer that reads the current
Codex instruction and skill files at request time. It does not copy Codex state
and does not make the ChatGPT/MCP runtime identical to native Codex.

## Modes

- `off` (default): preserve the existing CodexPro tool surface and behavior.
- `safe`: expose `codex_bootstrap` and `load_skill_resource`, but do not require
  a bootstrap before mutations.
- `strict`: expose the same tools and reject source writes, edits, patches,
  handoff/context writes, self-test mutation probes, and `bash` until a fresh
  bootstrap exists for the affected target context.

Enable the layer with either:

```bash
codexpro start --codex-compat strict
```

or:

```bash
export CODEXPRO_CODEX_COMPAT=strict
```

`--codex-dir` / `CODEXPRO_CODEX_DIR` selects the Codex home used for the
global instruction file and user skills. It defaults to `~/.codex`.

## `codex_bootstrap`

Input:

- `workspace_id`: optional CodexPro workspace id.
- `target_path`: optional path inside the workspace; defaults to `.`.
- `include_instructions`: defaults to `true`.
- `include_skills`: defaults to `true`.

The effective instruction chain is assembled dynamically:

1. Use `$CODEX_HOME/AGENTS.override.md` when it is a non-empty regular file;
   otherwise use `$CODEX_HOME/AGENTS.md`.
2. Walk from the workspace root to the directory containing `target_path`.
3. In each project directory, use the first non-empty regular file in this
   order: `AGENTS.override.md`, `AGENTS.md`, then configured fallback names.
4. Return layers in increasing precedence order. Later, more specific project
   instructions take precedence over earlier layers.

The tool returns the effective text, canonical source paths, scope, order,
byte counts, individual SHA-256 hashes, an aggregate context hash, a bounded
skill manifest, and a configuration compatibility report. Nothing is copied;
later calls read the current files again.

Only a narrow set of Codex configuration concepts is interpreted:

- `project_doc_fallback_filenames`
- `project_doc_max_bytes`

Other discovered keys are reported as informational or unsupported. Secret
values are not returned. Configuration source hashes cover only the
compatibility projection (key names plus supported values), not the raw TOML
bytes, so they cannot be used as a credential-value oracle.

## Skills

The bootstrap manifest discovers `SKILL.md` files from:

- project `.agents/skills` and `.codex/skills` directories from workspace root
  down to the target directory;
- `$CODEX_HOME/skills`;
- `$HOME/.agents/skills`;
- `$CODEX_HOME/plugins/cache`;
- `/etc/codex/skills` when readable.

Every manifest entry includes its source, skill root, `SKILL.md` path, size,
SHA-256, and shadowing status. `load_skill_resource` then reads a relative text
resource inside one discovered skill root.

Resource reads reject absolute paths, `..`, NUL bytes, sensitive basenames,
binary data, oversized content, and symlink escapes. The tool does not grant
general access to Codex sessions, authentication files, logs, or arbitrary
files under the Codex home.

## Strict-mode mutation gate

Strict mode stores successful bootstrap contexts only in the running MCP server
process. A bootstrap token is bound to the workspace, canonical target
directory, mode, effective instruction chain, skill manifest, and supported
configuration.

Before each mutation:

- `write` and `edit` validate the target file context;
- `apply_patch` validates every touched file context;
- handoff and Pro-context exports validate their `.ai-bridge` target context;
- self-test write and bash probes use the same gates;
- `bash` validates its working-directory context.

CodexPro recomputes the aggregate hash immediately before the operation. The
operation fails closed if no matching bootstrap exists or if an instruction,
skill, or supported configuration input has changed. Call `codex_bootstrap`
again to refresh the context.

This is an execution-order safeguard, not a security sandbox for arbitrary
shell commands. Existing CodexPro root, write-mode, bash-mode, glob, symlink,
size, and timeout controls continue to apply.

## Compatibility boundary

This layer intentionally does not:

- import Codex authentication, sessions, memories, logs, model state, native
  plugin runtime, MCP servers, approval policies, or sandbox configuration;
- run Codex system skills inside ChatGPT automatically;
- claim identical prompt ordering, model behavior, tool implementation, or
  approval semantics;
- keep a copied snapshot synchronized after Codex upgrades.

Because files are read dynamically, changes to supported `AGENTS.md`, skills,
or the supported configuration keys take effect on the next bootstrap. A Codex
upgrade that changes file formats or precedence rules may still require an
update to this compatibility layer.
