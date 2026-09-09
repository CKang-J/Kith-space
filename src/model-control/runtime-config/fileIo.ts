/**
 * 运行器配置文件的读写基础设施。
 *
 * 读：区分「文件不存在」「无权限」「解析失败」，让上层能给出可操作的提示。
 * 写：原子写入 + 时间戳备份，避免半个文件或误删用户配置。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { LocalConfigIssue } from "./types.js";

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;

export type ReadResult =
  | { ok: true; text: string }
  | { ok: false; issue: LocalConfigIssue };

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** 读取文本文件，把 errno 归一化成 LocalConfigIssue。 */
export async function readTextFile(target: string): Promise<ReadResult> {
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      return {
        ok: false,
        issue: { kind: "not_found", path: target, message: `${path.basename(target)} 不是普通文件。` },
      };
    }
    if (stat.size > MAX_CONFIG_BYTES) {
      return {
        ok: false,
        issue: {
          kind: "unsupported_shape",
          path: target,
          message: `${path.basename(target)} 超过 4 MB，已跳过读取。`,
        },
      };
    }
    return { ok: true, text: await fs.readFile(target, "utf-8") };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return {
        ok: false,
        issue: { kind: "not_found", path: target, message: `未找到 ${target}。` },
      };
    }
    if (code === "EACCES" || code === "EPERM") {
      return {
        ok: false,
        issue: { kind: "permission_denied", path: target, message: `没有读取 ${target} 的权限。` },
      };
    }
    return {
      ok: false,
      issue: {
        kind: "parse_error",
        path: target,
        message: `读取 ${path.basename(target)} 失败：${(error as Error).message}`,
      },
    };
  }
}

export type JsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; issue: LocalConfigIssue };

/** 读取并解析 JSON 文件。 */
export async function readJsonFile(target: string): Promise<JsonReadResult> {
  const read = await readTextFile(target);
  if (!read.ok) return read;
  try {
    return { ok: true, value: JSON.parse(read.text) };
  } catch (error) {
    return {
      ok: false,
      issue: {
        kind: "parse_error",
        path: target,
        message: `${path.basename(target)} 不是合法 JSON：${(error as Error).message}`,
      },
    };
  }
}

/** 把值当作字符串字典读取，非字典时返回空对象。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 只在值确实是非空字符串时返回它。 */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** 把字符串或数字形式的整数读成 number。 */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** 备份原文件到同目录下的 .bak-<时间戳>，文件不存在时跳过。 */
export async function backupFile(target: string): Promise<string | undefined> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${target}.bak-${stamp}`;
    await fs.copyFile(target, backup);
    return backup;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 原子写入：先写同目录临时文件再 rename，保证读者永远看到完整内容。
 * 写入前自动备份原文件。
 *
 * 权限：rename 出来的是新 inode，会走 umask（通常 644）。凭据文件
 * （auth.json 等）原本是 600，若不显式恢复就等于把密钥放宽给同机其他用户。
 * 因此这里沿用原文件权限；原文件不存在时用 fallbackMode。
 */
export async function writeFileAtomic(
  target: string,
  contents: string,
  fallbackMode = 0o600,
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await backupFile(target);

  let mode = fallbackMode;
  try {
    mode = (await fs.stat(target)).mode & 0o777;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }

  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temp, contents, { encoding: "utf-8", mode });
    // writeFile 的 mode 受 umask 削减，chmod 不受，用它兜底成精确权限。
    await fs.chmod(temp, mode);
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
