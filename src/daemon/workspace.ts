// Reads a Core-resolved Space root and exposes its user file tree / file content via WS-RPC to the server.
// File tree: returns {root, files:[{name,path,isDirectory,size,modifiedAt}]} — root is the absolute on-disk workspace dir (so the UI shows the real path instead of a hardcoded template that's wrong under a non-default KITH_SPACE_HOME);
//            read file: returns {path, content}. Security: path must remain inside the workspace root (prevents ../ escape).
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const MAX_FILE = 256 * 1024;
const SKIP = new Set(["node_modules", ".git", ".kith"]);

function safe(workspaceRoot: string, rel: string): string | null {
  if (!workspaceRoot.trim()) return null;
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, rel || ".");
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

interface FileNode { name: string; path: string; isDirectory: boolean; size: number; modifiedAt: string | null }

async function walk(root: string, rel: string, acc: FileNode[], depth: number): Promise<void> {
  if (depth > 6 || acc.length > 2000) return;
  let ds; try { ds = await readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const d of ds) {
    if (SKIP.has(d.name)) continue;
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    let size = 0; let modifiedAt: string | null = null;
    try { const s = await stat(path.join(root, childRel)); size = d.isFile() ? s.size : 0; modifiedAt = s.mtime.toISOString(); } catch { /* */ }
    acc.push({ name: d.name, path: childRel, isDirectory: d.isDirectory(), size, modifiedAt });
    if (d.isDirectory()) await walk(root, childRel, acc, depth + 1);
  }
}

/** Full flat file tree (aligned with the workspace-files protocol). */
export async function listWorkspace(workspaceRoot: string, _subPath = "") {
  // _subPath: passed by callers for protocol alignment with readWorkspaceFile; current implementation always returns the full tree.
  if (!workspaceRoot.trim()) return { error: "invalid workspace root", root: "" };
  const root = path.resolve(workspaceRoot);
  try { const files: FileNode[] = []; await walk(root, "", files, 0); return { files, root }; }
  catch (e: any) { return { error: String(e?.message ?? e), root }; }
}

// Extract a frontmatter field: supports inline (description: foo) and YAML block scalars (description: > / | followed by indented lines).
function fmField(fm: string, key: string): string {
  const lines = fm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(`^${key}:\\s*(.*)$`, "i").exec(lines[i]!);
    if (!m) continue;
    const inline = m[1]!.trim();
    if (inline && !/^[|>][+-]?$/.test(inline)) return inline.replace(/^["']|["']$/g, ""); // inline value
    const block: string[] = []; // block scalar: collect subsequent indented lines
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s+\S/.test(lines[j]!)) block.push(lines[j]!.trim());
      else if (lines[j]!.trim() === "") block.push("");
      else break;
    }
    return block.join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}
// List available skills on the agent machine. global = ~/.claude/skills; workspace = <workspace>/.claude/skills.
async function readSkillsDir(dir: string, sourcePath: string) {
  const out: { name: string; displayName: string; description: string; userInvocable: boolean; sourcePath: string }[] = [];
  let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    let name = e.name, description = "", userInvocable = false;
    try {
      const txt = await readFile(path.join(dir, e.name, "SKILL.md"), "utf8");
      const fm = /^---\n([\s\S]*?)\n---/.exec(txt);
      if (fm) {
        name = fmField(fm[1]!, "name") || e.name;
        description = fmField(fm[1]!, "description");
        userInvocable = /^(true|yes)$/i.test(fmField(fm[1]!, "user-invocable") || fmField(fm[1]!, "userInvocable"));
      }
    } catch { continue; } // no SKILL.md → not counted as a skill
    out.push({ name, displayName: name, description, userInvocable, sourcePath });
  }
  return out;
}
// Per-runtime skills directories, ported from multica's localSkillRootsForProvider
// (multica/server/internal/daemon/local_skills.go). Each CLI keeps its skills under its own
// provider dir, so a codex/opencode/cursor agent must read *its* dir — not Claude's ~/.claude/skills,
// which is what this used to hardcode regardless of runtime. Agents launch with the operator's real
// $HOME (claudeRuntime/codexRuntime don't override HOME/CODEX_HOME), so the home provider dir is the
// one the agent actually loads. Runtimes without an established skills dir (kimi) get the universal
// ~/.agents/skills convention only.
type SkillRoot = { dir: string; label: string };
const HOME = os.homedir();
const UNIVERSAL_SKILLS: SkillRoot = { dir: path.join(HOME, ".agents", "skills"), label: "~/.agents/skills" };
// Home (global) provider skills dir per runtime.
const PROVIDER_HOME_SKILLS: Record<string, SkillRoot> = {
  claude: { dir: path.join(HOME, ".claude", "skills"), label: "~/.claude/skills" },
  codex: { dir: path.join(process.env.CODEX_HOME || path.join(HOME, ".codex"), "skills"), label: "~/.codex/skills" },
  copilot: { dir: path.join(HOME, ".copilot", "skills"), label: "~/.copilot/skills" },
  opencode: { dir: path.join(HOME, ".config", "opencode", "skills"), label: "~/.config/opencode/skills" },
  cursor: { dir: path.join(HOME, ".cursor", "skills"), label: "~/.cursor/skills" },
  pi: { dir: path.join(HOME, ".pi", "agent", "skills"), label: "~/.pi/agent/skills" },
};
// Project-local (workspace) provider dir name per runtime, relative to the agent workspace/cwd.
const PROVIDER_WS_DIR: Record<string, string> = { claude: ".claude", codex: ".codex", copilot: ".copilot", opencode: ".opencode", cursor: ".cursor", pi: ".pi" };

/** Resolve which skills dirs to scan for an agent, by its runtime. Pure (no I/O) — unit-tested. */
export function skillRootsFor(runtime: string, workspaceRoot: string): { global: SkillRoot[]; workspace: SkillRoot | null } {
  const home = PROVIDER_HOME_SKILLS[runtime];
  const global = home ? [home, UNIVERSAL_SKILLS] : [UNIVERSAL_SKILLS];
  const wsName = PROVIDER_WS_DIR[runtime];
  const workspace = wsName && workspaceRoot.trim()
    ? { dir: path.join(path.resolve(workspaceRoot), wsName, "skills"), label: `<workspace>/${wsName}/skills` }
    : null;
  return { global, workspace };
}

export async function listSkills(workspaceRoot: string, runtime = "claude") {
  const roots = skillRootsFor(runtime, workspaceRoot);
  const global = (await Promise.all(roots.global.map((r) => readSkillsDir(r.dir, r.label)))).flat();
  const workspace = roots.workspace ? await readSkillsDir(roots.workspace.dir, roots.workspace.label) : [];
  return { global, workspace };
}

export async function readWorkspaceFile(workspaceRoot: string, rel: string) {
  const file = safe(workspaceRoot, rel);
  if (!file) return { error: "invalid path" };
  try {
    const s = await stat(file);
    if (!s.isFile()) return { error: "not a file" };
    if (s.size > MAX_FILE) return { error: `file too large (${s.size} bytes, max ${MAX_FILE})` };
    const buf = await readFile(file);
    if (buf.includes(0)) return { error: "binary file" };
    return { path: rel, content: buf.toString("utf8") };
  } catch (e: any) { return { error: String(e?.message ?? e) }; }
}
