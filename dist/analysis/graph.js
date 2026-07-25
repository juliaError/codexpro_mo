export function buildRelationships(extractedFiles, inventoryFiles, maxRelationships) {
    const roles = new Map(inventoryFiles.map((file) => [file.path, file.role]));
    const relationships = [];
    for (const file of extractedFiles) {
        for (const target of file.imports) {
            if (relationships.length >= maxRelationships)
                return relationships;
            relationships.push({
                from: file.path,
                to: target,
                kind: roles.get(file.path) === "test" ? "tests" : "imports",
                confidence: "strong",
                source: "built-in import extraction"
            });
        }
    }
    return relationships;
}
export function reverseDependencies(relationships, targetPath) {
    return relationships.filter((relationship) => relationship.to === targetPath);
}
//# sourceMappingURL=graph.js.map