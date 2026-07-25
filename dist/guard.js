import fs from "node:fs";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { minimatch } from "minimatch";
import { expandHome } from "./config.js";
export class CodexProError extends Error {
    constructor(message) {
        super(message);
        this.name = "CodexProError";
    }
}
export function isSubpath(child, parent) {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export function normalizeRelPath(relPath) {
    const normalized = relPath.split(path.sep).join("/");
    if (normalized === "")
        return ".";
    return normalized;
}
export function displayPath(absPath, root) {
    const rel = path.relative(root, absPath) || ".";
    return normalizeRelPath(rel);
}
function workspaceIdForRoot(realRoot) {
    return `ws_${createHash("sha256").update(realRoot).digest("hex").slice(0, 24)}`;
}
function maybeRealpath(existingPath) {
    try {
        return fs.realpathSync(existingPath);
    }
    catch {
        return undefined;
    }
}
function closestExistingParent(absPath) {
    let current = path.resolve(absPath);
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return current;
}
export class WorkspaceManager {
    config;
    workspaces = new Map();
    constructor(config) {
        this.config = config;
    }
    defaultWorkspace() {
        const existing = [...this.workspaces.values()].find((workspace) => workspace.root === this.config.defaultRoot);
        return existing ?? this.openWorkspace(this.config.defaultRoot);
    }
    openWorkspace(rootInput) {
        const requested = rootInput?.trim() ? expandHome(rootInput.trim()) : this.config.defaultRoot;
        const resolved = path.resolve(requested);
        if (!fs.existsSync(resolved)) {
            throw new CodexProError(`Workspace root does not exist: ${resolved}`);
        }
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
            throw new CodexProError(`Workspace root is not a directory: ${resolved}`);
        }
        const realRoot = fs.realpathSync(resolved);
        const allowed = this.config.allowedRoots.some((allowedRoot) => isSubpath(realRoot, allowedRoot));
        if (!allowed) {
            throw new CodexProError(`Workspace root is outside allowed roots: ${realRoot}\nAllowed roots:\n${this.config.allowedRoots.map((r) => `- ${r}`).join("\n")}`);
        }
        const existing = [...this.workspaces.values()].find((workspace) => workspace.root === realRoot);
        if (existing)
            return existing;
        const id = workspaceIdForRoot(realRoot);
        const workspace = { id, root: realRoot, openedAt: new Date().toISOString() };
        this.workspaces.set(id, workspace);
        return workspace;
    }
    getWorkspace(id) {
        if (!id)
            return this.defaultWorkspace();
        const workspace = this.workspaces.get(id);
        if (!workspace) {
            throw new CodexProError(`Unknown workspace_id: ${id}. Call open_workspace first.`);
        }
        return workspace;
    }
    listWorkspaces() {
        return [...this.workspaces.values()];
    }
}
export class PathGuard {
    config;
    constructor(config) {
        this.config = config;
    }
    isBlockedRelativePath(relPath) {
        const rel = normalizeRelPath(relPath).replace(/^\.\//, "");
        if (!rel || rel === ".")
            return false;
        return this.config.blockedGlobs.some((glob) => minimatch(rel, glob, { dot: true, nocase: false, matchBase: false }) ||
            minimatch(path.basename(rel), glob, { dot: true, nocase: false, matchBase: true }));
    }
    assertNotBlocked(relPath) {
        if (this.isBlockedRelativePath(relPath)) {
            throw new CodexProError(`Path is blocked by safety rules: ${relPath}`);
        }
    }
    resolve(workspace, inputPath = ".", options = {}) {
        const expanded = expandHome(inputPath || ".");
        const candidate = path.isAbsolute(expanded) ? expanded : path.join(workspace.root, expanded);
        let absPath = path.resolve(candidate);
        const realTarget = maybeRealpath(absPath);
        let relPath = displayPath(absPath, workspace.root);
        if (!isSubpath(absPath, workspace.root)) {
            if (realTarget && isSubpath(realTarget, workspace.root)) {
                absPath = realTarget;
                relPath = displayPath(realTarget, workspace.root);
            }
            else if (options.forWrite) {
                const parent = closestExistingParent(path.dirname(absPath));
                const realParent = maybeRealpath(parent);
                if (!realParent || !isSubpath(realParent, workspace.root)) {
                    throw new CodexProError(`Path escapes workspace root: ${inputPath}`);
                }
                absPath = path.resolve(realParent, path.relative(parent, absPath));
                relPath = displayPath(absPath, workspace.root);
            }
            else {
                throw new CodexProError(`Path escapes workspace root: ${inputPath}`);
            }
        }
        this.assertNotBlocked(relPath);
        if (realTarget) {
            if (!isSubpath(realTarget, workspace.root)) {
                throw new CodexProError(`Path resolves outside workspace root through a symlink: ${inputPath}`);
            }
            const realRel = displayPath(realTarget, workspace.root);
            this.assertNotBlocked(realRel);
        }
        if (options.forWrite) {
            try {
                if (fs.lstatSync(absPath).isSymbolicLink()) {
                    throw new CodexProError(`Refusing to write through a symlink: ${inputPath}`);
                }
            }
            catch (error) {
                if (error instanceof CodexProError)
                    throw error;
            }
            const parent = closestExistingParent(path.dirname(absPath));
            const realParent = maybeRealpath(parent);
            if (realParent && !isSubpath(realParent, workspace.root)) {
                throw new CodexProError(`Write path resolves through a parent outside the workspace: ${inputPath}`);
            }
            if (realParent) {
                const realParentRel = displayPath(realParent, workspace.root);
                this.assertNotBlocked(realParentRel);
            }
        }
        return { absPath, relPath };
    }
    async assertTextFile(absPath, maxBytes) {
        const stat = await fsp.stat(absPath);
        if (!stat.isFile()) {
            throw new CodexProError(`Not a file: ${absPath}`);
        }
        if (stat.size > maxBytes) {
            throw new CodexProError(`File is too large (${stat.size} bytes). Limit: ${maxBytes} bytes.`);
        }
        if (stat.size === 0)
            return;
        const handle = await fsp.open(absPath, "r");
        try {
            const sample = Buffer.alloc(Math.min(64 * 1024, stat.size));
            let offset = 0;
            while (offset < stat.size) {
                const { bytesRead } = await handle.read(sample, 0, sample.length, offset);
                if (bytesRead === 0)
                    break;
                if (sample.subarray(0, bytesRead).includes(0)) {
                    throw new CodexProError("Refusing to read binary file.");
                }
                offset += bytesRead;
            }
        }
        finally {
            await handle.close();
        }
    }
}
export function userHome() {
    return os.homedir();
}
//# sourceMappingURL=guard.js.map