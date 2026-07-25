import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function encode(message) {
  return `${JSON.stringify(message)}\n`;
}

class McpStdioClient {
  constructor(args, env) {
    this.child = spawn(process.execPath, ['dist/stdio.js', ...args], {
      cwd: path.resolve('.'),
      env: { ...process.env, ...env }
    });
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.child.stdout.on('data', (chunk) => this.onData(String(chunk)));
    this.child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    this.child.on('exit', (code) => {
      for (const { reject } of this.pending.values()) reject(new Error(`server exited ${code}`));
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    while (true) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) return;
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (!message.id || !this.pending.has(message.id)) continue;
      const { resolve, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  }

  request(method, params) {
    const id = this.nextId++;
    this.child.stdin.write(encode({ jsonrpc: '2.0', id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20_000);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(encode({ jsonrpc: '2.0', method, params }));
  }

  close() {
    this.child.kill('SIGTERM');
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resultText(result) {
  return result.content?.find?.((part) => part.type === 'text')?.text ?? JSON.stringify(result.structuredContent);
}

async function expectToolError(client, name, args, pattern) {
  const result = await client.request('tools/call', { name, arguments: args });
  assert(result.isError, `${name} unexpectedly succeeded`);
  const text = resultText(result);
  assert(pattern.test(text), `${name} error did not match ${pattern}: ${text}`);
}

async function connect(args, env, name) {
  const client = new McpStdioClient(args, env);
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name, version: '0.1.0' }
  });
  client.notify('notifications/initialized');
  return client;
}

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'codexpro-compat-'));
const workspace = path.join(fixture, 'workspace');
const fakeHome = path.join(fixture, 'home');
const codexHome = path.join(fakeHome, '.codex');
const outside = path.join(fixture, 'outside');
await fs.mkdir(path.join(workspace, 'sub'), { recursive: true });
await fs.mkdir(path.join(workspace, 'fallback'), { recursive: true });
await fs.mkdir(path.join(workspace, '.codex'), { recursive: true });
await fs.mkdir(codexHome, { recursive: true });
await fs.mkdir(outside, { recursive: true });

await fs.writeFile(path.join(codexHome, 'AGENTS.md'), '# Global base\n\nGLOBAL_BASE_SHOULD_NOT_APPEAR\n');
await fs.writeFile(path.join(codexHome, 'AGENTS.override.md'), '# Global override\n\nGLOBAL_OVERRIDE_ACTIVE\n');
await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# Project root\n\nPROJECT_ROOT_ACTIVE\n');
await fs.writeFile(path.join(workspace, 'sub', 'AGENTS.md'), '# Nested base\n\nNESTED_BASE_SHOULD_NOT_APPEAR\n');
await fs.writeFile(path.join(workspace, 'sub', 'AGENTS.override.md'), '# Nested override\n\nNESTED_OVERRIDE_ACTIVE\n');
await fs.writeFile(path.join(workspace, 'fallback', 'LOCAL_RULES.md'), '# Fallback\n\nFALLBACK_ACTIVE\n');
await fs.writeFile(
  path.join(codexHome, 'config.toml'),
  [
    'project_doc_max_bytes = 100_000',
    'model = "do-not-return-this-value"',
    'approval_policy = "never"',
    ''
  ].join('\n')
);
await fs.writeFile(
  path.join(workspace, '.codex', 'config.toml'),
  'project_doc_fallback_filenames = ["LOCAL_RULES.md", "../unsafe.md", "auth.json", ".env.local"]\n'
);

const userSkill = path.join(codexHome, 'skills', 'shared-skill');
const projectSkill = path.join(workspace, '.agents', 'skills', 'shared-skill');
const pluginSkill = path.join(codexHome, 'plugins', 'cache', 'example-plugin', '1.0.0', 'skills', 'plugin-skill');
await fs.mkdir(path.join(userSkill, 'references'), { recursive: true });
await fs.mkdir(projectSkill, { recursive: true });
await fs.mkdir(pluginSkill, { recursive: true });
const largeSkillTail = 'FULL_SKILL_TAIL_VISIBLE';
await fs.writeFile(
  path.join(userSkill, 'SKILL.md'),
  `---\nname: shared-skill\ndescription: User skill fixture.\n---\n\n${'x'.repeat(70_000)}\n${largeSkillTail}\n`
);
await fs.writeFile(path.join(userSkill, 'references', 'rules.md'), '# Rules\n\nRESOURCE_OK\n');
await fs.writeFile(path.join(userSkill, 'auth.json'), '{"token":"must-not-read"}\n');
await fs.writeFile(path.join(userSkill, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
await fs.writeFile(path.join(userSkill, 'oversized.txt'), 'z'.repeat(181_000));
await fs.writeFile(
  path.join(projectSkill, 'SKILL.md'),
  '---\nname: shared-skill\ndescription: Project skill fixture.\n---\n\nPROJECT_SKILL_ACTIVE\n'
);
await fs.writeFile(
  path.join(pluginSkill, 'SKILL.md'),
  '---\nname: plugin-skill\ndescription: Plugin skill fixture.\n---\n\nPLUGIN_SKILL_ACTIVE\n'
);
await fs.writeFile(path.join(outside, 'secret.txt'), 'SYMLINK_ESCAPE_SECRET\n');
await fs.mkdir(path.join(outside, 'escaped-skill'), { recursive: true });
await fs.writeFile(
  path.join(outside, 'escaped-skill', 'SKILL.md'),
  '---\nname: escaped-skill\ndescription: Must not be discovered through a symlinked user root.\n---\n'
);
await fs.mkdir(path.join(fakeHome, '.agents'), { recursive: true });
let skillRootSymlinkCreated = false;
try {
  await fs.symlink(outside, path.join(fakeHome, '.agents', 'skills'), 'dir');
  skillRootSymlinkCreated = true;
} catch (error) {
  if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
}
let symlinkCreated = false;
try {
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(userSkill, 'references', 'outside-link.txt'));
  symlinkCreated = true;
} catch (error) {
  if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
}

await fs.writeFile(path.join(workspace, 'note.txt'), 'alpha\n');
for (const args of [['init'], ['add', '.']]) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}
const commit = spawnSync(
  'git',
  ['-c', 'user.email=compat@example.com', '-c', 'user.name=Compat Smoke', 'commit', '-m', 'fixture'],
  { cwd: workspace, encoding: 'utf8' }
);
if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);

const commonArgs = [
  '--root', workspace,
  '--allow-root', workspace,
  '--bash', 'safe',
  '--write', 'workspace',
  '--tool-mode', 'standard',
  '--codex-dir', codexHome
];
const commonEnv = {
  HOME: fakeHome,
  CODEXPRO_ROOT: workspace,
  CODEXPRO_ALLOWED_ROOTS: workspace,
  CODEXPRO_CODEX_DIR: codexHome,
  CODEXPRO_CODEX_COMPAT: '',
  CODEXPRO_TOOL_CARDS: '0'
};

const invalidMode = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "import { loadConfig } from './dist/config.js'; loadConfig(['--root', process.argv[1], '--codex-compat', 'typo']);",
    workspace
  ],
  { cwd: path.resolve('.'), env: { ...process.env, ...commonEnv }, encoding: 'utf8' }
);
assert(invalidMode.status !== 0 && /must be off, safe, or strict/i.test(invalidMode.stderr), 'invalid direct MCP compatibility mode did not fail closed');

const defaultStrict = await connect(commonArgs, commonEnv, 'codexpro-compat-default-strict');
const defaultStrictTools = await defaultStrict.request('tools/list', {});
const defaultStrictNames = defaultStrictTools.tools.map((tool) => tool.name);
assert(defaultStrictNames.includes('codex_bootstrap'), 'default mode did not expose codex_bootstrap');
await expectToolError(defaultStrict, 'write', { path: 'default-strict.txt', content: 'blocked\n' }, /fresh codex_bootstrap/i);
defaultStrict.close();

const strict = await connect([...commonArgs, '--codex-compat', 'strict'], commonEnv, 'codexpro-compat-strict');
const strictTools = await strict.request('tools/list', {});
const strictToolNames = strictTools.tools.map((tool) => tool.name);
for (const name of ['codex_bootstrap', 'load_skill_resource']) {
  assert(strictToolNames.includes(name), `strict mode missing ${name}`);
}
await expectToolError(strict, 'write', { path: 'root.txt', content: 'before\n' }, /fresh codex_bootstrap/i);
await expectToolError(strict, 'bash', { command: 'pwd' }, /fresh codex_bootstrap/i);
await expectToolError(strict, 'handoff_to_agent', { plan: 'blocked before bootstrap' }, /fresh codex_bootstrap/i);
await expectToolError(strict, 'export_pro_context', { include_important_files: false, include_changed_files: false }, /fresh codex_bootstrap/i);

const rootBootstrap = await strict.request('tools/call', {
  name: 'codex_bootstrap',
  arguments: { target_path: '.' }
});
assert(!rootBootstrap.isError, resultText(rootBootstrap));
const rootData = rootBootstrap.structuredContent;
assert(rootData.mode === 'strict', `unexpected compatibility mode: ${rootData.mode}`);
assert(/^cb_/.test(rootData.bootstrap_token), 'bootstrap token missing');
assert(/^[a-f0-9]{64}$/.test(rootData.context_hash), 'context hash missing');
assert(rootData.effective_instructions.includes('GLOBAL_OVERRIDE_ACTIVE'), 'global override was not loaded');
assert(!rootData.effective_instructions.includes('GLOBAL_BASE_SHOULD_NOT_APPEAR'), 'global base was not shadowed');
assert(rootData.effective_instructions.includes('PROJECT_ROOT_ACTIVE'), 'project root instruction missing');
assert(rootData.instruction_layers.length === 2, `unexpected root instruction count: ${rootData.instruction_layers.length}`);
assert(rootData.skills.some((skill) => skill.name === 'shared-skill' && skill.source === 'project' && skill.active), 'project skill did not win');
assert(rootData.skills.some((skill) => skill.name === 'shared-skill' && skill.source === 'user' && !skill.active), 'shadowed user skill missing');
assert(rootData.skills.some((skill) => skill.name === 'plugin-skill' && skill.source === 'plugin'), 'plugin skill missing');
if (skillRootSymlinkCreated) {
  assert(!rootData.skills.some((skill) => skill.name === 'escaped-skill'), 'symlinked user skill root escaped its trusted container');
}
assert(rootData.config_compatibility.applied.some((item) => item.key === 'project_doc_max_bytes' && item.value === 100_000), 'max-byte config not applied');
const fallbackSetting = rootData.config_compatibility.applied.find((item) => item.key === 'project_doc_fallback_filenames');
assert(JSON.stringify(fallbackSetting?.value) === JSON.stringify(['LOCAL_RULES.md']), `unsafe fallback names were retained: ${JSON.stringify(fallbackSetting)}`);
assert(rootData.config_compatibility.warnings.length >= 3, 'unsafe fallback names were not reported');
assert(!JSON.stringify(rootData.config_compatibility).includes('do-not-return-this-value'), 'config value leaked');
await fs.writeFile(
  path.join(codexHome, 'config.toml'),
  [
    'project_doc_max_bytes = 100_000',
    'model = "changed-informational-value"',
    'approval_policy = "never"',
    ''
  ].join('\n')
);
const informationalConfigBootstrap = await strict.request('tools/call', {
  name: 'codex_bootstrap',
  arguments: { target_path: '.' }
});
assert(informationalConfigBootstrap.structuredContent.context_hash === rootData.context_hash, 'unsupported config value changed the compatibility hash');
assert(!JSON.stringify(informationalConfigBootstrap.structuredContent.config_compatibility).includes('changed-informational-value'), 'changed config value leaked');

const fallbackBootstrap = await strict.request('tools/call', {
  name: 'codex_bootstrap',
  arguments: { target_path: 'fallback' }
});
assert(fallbackBootstrap.structuredContent.effective_instructions.includes('FALLBACK_ACTIVE'), 'configured fallback instruction missing');

for (const [name, arguments_] of [
  ['write', { path: 'root.txt', content: 'before\n' }],
  ['edit', { path: 'root.txt', old_text: 'before', new_text: 'after' }],
  ['apply_patch', { patch: '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-alpha\n+beta\n' }],
  ['bash', { command: 'pwd' }]
]) {
  const result = await strict.request('tools/call', { name, arguments: arguments_ });
  assert(!result.isError, `${name} failed after root bootstrap: ${resultText(result)}`);
}
const handoff = await strict.request('tools/call', {
  name: 'handoff_to_agent',
  arguments: { agent: 'custom', plan: 'Compatibility smoke handoff.' }
});
assert(!handoff.isError, `handoff failed after bootstrap: ${resultText(handoff)}`);
const exported = await strict.request('tools/call', {
  name: 'export_pro_context',
  arguments: {
    selected_paths: ['note.txt'],
    include_important_files: false,
    include_changed_files: false,
    include_diff: false,
    include_ai_bridge: false,
    max_files: 1,
    max_total_bytes: 20_000
  }
});
assert(!exported.isError, `context export failed after bootstrap: ${resultText(exported)}`);
const strictSelfTest = await strict.request('tools/call', {
  name: 'codexpro_self_test',
  arguments: { pro_context_probe: false }
});
assert(strictSelfTest.structuredContent.status !== 'fail', `strict self-test failed after bootstrap: ${JSON.stringify(strictSelfTest.structuredContent.checks)}`);

await expectToolError(strict, 'write', { path: 'sub/output.txt', content: 'nested\n' }, /fresh codex_bootstrap/i);
const nestedBootstrap = await strict.request('tools/call', {
  name: 'codex_bootstrap',
  arguments: { target_path: 'sub' }
});
assert(nestedBootstrap.structuredContent.effective_instructions.includes('NESTED_OVERRIDE_ACTIVE'), 'nested override missing');
assert(!nestedBootstrap.structuredContent.effective_instructions.includes('NESTED_BASE_SHOULD_NOT_APPEAR'), 'nested base was not shadowed');
const nestedWrite = await strict.request('tools/call', {
  name: 'write',
  arguments: { path: 'sub/output.txt', content: 'nested\n' }
});
assert(!nestedWrite.isError, `nested write failed after nested bootstrap: ${resultText(nestedWrite)}`);

await fs.writeFile(path.join(codexHome, 'AGENTS.override.md'), '# Global override\n\nGLOBAL_OVERRIDE_CHANGED\n');
await expectToolError(
  strict,
  'edit',
  { path: 'sub/output.txt', old_text: 'nested', new_text: 'changed' },
  /fresh codex_bootstrap/i
);
await strict.request('tools/call', { name: 'codex_bootstrap', arguments: { target_path: 'sub' } });
const refreshedEdit = await strict.request('tools/call', {
  name: 'edit',
  arguments: { path: 'sub/output.txt', old_text: 'nested', new_text: 'changed' }
});
assert(!refreshedEdit.isError, `edit failed after refresh: ${resultText(refreshedEdit)}`);

let globalInstructionSymlinkCreated = false;
try {
  await fs.rm(path.join(codexHome, 'AGENTS.override.md'));
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(codexHome, 'AGENTS.override.md'));
  globalInstructionSymlinkCreated = true;
} catch (error) {
  if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
}
if (globalInstructionSymlinkCreated) {
  const symlinkBootstrap = await strict.request('tools/call', {
    name: 'codex_bootstrap',
    arguments: { target_path: '.' }
  });
  assert(!symlinkBootstrap.structuredContent.effective_instructions.includes('SYMLINK_ESCAPE_SECRET'), 'global AGENTS symlink escaped CODEX_HOME');
  assert(symlinkBootstrap.structuredContent.effective_instructions.includes('GLOBAL_BASE_SHOULD_NOT_APPEAR'), 'global fallback was not used after unsafe override symlink');
}

const fullSkill = await strict.request('tools/call', {
  name: 'load_skill_resource',
  arguments: { name: 'shared-skill', source: 'user', resource_path: 'SKILL.md' }
});
assert(resultText(fullSkill).includes(largeSkillTail), 'large SKILL.md was truncated before its tail');
const resource = await strict.request('tools/call', {
  name: 'load_skill_resource',
  arguments: { name: 'shared-skill', source: 'user', resource_path: 'references/rules.md' }
});
assert(resource.structuredContent.text.includes('RESOURCE_OK'), 'skill resource text missing');
await expectToolError(strict, 'load_skill_resource', { name: 'shared-skill', source: 'user', resource_path: '../secret.txt' }, /normalized relative path/i);
await expectToolError(strict, 'load_skill_resource', { name: 'shared-skill', source: 'user', resource_path: path.join(outside, 'secret.txt') }, /normalized relative path/i);
await expectToolError(strict, 'load_skill_resource', { name: 'shared-skill', source: 'user', resource_path: 'auth.json' }, /blocked/i);
await expectToolError(strict, 'load_skill_resource', { name: 'shared-skill', source: 'user', resource_path: 'binary.bin' }, /binary|utf-8/i);
await expectToolError(strict, 'load_skill_resource', { name: 'shared-skill', source: 'user', resource_path: 'oversized.txt' }, /exceeds/i);
if (symlinkCreated) {
  await expectToolError(strict, 'load_skill_resource', { name: 'shared-skill', source: 'user', resource_path: 'references/outside-link.txt' }, /symlink|escapes/i);
}
strict.close();

const safe = await connect([...commonArgs, '--codex-compat', 'safe'], commonEnv, 'codexpro-compat-safe');
const safeWrite = await safe.request('tools/call', { name: 'write', arguments: { path: 'safe.txt', content: 'safe\n' } });
assert(!safeWrite.isError, `safe mode unexpectedly required bootstrap: ${resultText(safeWrite)}`);
safe.close();

const off = await connect([...commonArgs, '--codex-compat', 'off'], commonEnv, 'codexpro-compat-off');
const offTools = await off.request('tools/list', {});
const offToolNames = offTools.tools.map((tool) => tool.name);
assert(!offToolNames.includes('codex_bootstrap') && !offToolNames.includes('load_skill_resource'), 'off mode exposed compatibility tools');
const offWrite = await off.request('tools/call', { name: 'write', arguments: { path: 'off.txt', content: 'off\n' } });
assert(!offWrite.isError, `off mode changed legacy write behavior: ${resultText(offWrite)}`);
off.close();

console.log('✓ codex compatibility smoke test passed');
