import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { minimatch } from "minimatch";
import { CodexProError, isSubpath } from "./guard.js";
const DEFAULT_PROJECT_DOC_MAX_BYTES = 32 * 1024;
const MAX_CONFIG_BYTES = 512 * 1024;
const MAX_SKILLS = 500;
const MAX_SKILL_FILE_BYTES = 2_000_000;
const SENSITIVE_BASENAMES = new Set([
    ".env",
    "auth.json",
    "credentials",
    "credentials.json",
    "cookies",
    "cookies.json",
    "id_ed25519",
    "id_rsa",
    "keychain",
    "secrets",
    "secrets.json"
]);
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function normalizeSlashes(value) {
    return value.split(path.sep).join("/");
}
function displayPath(absPath, config, workspace) {
    const codexDir = path.resolve(config.codexDir);
    if (absPath === workspace.root)
        return "$WORKSPACE";
    if (isSubpath(absPath, workspace.root)) {
        return `$WORKSPACE/${normalizeSlashes(path.relative(workspace.root, absPath))}`;
    }
    if (absPath === codexDir)
        return "$CODEX_HOME";
    if (isSubpath(absPath, codexDir)) {
        return `$CODEX_HOME/${normalizeSlashes(path.relative(codexDir, absPath))}`;
    }
    const home = os.homedir();
    if (absPath === home)
        return "~";
    if (isSubpath(absPath, home)) {
        return `~/${normalizeSlashes(path.relative(home, absPath))}`;
    }
    return absPath;
}
function regularFileRealpath(filePath) {
    try {
        const real = fs.realpathSync(filePath);
        return fs.statSync(real).isFile() ? real : undefined;
    }
    catch {
        return undefined;
    }
}
function directoryRealpath(dirPath) {
    try {
        const real = fs.realpathSync(dirPath);
        return fs.statSync(real).isDirectory() ? real : undefined;
    }
    catch {
        return undefined;
    }
}
async function readBoundedFile(filePath, maxBytes) {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile())
        throw new CodexProError(`Not a regular file: ${filePath}`);
    if (stat.size > maxBytes) {
        throw new CodexProError(`File exceeds the ${maxBytes}-byte compatibility limit: ${filePath}`);
    }
    return fsp.readFile(filePath);
}
function decodeText(buffer, label) {
    if (buffer.includes(0))
        throw new CodexProError(`Refusing to read binary content: ${label}`);
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    }
    catch {
        throw new CodexProError(`Refusing to read non-UTF-8 content: ${label}`);
    }
}
function parseTomlStringArray(raw) {
    try {
        const normalized = raw.replace(/'/g, '"').replace(/,\s*]/g, "]");
        const value = JSON.parse(normalized);
        return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
    }
    catch {
        return undefined;
    }
}
function pathMatchesBlockedGlobs(config, candidatePath) {
    const normalized = normalizeSlashes(candidatePath).replace(/^\.\//, "");
    return config.blockedGlobs.some((glob) => minimatch(normalized, glob, { dot: true, nocase: false, matchBase: false }) ||
        minimatch(path.posix.basename(normalized), glob, { dot: true, nocase: false, matchBase: true }));
}
function safeFallbackNames(values, source, warnings, config) {
    const names = [];
    for (const raw of values) {
        const name = raw.trim();
        const lower = name.toLowerCase();
        if (!name ||
            name === "." ||
            name === ".." ||
            name.includes("/") ||
            name.includes("\\") ||
            path.isAbsolute(name) ||
            path.win32.isAbsolute(name) ||
            SENSITIVE_BASENAMES.has(lower) ||
            pathMatchesBlockedGlobs(config, name)) {
            warnings.push(`Ignored unsafe project_doc_fallback_filenames entry in ${source}.`);
            continue;
        }
        if (!names.includes(name) && name !== "AGENTS.override.md" && name !== "AGENTS.md")
            names.push(name);
    }
    return names.slice(0, 20);
}
async function parseConfigLayer(filePath, config, workspace) {
    const real = regularFileRealpath(filePath);
    if (!real)
        return undefined;
    const requested = path.resolve(filePath);
    const projectConfig = isSubpath(requested, workspace.root);
    const codexRoot = directoryRealpath(config.codexDir);
    const globalConfig = isSubpath(requested, path.resolve(config.codexDir));
    if ((projectConfig && !isSubpath(real, workspace.root)) ||
        (globalConfig && (!codexRoot || !isSubpath(real, codexRoot)))) {
        return {
            path: displayPath(filePath, config, workspace),
            bytes: 0,
            sha256: sha256(""),
            keys: [],
            warnings: [`Ignored Codex config symlink escaping its trusted root: ${displayPath(filePath, config, workspace)}`]
        };
    }
    const buffer = await readBoundedFile(real, MAX_CONFIG_BYTES);
    const text = decodeText(buffer, displayPath(real, config, workspace));
    const keys = [...text.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)].map((match) => match[1]);
    const firstTable = text.search(/^\s*\[/m);
    const topLevelText = firstTable >= 0 ? text.slice(0, firstTable) : text;
    const warnings = [];
    let fallbackNames;
    const fallbackMatch = topLevelText.match(/^\s*project_doc_fallback_filenames\s*=\s*(\[[\s\S]*?\])\s*(?:#.*)?$/m);
    if (fallbackMatch) {
        const parsed = parseTomlStringArray(fallbackMatch[1]);
        if (parsed)
            fallbackNames = safeFallbackNames(parsed, displayPath(real, config, workspace), warnings, config);
        else
            warnings.push(`Could not parse project_doc_fallback_filenames in ${displayPath(real, config, workspace)}.`);
    }
    let maxBytes;
    const maxMatch = topLevelText.match(/^\s*project_doc_max_bytes\s*=\s*([0-9_]+)/m);
    if (maxMatch) {
        const parsed = Number(maxMatch[1].replaceAll("_", ""));
        if (Number.isSafeInteger(parsed) && parsed >= 1_000) {
            maxBytes = Math.min(parsed, config.maxReadBytes);
            if (parsed > config.maxReadBytes) {
                warnings.push(`Capped project_doc_max_bytes from ${displayPath(real, config, workspace)} at CODEXPRO_MAX_READ_BYTES.`);
            }
        }
        else {
            warnings.push(`Ignored invalid project_doc_max_bytes in ${displayPath(real, config, workspace)}.`);
        }
    }
    const uniqueKeys = [...new Set(keys)].sort();
    const compatibilityProjection = {
        keys: uniqueKeys,
        fallbackNames: fallbackNames ?? null,
        maxBytes: maxBytes ?? null
    };
    return {
        path: displayPath(real, config, workspace),
        bytes: buffer.byteLength,
        sha256: sha256(JSON.stringify(compatibilityProjection)),
        keys: uniqueKeys,
        fallbackNames,
        maxBytes,
        warnings
    };
}
function projectDirectories(workspace, targetDirectory) {
    const relative = path.relative(workspace.root, targetDirectory);
    const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
    const dirs = [workspace.root];
    let current = workspace.root;
    for (const part of parts) {
        current = path.join(current, part);
        dirs.push(current);
    }
    return dirs;
}
function targetDirectoryFor(guard, workspace, targetPath) {
    const resolved = guard.resolve(workspace, targetPath || ".");
    let targetDirectory = resolved.absPath;
    try {
        if (!fs.statSync(targetDirectory).isDirectory())
            targetDirectory = path.dirname(targetDirectory);
    }
    catch {
        targetDirectory = path.dirname(targetDirectory);
    }
    const realExisting = directoryRealpath(targetDirectory);
    if (realExisting)
        targetDirectory = realExisting;
    if (!isSubpath(targetDirectory, workspace.root)) {
        throw new CodexProError(`Bootstrap target escapes workspace: ${targetPath}`);
    }
    return {
        absPath: targetDirectory,
        relPath: normalizeSlashes(path.relative(workspace.root, targetDirectory) || ".")
    };
}
async function configCompatibility(config, workspace, dirs) {
    const candidates = [path.join(config.codexDir, "config.toml"), ...dirs.map((dir) => path.join(dir, ".codex", "config.toml"))];
    const layers = [];
    for (const candidate of candidates) {
        const layer = await parseConfigLayer(candidate, config, workspace);
        if (layer)
            layers.push(layer);
    }
    let fallbackNames = [];
    let maxBytes = Math.min(DEFAULT_PROJECT_DOC_MAX_BYTES, config.maxReadBytes);
    let fallbackSource;
    let maxBytesSource;
    const warnings = [];
    for (const layer of layers) {
        warnings.push(...layer.warnings);
        if (layer.fallbackNames !== undefined) {
            fallbackNames = layer.fallbackNames;
            fallbackSource = layer.path;
        }
        if (layer.maxBytes !== undefined) {
            maxBytes = layer.maxBytes;
            maxBytesSource = layer.path;
        }
    }
    const supported = new Set(["project_doc_fallback_filenames", "project_doc_max_bytes"]);
    const informationalKeys = new Set([
        "model",
        "model_provider",
        "model_reasoning_effort",
        "approval_policy",
        "sandbox_mode",
        "web_search",
        "features"
    ]);
    const discovered = new Set(layers.flatMap((layer) => layer.keys));
    const informational = [...discovered].filter((key) => informationalKeys.has(key) || key.startsWith("features.")).sort();
    const unsupported = [
        "approval_and_sandbox_policy",
        "authentication_and_credentials",
        "mcp_server_runtime",
        "model_and_reasoning_runtime",
        "native_plugin_runtime",
        "session_memory_and_logs",
        "system_bundled_skills",
        ...[...discovered].filter((key) => !supported.has(key) && !informational.includes(key))
    ].sort();
    return {
        fallbackNames,
        maxBytes,
        report: {
            sources: layers.map((layer) => ({ path: layer.path, bytes: layer.bytes, sha256: layer.sha256 })),
            applied: [
                { key: "project_doc_fallback_filenames", value: fallbackNames, source: fallbackSource },
                { key: "project_doc_max_bytes", value: maxBytes, source: maxBytesSource }
            ],
            informational,
            unsupported,
            warnings
        }
    };
}
async function instructionLayer(filePath, scope, order, maxBytes, config, workspace) {
    const real = regularFileRealpath(filePath);
    if (!real)
        return undefined;
    if (scope === "project" && !isSubpath(real, workspace.root))
        return undefined;
    const codexRoot = directoryRealpath(config.codexDir);
    if (scope === "global" && (!codexRoot || !isSubpath(real, codexRoot)))
        return undefined;
    const buffer = await readBoundedFile(real, maxBytes);
    const text = decodeText(buffer, displayPath(real, config, workspace));
    if (!text.trim())
        return undefined;
    return {
        order,
        scope,
        path: displayPath(real, config, workspace),
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
        text
    };
}
async function discoverInstructions(config, workspace, dirs, fallbackNames, maxBytes) {
    const layers = [];
    const globalCandidates = [
        path.join(config.codexDir, "AGENTS.override.md"),
        path.join(config.codexDir, "AGENTS.md")
    ];
    for (const candidate of globalCandidates) {
        const layer = await instructionLayer(candidate, "global", layers.length, maxBytes, config, workspace);
        if (layer) {
            layers.push(layer);
            break;
        }
    }
    const names = ["AGENTS.override.md", "AGENTS.md", ...fallbackNames];
    for (const dir of dirs) {
        for (const name of names) {
            const layer = await instructionLayer(path.join(dir, name), "project", layers.length, maxBytes, config, workspace);
            if (layer) {
                layers.push(layer);
                break;
            }
        }
    }
    return layers.map((layer, order) => ({ ...layer, order }));
}
function frontmatterValue(text, key) {
    const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match?.[1]?.trim().replace(/^["']|["']$/g, "");
}
async function safeReaddir(dir) {
    try {
        return await fsp.readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
async function findSkillFiles(root, depth, out) {
    if (depth < 0 || out.length >= MAX_SKILLS)
        return;
    for (const entry of await safeReaddir(root)) {
        if (out.length >= MAX_SKILLS)
            return;
        if (entry.name === ".git" || entry.name === "node_modules")
            continue;
        const candidate = path.join(root, entry.name);
        if (entry.isFile() && entry.name === "SKILL.md") {
            out.push(candidate);
        }
        else if (entry.isDirectory()) {
            await findSkillFiles(candidate, depth - 1, out);
        }
    }
}
function skillRoots(config, workspace, dirs) {
    const roots = [
        { root: "/etc/codex/skills", anchor: "/etc/codex", source: "admin", priority: 10, depth: 3 },
        {
            root: path.join(config.codexDir, "plugins", "cache"),
            anchor: config.codexDir,
            source: "plugin",
            priority: 20,
            depth: 9
        },
        {
            root: path.join(config.codexDir, "skills"),
            anchor: config.codexDir,
            source: "user",
            priority: 30,
            depth: 3
        },
        {
            root: path.join(os.homedir(), ".agents", "skills"),
            anchor: path.join(os.homedir(), ".agents"),
            source: "user",
            priority: 31,
            depth: 3
        }
    ];
    dirs.forEach((dir, index) => {
        roots.push({
            root: path.join(dir, ".codex", "skills"),
            anchor: workspace.root,
            source: "project",
            priority: 100 + index * 2,
            depth: 3
        }, {
            root: path.join(dir, ".agents", "skills"),
            anchor: workspace.root,
            source: "project",
            priority: 101 + index * 2,
            depth: 3
        });
    });
    return roots;
}
async function discoverSkills(config, workspace, dirs) {
    const records = [];
    const seenPaths = new Set();
    for (const candidate of skillRoots(config, workspace, dirs)) {
        const realRoot = directoryRealpath(candidate.root);
        const realAnchor = directoryRealpath(candidate.anchor);
        if (!realRoot || !realAnchor || !isSubpath(realRoot, realAnchor))
            continue;
        const files = [];
        await findSkillFiles(realRoot, candidate.depth, files);
        for (const file of files) {
            if (records.length >= MAX_SKILLS)
                break;
            const realFile = regularFileRealpath(file);
            if (!realFile || !isSubpath(realFile, realRoot) || seenPaths.has(realFile))
                continue;
            seenPaths.add(realFile);
            const buffer = await readBoundedFile(realFile, Math.min(MAX_SKILL_FILE_BYTES, config.maxReadBytes));
            const text = decodeText(buffer, displayPath(realFile, config, workspace));
            const absSkillRoot = path.dirname(realFile);
            records.push({
                name: frontmatterValue(text, "name") ?? path.basename(absSkillRoot),
                description: frontmatterValue(text, "description"),
                source: candidate.source,
                skillPath: displayPath(realFile, config, workspace),
                skillRoot: displayPath(absSkillRoot, config, workspace),
                bytes: buffer.byteLength,
                sha256: sha256(buffer),
                active: true,
                absSkillPath: realFile,
                absSkillRoot,
                priority: candidate.priority
            });
        }
        if (records.length >= MAX_SKILLS) {
            throw new CodexProError(`Codex skill discovery reached the ${MAX_SKILLS}-skill safety limit. ` +
                "Reduce the configured skill roots before relying on a strict bootstrap.");
        }
    }
    const activeByName = new Map();
    for (const record of [...records].sort((a, b) => a.priority - b.priority || a.skillPath.localeCompare(b.skillPath))) {
        activeByName.set(record.name, record);
    }
    for (const record of records) {
        const active = activeByName.get(record.name);
        record.active = active === record;
        if (!record.active && active)
            record.shadowedBy = active.skillPath;
    }
    return records.sort((a, b) => Number(b.active) - Number(a.active) ||
        a.name.localeCompare(b.name) ||
        b.priority - a.priority ||
        a.skillPath.localeCompare(b.skillPath));
}
function publicSkill(record) {
    const { absSkillPath: _absSkillPath, absSkillRoot: _absSkillRoot, priority: _priority, ...item } = record;
    return item;
}
function publicContext(context) {
    return {
        ...context,
        instructionLayers: context.instructionLayers.map((layer) => ({ ...layer })),
        skills: context.skills.map((skill) => ({ ...skill }))
    };
}
export async function buildCodexBootstrapContext(config, guard, workspace, targetPath = ".") {
    if (config.codexCompatMode === "off") {
        throw new CodexProError("Codex compatibility is disabled. Start CodexPro with --codex-compat safe or strict.");
    }
    const target = targetDirectoryFor(guard, workspace, targetPath);
    const dirs = projectDirectories(workspace, target.absPath);
    const compatibility = await configCompatibility(config, workspace, dirs);
    const instructionLayers = await discoverInstructions(config, workspace, dirs, compatibility.fallbackNames, compatibility.maxBytes);
    const skillRecords = await discoverSkills(config, workspace, dirs);
    const skills = skillRecords.map(publicSkill);
    const effectiveInstructions = instructionLayers.map((layer) => layer.text).join("\n\n");
    const hashPayload = {
        mode: config.codexCompatMode,
        instructions: instructionLayers.map(({ order, scope, path: sourcePath, bytes, sha256: digest }) => ({
            order,
            scope,
            path: sourcePath,
            bytes,
            sha256: digest
        })),
        skills: skills.map(({ name, source, skillPath, bytes, sha256: digest, active, shadowedBy }) => ({
            name,
            source,
            skillPath,
            bytes,
            sha256: digest,
            active,
            shadowedBy
        })),
        config: {
            sources: compatibility.report.sources.map(({ path: sourcePath, sha256: digest }) => ({
                path: sourcePath,
                sha256: digest
            })),
            applied: compatibility.report.applied,
            informational: compatibility.report.informational,
            unsupported: compatibility.report.unsupported,
            warnings: compatibility.report.warnings
        }
    };
    return {
        workspaceId: workspace.id,
        workspaceRoot: workspace.root,
        targetDirectory: target.relPath,
        mode: config.codexCompatMode,
        instructionLayers,
        effectiveInstructions,
        skills,
        configCompatibility: compatibility.report,
        contextHash: sha256(JSON.stringify(hashPayload))
    };
}
export class CodexBootstrapRegistry {
    config;
    guard;
    contextsByWorkspace = new Map();
    constructor(config, guard) {
        this.config = config;
        this.guard = guard;
    }
    async bootstrap(workspace, targetPath = ".") {
        const context = await buildCodexBootstrapContext(this.config, this.guard, workspace, targetPath);
        const bindingHash = sha256(JSON.stringify({
            workspaceId: workspace.id,
            targetDirectory: context.targetDirectory,
            mode: context.mode,
            contextHash: context.contextHash
        }));
        const bootstrapToken = `cb_${bindingHash.slice(0, 20)}_${randomBytes(12).toString("hex")}`;
        const workspaceContexts = this.contextsByWorkspace.get(workspace.id) ?? new Map();
        workspaceContexts.set(context.targetDirectory, context.contextHash);
        this.contextsByWorkspace.set(workspace.id, workspaceContexts);
        return {
            ...publicContext(context),
            bootstrapToken,
            bootstrappedAt: new Date().toISOString()
        };
    }
    async assertFresh(workspace, targetPath) {
        if (this.config.codexCompatMode !== "strict")
            return undefined;
        const current = await buildCodexBootstrapContext(this.config, this.guard, workspace, targetPath);
        const stored = this.contextsByWorkspace.get(workspace.id);
        if (!stored || ![...stored.values()].includes(current.contextHash)) {
            throw new CodexProError(`Strict Codex compatibility requires a fresh codex_bootstrap for ${current.targetDirectory}. ` +
                `Call codex_bootstrap with target_path="${current.targetDirectory}" before this operation.`);
        }
        return current;
    }
}
function resourcePathIsBlocked(config, resourcePath) {
    const normalized = normalizeSlashes(resourcePath).replace(/^\.\//, "");
    if (normalized.split("/").some((part) => SENSITIVE_BASENAMES.has(part.toLowerCase())))
        return true;
    return pathMatchesBlockedGlobs(config, normalized);
}
export async function loadCodexSkillResource(config, guard, workspace, options) {
    const name = options.name.trim();
    if (!name)
        throw new CodexProError("Skill name is required.");
    const resourcePath = options.resourcePath.trim().replaceAll("\\", "/");
    if (!resourcePath ||
        resourcePath.includes("\0") ||
        path.posix.isAbsolute(resourcePath) ||
        path.win32.isAbsolute(resourcePath) ||
        resourcePath.split("/").some((part) => part === "." || part === ".." || part === "")) {
        throw new CodexProError("resource_path must be a normalized relative path inside the selected skill.");
    }
    if (resourcePathIsBlocked(config, resourcePath)) {
        throw new CodexProError(`Skill resource is blocked by safety rules: ${resourcePath}`);
    }
    const target = targetDirectoryFor(guard, workspace, options.targetPath ?? ".");
    const records = await discoverSkills(config, workspace, projectDirectories(workspace, target.absPath));
    const matches = records.filter((record) => record.name === name &&
        (!options.source || record.source === options.source) &&
        (!options.skillPath || record.skillPath === options.skillPath));
    if (!matches.length)
        throw new CodexProError(`Discovered skill not found: ${name}`);
    if (matches.length > 1) {
        throw new CodexProError(`Multiple discovered skills named ${name}; pass source and skill_path. ` +
            matches.map((record) => `${record.source}:${record.skillPath}`).join(", "));
    }
    const [skill] = matches;
    const candidate = path.resolve(skill.absSkillRoot, resourcePath);
    if (!isSubpath(candidate, skill.absSkillRoot)) {
        throw new CodexProError(`Skill resource escapes its root: ${resourcePath}`);
    }
    const real = regularFileRealpath(candidate);
    if (!real || !isSubpath(real, skill.absSkillRoot)) {
        throw new CodexProError(`Skill resource is missing, not a regular file, or escapes through a symlink: ${resourcePath}`);
    }
    const limit = Math.max(1_000, Math.min(options.maxBytes ?? config.maxReadBytes, config.maxReadBytes));
    const buffer = await readBoundedFile(real, limit);
    return {
        skill: publicSkill(skill),
        resourcePath,
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
        text: decodeText(buffer, resourcePath)
    };
}
//# sourceMappingURL=codexCompat.js.map