import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const upstreamRoot = path.join(repoRoot, "reference/recombyn");
const sourceRoot = "apps/web/src";
const pluginRoot = "plugins/canvas";
const auditPath = path.join(repoRoot, "docs/research/recombyn-stage1-upstream-closure-audit.json");
const expectedUpstreamCommit = "abd81983716b41c7fc6e2f591c23e6d9bb9c4643";

execFileSync("git", ["-C", upstreamRoot, "cat-file", "-e", `${expectedUpstreamCommit}^{commit}`]);
const pinnedFiles = new Set(
  execFileSync("git", ["-C", upstreamRoot, "ls-tree", "-r", "--name-only", expectedUpstreamCommit], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter(Boolean),
);

const entries = [
  "apps/web/src/pages/EditorPage.tsx",
  "apps/web/src/i18n/index.ts",
  "apps/web/src/styles/index.css",
  "apps/web/src/styles/fonts.css",
  "apps/web/src/theme/light.css",
  "apps/web/src/theme/dark.css",
  "apps/web/src/components/editor/chrome/EditorToolStrip.tsx",
  "apps/web/src/components/editor/chrome/EditorShortcutsPanel.tsx",
  "apps/web/src/components/editor/panels/LayerPanel.tsx",
  "apps/web/src/components/editor/panels/AssetPanel.tsx",
  "apps/web/src/components/rcb/selection/chrome/SelectionContextToolbar.tsx",
  "apps/web/src/components/editor/page/EditorStageWorld.tsx",
  "apps/web/src/components/editor/canvas/SvgCanvas.tsx",
];

const sourceExtensions = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".js",
  ".jsx",
  ".json",
  ".css",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".woff",
  ".woff2",
];

const objectCache = new Map();

function readObject(file) {
  if (!objectCache.has(file)) {
    objectCache.set(
      file,
      execFileSync("git", ["-C", upstreamRoot, "show", `${expectedUpstreamCommit}:${file}`], {
        encoding: null,
        maxBuffer: 32 * 1024 * 1024,
      }),
    );
  }
  return objectCache.get(file);
}

function objectExists(file) {
  return pinnedFiles.has(file);
}

function sha256(file) {
  return createHash("sha256").update(readObject(file)).digest("hex");
}

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function resolveCandidate(base) {
  for (const extension of sourceExtensions) {
    const candidate = `${base}${extension}`;
    if (objectExists(candidate)) return candidate;
  }
  for (const extension of sourceExtensions.slice(1)) {
    const candidate = path.posix.join(base, `index${extension}`);
    if (objectExists(candidate)) return candidate;
  }
  return null;
}

function resolveLocal(fromFile, specifier) {
  specifier = specifier.split("?")[0];
  if (specifier.startsWith("@/")) {
    return resolveCandidate(path.posix.join(sourceRoot, specifier.slice(2)));
  }
  if (specifier.startsWith("@canvas-plugins/")) {
    return resolveCandidate(path.posix.join(pluginRoot, specifier.slice("@canvas-plugins/".length)));
  }
  if (specifier.startsWith(".")) {
    return resolveCandidate(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)));
  }
  return null;
}

function importSpecifiers(file) {
  const text = readObject(file).toString("utf8");
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const values = new Set();
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      values.add(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      values.add(node.arguments[0].text);
    }
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(source) === "URL" &&
      node.arguments?.length === 2 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[1].getText(source) === "import.meta.url"
    ) {
      values.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (file === "apps/web/src/pages/EditorPage.tsx") {
    const stageOneRemovedImports = new Set([
      "@/utils/homeAgentBoot",
      "@/utils/authReturnTo",
      "@/components/editor/panels/AgentComposerInput",
      "@/components/editor/panels/AgentDock",
      "@/components/editor/panels/agent/AgentComposerShell",
    ]);
    return [...values].filter((specifier) => !stageOneRemovedImports.has(specifier));
  }
  if (file === "apps/web/src/components/editor/panels/AgentComposerInput.tsx") {
    return [...values].filter(
      (specifier) => specifier !== "@/components/editor/panels/agent/runDesignAgent",
    );
  }
  if (file === "apps/web/src/utils/uploadImage.ts") {
    const stageOneRemovedImports = new Set([
      "@/service/upload",
      "@/utils/apiBase",
      "@/utils/token",
    ]);
    return [...values].filter((specifier) => !stageOneRemovedImports.has(specifier));
  }
  if (file === "apps/web/src/service/chat.ts") {
    return [...values].filter((specifier) => specifier !== "@/utils/request");
  }
  if (
    file === "apps/web/src/components/editor/nodes/ImageNode/ImageQuickEditComposer.tsx" ||
    file === "apps/web/src/components/editor/nodes/VideoNode/VideoQuickEditComposer.tsx"
  ) {
    const stageOneRemovedImports = new Set(["@tanstack/react-query", "@/service/chat", "@/service/client"]);
    return [...values].filter((specifier) => !stageOneRemovedImports.has(specifier));
  }
  return [...values].filter((specifier) => specifier !== "@/service/design");
}

function classify(file) {
  const name = file;
  if (name.includes("/panels/agent/") || name.includes("/service/chat") || name.includes("/utils/chat")) {
    return "agent-chat";
  }
  if (name.includes("/store/")) return "store";
  if (name.includes("/service/") || name.includes("/utils/api") || name.includes("/api/")) return "api-service";
  if (name.includes("/components/rcb/")) return "rcb";
  if (name.includes("/components/editor/nodes/")) return "nodes";
  if (name.includes("/components/editor/chrome/")) return "chrome";
  if (name.includes("/components/editor/")) return "editor-other";
  if (name.startsWith("plugins/canvas/")) return "canvas-plugin";
  return "other";
}

function audit(entry) {
  const pending = [entry];
  const files = new Set();
  const externals = new Set();
  const unresolved = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (files.has(file)) continue;
    files.add(file);
    if (!/[cm]?[jt]sx?$/.test(file)) continue;
    for (const specifier of importSpecifiers(file)) {
      const local = resolveLocal(file, specifier);
      if (local) {
        if (!files.has(local)) pending.push(local);
      } else if (specifier.startsWith(".") || specifier.startsWith("@/")) {
        unresolved.add(`${file} -> ${specifier}`);
      } else {
        externals.add(packageName(specifier));
      }
    }
  }
  const sortedFiles = [...files].sort();
  const groups = Object.fromEntries(
    [...new Set(sortedFiles.map(classify))]
      .sort()
      .map((group) => [group, sortedFiles.filter((file) => classify(file) === group).length]),
  );
  return {
    entry,
    fileCount: sortedFiles.length,
    bytes: sortedFiles.reduce((total, file) => total + readObject(file).length, 0),
    groups,
    externalPackages: [...externals].sort(),
    unresolvedImports: [...unresolved].sort(),
    files: sortedFiles.map((file) => ({ path: file, sha256: sha256(file) })),
  };
}

const perEntry = entries.map(audit);
const combinedFiles = new Map();
for (const result of perEntry) {
  for (const file of result.files) combinedFiles.set(file.path, file.sha256);
}
const combinedExternalPackages = [...new Set(perEntry.flatMap((entry) => entry.externalPackages))].sort();
const combined = [...combinedFiles].sort(([left], [right]) => left.localeCompare(right));

const result = {
  generatedAt: "2026-08-15",
  upstreamCommit: expectedUpstreamCommit,
  resolver: {
    aliases: { "@/": "apps/web/src/", "@canvas-plugins/": "plugins/canvas/" },
    note: "Pinned Git object resolver for static import/export, string-literal dynamic import, and new URL(path, import.meta.url); no checkout dependency, runtime-discovered modules, or CSS url() parsing.",
  },
  summary: {
    entryCount: entries.length,
    combinedFileCount: combined.length,
    combinedBytes: combined.reduce(
      (total, [name]) => total + readObject(name).length,
      0,
    ),
    combinedExternalPackageCount: combinedExternalPackages.length,
    combinedExternalPackages,
  },
  entries: perEntry,
  combinedFiles: combined.map(([file, hash]) => ({ path: file, sha256: hash })),
};
mkdirSync(path.dirname(auditPath), { recursive: true });
writeFileSync(auditPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `Audited Recombyn ${expectedUpstreamCommit}: ${result.summary.combinedFileCount} files -> ${path.relative(repoRoot, auditPath)}\n`,
);
