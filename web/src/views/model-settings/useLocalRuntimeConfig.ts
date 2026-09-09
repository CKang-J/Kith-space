/**
 * 读取本机运行器配置的公共状态钩子。
 *
 * 四个运行器面板（Claude / Pi / Codex / OpenCode）都要「打开就显示用户自己电脑上的配置」，
 * 差别只在能不能写回，所以读取这一段抽在这里，避免每个面板各写一份 loading/error/refresh。
 *
 * 必须用 store 的 api()：写接口走 CSRF 校验，裸 fetch 在浏览器模式下会被 403 拦掉。
 */

import { useCallback, useEffect, useState } from "react";
import { useStore } from "../../store.tsx";
import {
  loadLocalRuntimeConfig,
  type LocalRuntimeConfig,
} from "../../data/localRuntimeConfig.ts";

export interface UseLocalRuntimeConfigResult {
  config: LocalRuntimeConfig | null;
  loading: boolean;
  /** 读取失败（网络或服务端异常）。 */
  error: string;
  /** 该运行器没有本机配置适配器，与「读到了但是空的」区分开。 */
  unsupported: string;
  refresh: () => Promise<void>;
}

export function useLocalRuntimeConfig(runtimeId: string): UseLocalRuntimeConfigResult {
  const { api } = useStore();
  const [config, setConfig] = useState<LocalRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setUnsupported("");
    try {
      const result = await loadLocalRuntimeConfig(api, runtimeId);
      if (!result.supported) {
        setConfig(null);
        setUnsupported(result.reason);
        return;
      }
      setConfig(result.config);
    } catch (cause) {
      setConfig(null);
      setError(cause instanceof Error ? cause.message : "读取本机配置失败");
    } finally {
      setLoading(false);
    }
  }, [api, runtimeId]);

  useEffect(() => { void load(); }, [load]);

  return { config, loading, error, unsupported, refresh: load };
}
