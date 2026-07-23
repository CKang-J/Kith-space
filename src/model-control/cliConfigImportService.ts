import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appDataConnection } from "../app-data/appDatabase.js";
import type { RuntimeId } from "../local-runtime/runtimeCatalog.js";
import type { CliImportItemResult } from "./contracts.js";
import { RuntimeProfileService } from "./runtimeProfileService.js";

const KNOWN_PATHS: Partial<Record<RuntimeId, string[]>> = {
  claude: [path.join(os.homedir(), ".claude", "settings.json")],
  codex: [path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml")],
  opencode: [path.join(os.homedir(), ".config", "opencode", "opencode.json")],
  pi: [path.join(os.homedir(), ".pi", "agent", "settings.json"), path.join(os.homedir(), ".pi", "agent", "models.json")],
};

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function safeRead(target: string): { payload: string; identity: string } | null {
  let fd: number | undefined;
  try {
    const link = lstatSync(target);
    if (!link.isFile() || link.isSymbolicLink() || link.size > 2 * 1024 * 1024) return null;
    fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 2 * 1024 * 1024
      || (typeof process.getuid === "function" && before.uid !== process.getuid())) return null;
    const payload = readFileSync(fd, "utf8");
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.size !== after.size) return null;
    return { payload, identity: digest(`${target}\0${before.dev}\0${before.ino}\0${before.mtimeMs}\0${before.size}`) };
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

function sanitizeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return value;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function secretShaped(value: string): boolean {
  return /^(?:bearer\s+|basic\s+|sk-|gh[opusr]_|xox[baprs]-)/i.test(value)
    || (value.length >= 32 && /^[A-Za-z0-9+/_=-]+$/.test(value) && !value.includes("/"));
}

export function sanitizeCliConfiguration(runtimeId: RuntimeId, payload: string): Record<string, unknown> {
  if (runtimeId === "codex") {
    const model = /^\s*model\s*=\s*["']([^"']+)["']/m.exec(payload)?.[1] ?? null;
    const provider = /^\s*model_provider\s*=\s*["']([^"']+)["']/m.exec(payload)?.[1] ?? null;
    return { model, provider };
  }
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const safe = (value: unknown): string | null =>
      typeof value === "string" && value.length <= 512 && !secretShaped(value) ? sanitizeUrl(value) : null;
    // Each runtime has an explicit static-default allowlist. Unknown fields are
    // omitted rather than guessed/redacted, so a short secret under an innocent
    // custom key can never enter the durable import snapshot.
    if (runtimeId === "claude") return {
      model: safe(parsed.model),
      effortLevel: safe(parsed.effortLevel),
    };
    if (runtimeId === "opencode") return {
      model: safe(parsed.model),
      smallModel: safe(parsed.small_model),
    };
    if (runtimeId === "pi") return {
      defaultProvider: safe(parsed.defaultProvider),
      defaultModel: safe(parsed.defaultModel),
      defaultThinkingLevel: safe(parsed.defaultThinkingLevel),
    };
    return {};
  } catch { return {}; }
}

export class CliConfigImportService {
  constructor(private readonly runtimes = new RuntimeProfileService()) {}

  preview(runtimeId: RuntimeId) {
    const paths = KNOWN_PATHS[runtimeId];
    if (!paths) throw new Error("unsupported CLI import source");
    const files = paths.flatMap((target) => {
      const read = safeRead(target);
      return read ? [{ path: target, identity: read.identity, sanitized: sanitizeCliConfiguration(runtimeId, read.payload) }] : [];
    });
    const sourcePathsDigest = digest(paths.join("\0"));
    const sourceMtimeDigest = digest(files.map((file) => file.identity).join("\0"));
    const items: CliImportItemResult[] = [{
      sourceId: runtimeId, targetKind: "runtime_profile", targetId: runtimeId,
      status: files.length ? "new_revision" : "skipped",
      warnings: files.length
        ? ["仅导入静态 CLI 默认值；凭据、hook、extension、skill、prompt、theme 和项目资源均未读取。"]
        : ["未找到受支持的用户级静态配置文件。"],
    }];
    return { runtimeId, paths, sourcePathsDigest, sourceMtimeDigest, files, items };
  }

  async apply(runtimeId: RuntimeId, expectedSourceMtimeDigest: string) {
    const preview = this.preview(runtimeId);
    if (preview.sourceMtimeDigest !== expectedSourceMtimeDigest) throw new Error("CLI configuration changed after preview");
    const previous = appDataConnection().prepare(`
      SELECT source_mtime_digest FROM cli_config_import_snapshots
      WHERE runtime_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(runtimeId) as { source_mtime_digest: string } | undefined;
    if (previous?.source_mtime_digest === preview.sourceMtimeDigest) {
      return {
        ...preview,
        items: preview.items.map((item) => ({ ...item, status: "unchanged" as const })),
        applied: false,
        unchanged: true,
      };
    }
    if (preview.files.length) {
      await this.runtimes.update(runtimeId, {
        enabled: true,
        defaultBinding: { mode: "unmanaged_cli_native", modelConfigurationId: null, modelConfigurationRevision: null },
        runtimeOptions: { importedSourceDigest: preview.sourceMtimeDigest },
      });
    }
    appDataConnection().prepare(`
      INSERT INTO cli_config_import_snapshots (
        id, runtime_id, source_paths_digest, source_mtime_digest, sanitized_payload_json, warnings_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), runtimeId, preview.sourcePathsDigest, preview.sourceMtimeDigest,
      JSON.stringify(preview.files.map(({ path: target, identity, sanitized }) => ({
        pathLabel: path.basename(target), identity, sanitized,
      }))), JSON.stringify(preview.items.flatMap((item) => item.warnings)), Date.now());
    return { ...preview, applied: preview.files.length > 0 };
  }
}
