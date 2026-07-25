import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHome } from "./config.js";
export function codexProHome() {
    const customHome = process.env.CODEXPRO_HOME;
    return customHome ? path.resolve(expandHome(customHome)) : path.join(os.homedir(), ".codexpro");
}
export function profileDir() {
    return path.join(codexProHome(), "profiles");
}
export function profileIdForRoot(root) {
    return createHash("sha256").update(root).digest("hex").slice(0, 24);
}
export function profilePathForRoot(root) {
    return path.join(profileDir(), `${profileIdForRoot(root)}.json`);
}
export function runtimeDir() {
    return path.join(codexProHome(), "runtime");
}
export function runtimeStatusPathForRoot(root) {
    return path.join(runtimeDir(), `${profileIdForRoot(root)}.json`);
}
function readJsonFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
            return {};
        throw error;
    }
}
export function readWorkspaceProfile(root) {
    const profilePath = profilePathForRoot(root);
    if (!fs.existsSync(profilePath))
        return {};
    const profile = readJsonFile(profilePath);
    if (!profile || typeof profile !== "object" || Array.isArray(profile))
        return {};
    const typed = profile;
    if (typed.root && typed.root !== root)
        return {};
    return { ...typed, profilePath };
}
export function saveWorkspaceProfile(root, profile) {
    const dir = profileDir();
    const filePath = profilePathForRoot(root);
    const { profilePath: _profilePath, ...rest } = profile;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        ...rest,
        root
    };
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    try {
        fs.chmodSync(filePath, 0o600);
    }
    catch {
        // Best-effort permission repair for filesystems that support chmod.
    }
    return filePath;
}
export function sanitizeWorkspaceProfile(profile) {
    if (!profile || !Object.keys(profile).length)
        return {};
    const { token, cloudflareToken, ...rest } = profile;
    return {
        ...rest,
        ...(token ? { token: "<saved>" } : {}),
        ...(cloudflareToken ? { cloudflareToken: "<saved>" } : {})
    };
}
export function readRuntimeConnection(root) {
    const runtimePath = runtimeStatusPathForRoot(root);
    if (!fs.existsSync(runtimePath))
        return {};
    const runtime = readJsonFile(runtimePath);
    if (!runtime || typeof runtime !== "object" || Array.isArray(runtime))
        return {};
    const typed = runtime;
    if (typed.root && typed.root !== root)
        return {};
    return typed;
}
//# sourceMappingURL=profileStore.js.map