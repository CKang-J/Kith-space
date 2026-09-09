/**
 * 本机运行器配置的读取与「采用」接口。
 *
 * 与 modelSettings.ts 的区别：这里的数据源是用户电脑上真实存在的配置文件
 * （~/.claude/settings.json、~/.pi/agent/*.json、~/.codex/config.toml、
 * ~/.config/opencode/opencode.json），只读、按需采用；modelSettings.ts 管的是
 * Kith 自己数据库里的供应商与模型配置。
 *
 * 安全：读取结果里绝不包含任何密钥明文，只有 credential.configured / source；
 * 采用时凭据在服务端直接落库到 providerCredentialPort，不经过浏览器。
 */

import { z, ZodError } from "zod";
import { isDesktopTrustedRequest } from "../../local-runtime/internalCredentials.js";
import { browserRequestIsLocal } from "../browserSessionHttp.js";
import { ModelControlError } from "../../model-control/contracts.js";
import {
  clearClaudeTiers,
  deletePiProvider,
  patchClaudeConfig,
  readAllLocalRuntimeConfigs,
  readLocalRuntimeConfig,
  setPiDefaultModel,
  writePiProvider,
} from "../../model-control/runtime-config/index.js";
import { localConfigAdoptService } from "../../model-control/runtime-config/localConfigAdoptService.js";
import { RUNTIME_IDS, type RuntimeId } from "../../model-control/runtimeTypes.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { HumanCtx } from "./ctx.js";

const RuntimeIdSchema = z.enum(RUNTIME_IDS);

const AdoptSchema = z.object({
  runtimeId: RuntimeIdSchema,
  providerId: z.string().min(1).max(200),
  modelId: z.string().min(1).max(256),
});

/**
 * Claude Code 的配置形状是 settings.json 的 env 块，不是「供应商列表」，
 * 所以它的写入接口按 env 的语义建模：字段缺省表示不动，null 表示删除。
 */
const ClaudePatchSchema = z.object({
  baseUrl: z.string().max(2048).nullish(),
  authToken: z.string().max(8192).nullish(),
  tiers: z.record(
    z.enum(["haiku", "sonnet", "opus", "fable"]),
    z.object({
      modelId: z.string().max(256).optional(),
      displayName: z.string().max(200).optional(),
    }),
  ).optional(),
  maxContextTokens: z.number().int().positive().max(100_000_000).nullish(),
  maxOutputTokens: z.number().int().positive().max(100_000_000).nullish(),
  selectedModel: z.string().max(256).nullish(),
}).strict();

/** Pi Agent 是真正的「供应商 + 模型清单」结构，与 cc-switch 的编辑表单一致。 */
const PiProviderSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  baseUrl: z.string().max(2048).optional(),
  api: z.string().max(64).optional(),
  apiKey: z.string().max(8192).optional(),
  models: z.array(z.object({
    id: z.string().min(1).max(256),
    name: z.string().max(200).optional(),
    contextWindow: z.number().int().positive().max(100_000_000).optional(),
    maxTokens: z.number().int().positive().max(100_000_000).optional(),
    reasoning: z.boolean().optional(),
  })).max(512).optional(),
}).strict();

const PiDefaultSchema = z.object({
  providerId: z.string().min(1).max(200),
  modelId: z.string().min(1).max(256),
}).strict();

/**
 * 向导里的运行器 id 有 9 个（含 copilot/kimi/cursor/hermes/pi-builtin），
 * 但只有 4 个有本机配置适配器。这里显式映射，读不到的运行器返回明确的
 * supported: false，而不是让前端看到一个空列表以为「没有配置」。
 *
 * pi-builtin 不映射到 pi：内置 Pi 运行在 Kith 自己的私有根目录下，
 * 和用户的 ~/.pi/agent 是两份互不相干的配置。
 */
const ADAPTER_BY_WIZARD_RUNTIME: Readonly<Record<string, RuntimeId>> = Object.freeze({
  claude: "claude",
  codex: "codex",
  pi: "pi",
  opencode: "opencode",
});

function resolveAdapterRuntime(value: string): RuntimeId | undefined {
  return ADAPTER_BY_WIZARD_RUNTIME[value];
}

/**
 * 这些接口会读用户主目录下的配置文件、并把其中的凭据落库，
 * 与 model-providers 写密钥同级，因此沿用同一道信任门：
 * 桌面端内部请求，或来自本机回环、同源的浏览器请求。
 */
function assertLocalConfigAccessAllowed(req: HumanCtx["req"]): void {
  if (!isDesktopTrustedRequest(req) && !browserRequestIsLocal(req)) {
    throw new ModelControlError("desktop_trust_required");
  }
}

function handleError(ctx: HumanCtx, error: unknown): boolean {
  if (error instanceof ZodError) {
    sendErr(ctx.res, 400, "invalid_request");
    return true;
  }
  if (error instanceof ModelControlError) {
    const status = error.code === "model_provider_not_found" || error.code === "model_configuration_not_found"
      ? 404
      : error.code === "desktop_trust_required" || error.code === "credential_reentry_required"
        ? 403
        : 409;
    sendErr(ctx.res, status, error.message, error.details);
    return true;
  }
  console.error("local runtime config request failed:", error);
  sendErr(ctx.res, 500, "internal_error");
  return true;
}

export async function handleLocalRuntimeConfig(ctx: HumanCtx): Promise<boolean> {
  try {
    // 读取单个运行器的本机配置。runtimeId 用向导的 id，未适配的运行器显式告知。
    if (ctx.p === "/api/local-runtime-config" && ctx.method === "GET") {
      const url = new URL(ctx.req.url || "", `http://${ctx.req.headers.host}`);
      const requested = url.searchParams.get("runtimeId");
      if (!requested) {
        sendErr(ctx.res, 400, "runtimeId is required");
        return true;
      }
      assertLocalConfigAccessAllowed(ctx.req);
      const runtimeId = resolveAdapterRuntime(requested);
      if (!runtimeId) {
        sendJson(ctx.res, 200, {
          supported: false,
          runtimeId: requested,
          reason: `${requested} 暂不支持读取本机配置，请手动填写供应商信息`,
        });
        return true;
      }
      const config = await readLocalRuntimeConfig(runtimeId);
      sendJson(ctx.res, 200, { supported: true, config });
      return true;
    }

    if (ctx.p === "/api/local-runtime-config/all" && ctx.method === "GET") {
      assertLocalConfigAccessAllowed(ctx.req);
      const configs = await readAllLocalRuntimeConfigs();
      sendJson(ctx.res, 200, { configs });
      return true;
    }

    // 把本机配置里的某个模型变成真实的 Kith 模型配置，返回可用于 Agent 绑定的 id。
    if (ctx.p === "/api/local-runtime-config/adopt" && ctx.method === "POST") {
      assertLocalConfigAccessAllowed(ctx.req);
      const body = AdoptSchema.parse(await readJson(ctx.req));
      const result = await localConfigAdoptService.adopt(body);
      sendJson(ctx.res, 200, result);
      return true;
    }

    // ---- 写回本机配置：只合并 Kith 负责的字段，用户其余配置原样保留 ----
    if (ctx.p === "/api/local-runtime-config/claude" && ctx.method === "PUT") {
      assertLocalConfigAccessAllowed(ctx.req);
      const body = ClaudePatchSchema.parse(await readJson(ctx.req));
      const result = await patchClaudeConfig(body);
      sendJson(ctx.res, 200, { success: true, ...result });
      return true;
    }
    if (ctx.p === "/api/local-runtime-config/claude/tiers" && ctx.method === "DELETE") {
      assertLocalConfigAccessAllowed(ctx.req);
      const result = await clearClaudeTiers();
      sendJson(ctx.res, 200, { success: true, ...result });
      return true;
    }

    if (ctx.p === "/api/local-runtime-config/pi/providers" && ctx.method === "PUT") {
      assertLocalConfigAccessAllowed(ctx.req);
      const body = PiProviderSchema.parse(await readJson(ctx.req));
      const paths = await writePiProvider(body);
      sendJson(ctx.res, 200, { success: true, paths });
      return true;
    }
    const piProviderMatch = /^\/api\/local-runtime-config\/pi\/providers\/([^/]+)$/.exec(ctx.p);
    if (piProviderMatch && ctx.method === "DELETE") {
      assertLocalConfigAccessAllowed(ctx.req);
      const paths = await deletePiProvider(decodeURIComponent(piProviderMatch[1]!));
      sendJson(ctx.res, 200, { success: true, paths });
      return true;
    }
    if (ctx.p === "/api/local-runtime-config/pi/default-model" && ctx.method === "PUT") {
      assertLocalConfigAccessAllowed(ctx.req);
      const body = PiDefaultSchema.parse(await readJson(ctx.req));
      const path = await setPiDefaultModel(body.providerId, body.modelId);
      sendJson(ctx.res, 200, { success: true, path });
      return true;
    }

    return false;
  } catch (error) {
    return handleError(ctx, error);
  }
}
