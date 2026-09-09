/**
 * 测试专用工具：隔离临时目录 + 环境变量覆盖/还原 + fixture 写入。
 *
 * 不是 *.test.ts，不会被 scripts/run-tests.mjs 当作测试文件收集，只在各 *.test.ts 里被 import。
 */

import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RUNTIME_PATH_ENV_KEYS = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "PI_AGENT_DIR",
  "OPENCODE_CONFIG",
  "XDG_CONFIG_HOME",
] as const;

type RuntimePathEnvKey = (typeof RUNTIME_PATH_ENV_KEYS)[number];

/** 创建一个隔离的临时目录；测试结束后必须调用返回的 cleanup()。 */
export function makeTempDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * 覆盖 paths.ts 用到的路径类环境变量，返回 restore()。
 * 未在 overrides 里出现的 key 会被清空（而不是保留测试间残留值），跑完测试务必调用 restore()。
 */
export function withRuntimeEnv(overrides: Partial<Record<RuntimePathEnvKey, string>>): () => void {
  const previous = new Map<RuntimePathEnvKey, string | undefined>();
  for (const key of RUNTIME_PATH_ENV_KEYS) previous.set(key, process.env[key]);

  for (const key of RUNTIME_PATH_ENV_KEYS) {
    const value = overrides[key];
    if (value !== undefined) process.env[key] = value;
    else delete process.env[key];
  }

  return () => {
    for (const key of RUNTIME_PATH_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/** 覆盖任意进程环境变量（例如凭据探测回落用到的 ANTHROPIC_API_KEY），返回 restore()。 */
export function withProcessEnv(overrides: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) previous.set(key, process.env[key]);

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export async function writeFixture(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf-8");
}

export async function writeJsonFixture(filePath: string, data: unknown): Promise<void> {
  await writeFixture(filePath, JSON.stringify(data, null, 2));
}

export async function readJsonFixture(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}
