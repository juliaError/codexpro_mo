import fsp from "node:fs/promises";
import path from "node:path";
import { detectRiskSignals } from "./classify.js";
import { inspectWorkspace } from "./index.js";
const RISK_LABELS = {
    "public-api": "Public API",
    authentication: "Authentication or sessions",
    storage: "Storage or persistence",
    migration: "Schema or migration",
    build: "Build or dependency configuration",
    configuration: "Runtime configuration"
};
const SCRIPT_PRIORITY = ["test", "test:unit", "typecheck", "lint", "build", "check"];
const SAFE_SCRIPT = /^[A-Za-z0-9._:-]+$/;
async function packageRunner(guard, workspace, packageJson) {
    const declared = typeof packageJson.packageManager === "string"
        ? packageJson.packageManager.match(/^(npm|pnpm|yarn|bun)(?:@|$)/)?.[1]
        : undefined;
    if (declared)
        return declared;
    const lockfiles = [
        ["pnpm-lock.yaml", "pnpm"],
        ["yarn.lock", "yarn"],
        ["bun.lock", "bun"],
        ["bun.lockb", "bun"],
        ["package-lock.json", "npm"],
        ["npm-shrinkwrap.json", "npm"]
    ];
    for (const [lockfile, runner] of lockfiles) {
        try {
            if ((await fsp.stat(guard.resolve(workspace, lockfile).absPath)).isFile())
                return runner;
        }
        catch {
            // Continue to the next package-manager marker.
        }
    }
    return "npm";
}
function packageCommand(runner, script) {
    if (runner === "npm")
        return script === "test" ? "npm test" : `npm run ${script}`;
    if (runner === "pnpm")
        return script === "test" ? "pnpm test" : `pnpm run ${script}`;
    return `${runner} run ${script}`;
}
async function packageRecommendations(guard, workspace) {
    try {
        const resolved = guard.resolve(workspace, "package.json");
        const parsed = JSON.parse(await fsp.readFile(resolved.absPath, "utf8"));
        const scripts = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
        const runner = await packageRunner(guard, workspace, parsed);
        return SCRIPT_PRIORITY
            .filter((name) => typeof scripts[name] === "string" && SAFE_SCRIPT.test(name))
            .map((name) => ({
            command: packageCommand(runner, name),
            source: "package.json",
            reasons: ["existing project script", `${runner} project`, name.includes("test") ? "related test coverage" : "project verification"]
        }));
    }
    catch {
        return [];
    }
}
async function nativeRecommendations(guard, workspace) {
    const candidates = [
        { manifest: "go.mod", command: "go test ./..." },
        { manifest: "Cargo.toml", command: "cargo test" },
        { manifest: "Package.swift", command: "swift test" },
        { manifest: "pyproject.toml", command: "python3 -m pytest" },
        { manifest: "pom.xml", command: "mvn test" }
    ];
    const recommendations = [];
    for (const candidate of candidates) {
        try {
            const resolved = guard.resolve(workspace, candidate.manifest);
            const stat = await fsp.stat(resolved.absPath);
            if (!stat.isFile())
                continue;
            recommendations.push({
                command: candidate.command,
                source: candidate.manifest,
                reasons: ["detected project manifest", "native project verification"]
            });
        }
        catch {
            // Missing or blocked manifests do not create recommendations.
        }
    }
    return recommendations;
}
export async function reviewWorkspaceChanges(config, guard, workspace, options) {
    const changedPaths = [];
    const pathWarnings = [];
    for (const candidate of options.changedPaths) {
        try {
            const relPath = guard.resolve(workspace, candidate).relPath;
            if (!changedPaths.includes(relPath))
                changedPaths.push(relPath);
        }
        catch {
            pathWarnings.push(`Skipped unsafe or unreadable changed path: ${candidate}`);
        }
    }
    const analysis = await inspectWorkspace(config, guard, workspace);
    const affectedAreas = [...new Set(changedPaths.map((filePath) => filePath.includes("/") ? filePath.split("/")[0] : "."))].sort();
    const changed = new Set(changedPaths);
    const dependents = new Map();
    const tests = new Map();
    for (const relationship of analysis.relationships) {
        if (!changed.has(relationship.to))
            continue;
        const target = relationship.kind === "tests" ? tests : dependents;
        const reasons = target.get(relationship.from) ?? new Set();
        reasons.add(`${relationship.kind} ${relationship.to}`);
        target.set(relationship.from, reasons);
    }
    const directTestCandidates = analysis.files.filter((file) => file.role === "test" && changedPaths.some((changedPath) => {
        const base = path.basename(changedPath).replace(/\.[^.]+$/, "").toLowerCase();
        return base.length > 2 && file.path.toLowerCase().includes(base);
    }));
    for (const test of directTestCandidates) {
        const reasons = tests.get(test.path) ?? new Set();
        reasons.add("test filename matches changed source");
        tests.set(test.path, reasons);
    }
    const risks = new Map();
    for (const changedPath of changedPaths) {
        for (const risk of detectRiskSignals(changedPath)) {
            const paths = risks.get(risk) ?? new Set();
            paths.add(changedPath);
            risks.set(risk, paths);
        }
    }
    const riskSignals = [...risks.entries()].map(([id, paths]) => ({
        id,
        label: RISK_LABELS[id],
        confidence: "inferred",
        paths: [...paths].sort(),
        reasons: [`path pattern matched ${id}`]
    }));
    const resultLimit = Math.max(1, config.maxSearchResults);
    const dependentFiles = [...dependents.entries()]
        .map(([filePath, reasons]) => ({ path: filePath, confidence: "strong", reasons: [...reasons] }))
        .sort((a, b) => a.path.localeCompare(b.path));
    const relatedTests = [...tests.entries()]
        .map(([filePath, reasons]) => ({ path: filePath, confidence: "strong", reasons: [...reasons] }))
        .sort((a, b) => a.path.localeCompare(b.path));
    const impactLimited = dependentFiles.length > resultLimit || relatedTests.length > resultLimit;
    return {
        schemaVersion: 1,
        changedPaths,
        affectedAreas,
        dependentFiles: dependentFiles.slice(0, resultLimit),
        relatedTests: relatedTests.slice(0, resultLimit),
        riskSignals,
        recommendedCommands: [...await packageRecommendations(guard, workspace), ...await nativeRecommendations(guard, workspace)],
        coverage: analysis.coverage,
        warnings: [
            ...analysis.warnings,
            ...pathWarnings,
            ...(impactLimited ? [`Change-impact output was limited to ${resultLimit} dependent files and ${resultLimit} related tests.`] : [])
        ],
        cache: analysis.cache
    };
}
//# sourceMappingURL=impact.js.map