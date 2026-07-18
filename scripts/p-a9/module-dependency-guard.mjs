import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const DOMAIN_DIRS = ["messages", "tasks", "agents", "channels", "files"];
const FORBIDDEN_TARGET_DIRS = ["server", "desktop"];

export const P_A9_TEMPORARY_ALLOWLIST = Object.freeze([Object.freeze({
  from: "src/agents/agentDeletion.ts",
  specifier: "../server/storage.js",
  to: "src/server/storage.ts",
})]);

function slash(value) {
  return value.split(path.sep).join("/");
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(full));
    else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !/\.(?:test|spec)\.[cm]?tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

function moduleSpecifiers(sourceText, filename) {
  const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true);
  const out = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return out;
}

function resolveLocalModule(sourceFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const raw = path.resolve(path.dirname(sourceFile), specifier);
  const withoutJs = raw.replace(/\.(?:mjs|cjs|js|jsx)$/, "");
  const candidates = [
    raw,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    `${withoutJs}.mts`,
    `${withoutJs}.cts`,
    path.join(raw, "index.ts"),
    path.join(raw, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function sameEdge(left, right) {
  return left.from === right.from && left.specifier === right.specifier && left.to === right.to;
}

export function analyzeModuleDependencies(root, allowlist = P_A9_TEMPORARY_ALLOWLIST) {
  const sourceRoot = path.join(root, "src");
  const domainFiles = DOMAIN_DIRS.flatMap((directory) => filesUnder(path.join(sourceRoot, directory))).sort();
  const forbidden = [];
  for (const filename of domainFiles) {
    const sourceText = ts.sys.readFile(filename) ?? "";
    for (const specifier of moduleSpecifiers(sourceText, filename)) {
      const target = resolveLocalModule(filename, specifier);
      if (!target) continue;
      const from = slash(path.relative(root, filename));
      const to = slash(path.relative(root, target));
      if (!FORBIDDEN_TARGET_DIRS.some((directory) => to.startsWith(`src/${directory}/`))) continue;
      forbidden.push({ from, specifier, to });
    }
  }

  const consumedAllowlist = allowlist.filter((allowed) => forbidden.some((edge) => sameEdge(edge, allowed)));
  const staleAllowlist = allowlist.filter((allowed) => !consumedAllowlist.some((edge) => sameEdge(edge, allowed)));
  const violations = forbidden.filter((edge) => !allowlist.some((allowed) => sameEdge(edge, allowed)));
  return { violations, consumedAllowlist, staleAllowlist };
}

function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const result = analyzeModuleDependencies(root);
  if (result.violations.length || result.staleAllowlist.length) {
    if (result.violations.length) console.error("Forbidden domain dependencies:", result.violations);
    if (result.staleAllowlist.length) console.error("Stale temporary allowlist entries:", result.staleAllowlist);
    process.exitCode = 1;
    return;
  }
  console.log(`Module dependency guard passed; temporary allowlist edges: ${result.consumedAllowlist.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
