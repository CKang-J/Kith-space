import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const upstreamRoot = path.join(repoRoot, "reference/recombyn");
const nativeRoot = path.join(repoRoot, "web/src/features/canvas/upstream");
const tailwindCli = path.join(upstreamRoot, "node_modules/tailwindcss/lib/cli.js");
const outputPath = path.join(nativeRoot, "recombyn-native.css");
const temporaryPath = `${outputPath}.tmp`;
const requireFromUpstream = createRequire(path.join(upstreamRoot, "package.json"));
const postcss = requireFromUpstream("postcss");

if (!existsSync(tailwindCli)) {
  throw new Error(`Missing Recombyn Tailwind 3 CLI: ${tailwindCli}`);
}

rmSync(temporaryPath, { force: true });
execFileSync(process.execPath, [
  tailwindCli,
  "-c", path.join(upstreamRoot, "apps/web/tailwind.config.ts"),
  "-i", path.join(upstreamRoot, "apps/web/src/styles/index.css"),
  "-o", temporaryPath,
  "--content", path.join(nativeRoot, "apps/web/src/**/*.{js,jsx,ts,tsx}"),
  "--minify",
], { cwd: repoRoot, stdio: "inherit" });

const generated = [
  readFileSync(temporaryPath, "utf8"),
  readFileSync(path.join(upstreamRoot, "apps/web/src/theme/light.css"), "utf8"),
  readFileSync(path.join(upstreamRoot, "apps/web/src/theme/dark.css"), "utf8"),
].join("\n");
const withoutGoogleImport = generated.replace(
  /@import\s+url\(["']?https:\/\/fonts\.googleapis\.com\/[\s\S]*?\);?\s*/g,
  "",
);
const withoutRemoteFaces = withoutGoogleImport.replace(
  /@font-face\{[^{}]*url\(["']?https:\/\/[^{}]+\}/g,
  "",
);
if (
  withoutRemoteFaces === generated
  || !withoutRemoteFaces.startsWith("*,:after,:before{")
  || /https?:\/\//.test(withoutRemoteFaces.replace(/\/\*![\s\S]*?\*\//g, ""))
) {
  rmSync(temporaryPath, { force: true });
  throw new Error("Expected online font declarations were not removed from the Recombyn CSS output");
}

const parsed = postcss.parse(withoutRemoteFaces);
parsed.walkRules((rule) => {
  if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
  rule.selector = rule.selector
    .replaceAll(":root", ":scope")
    .replace(/\bhtml(?=\b|\[|\.|#|:)/g, ":scope")
    .replace(/\bbody(?=\b|\[|\.|#|:)/g, ":scope")
    .replaceAll("#root", ":scope")
    .replaceAll(":host", ":scope");
});
const scope = postcss.atRule({
  name: "scope",
  params: "([data-kith-canvas-root][data-recombyn-native-editor])",
});
scope.append(parsed.nodes);
const scopedCss = scope.toString();

writeFileSync(
  temporaryPath,
  `/* Kith-space Stage 1: native Tailwind 3/Preflight/theme rules are island-scoped; font stacks are preserved without unverified online font fetches. */\n${scopedCss}`,
);
renameSync(temporaryPath, outputPath);
process.stdout.write(`Built isolated Recombyn Tailwind 3 CSS at ${path.relative(repoRoot, outputPath)}\n`);
