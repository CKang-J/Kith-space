# Canvas Agent Phase 3：图像/视频生成接入设计

**日期**: 2026-08-20  
**状态**: Phase 3.1–3.3 与 Human 工具栏生成通道已实现代码；真实 Ark API Key / Desktop smoke 未跑  
**前置**: Phase 0（工具底座）、Phase 1（操作协议）、Phase 2（设计技能）已完成  
**目标**: 让 Agent 可以通过自然语言生成氛围图、艺术字、产品图等视觉素材并正确放置到画布

---

## 一、问题现状

当前 Kith Canvas Agent 只能使用：
1. ✅ 基础形状（矩形、圆形、星形等）
2. ✅ `boolean_op` 构建复杂图标（moon/magnifier/ring）
3. ✅ `create_text` + 46 族字体
4. ✅ 现有 Canvas `assetId`（用户上传的图片）

但不能：
- ❌ 生成氛围图（赛博朋克城市、星空背景、产品场景图）
- ❌ 生成艺术字/书法标题（超出字体库的定制文字）
- ❌ 生成产品图、人物肖像、装饰元素
- ❌ 生成动态视频素材

这是 Kith 和 Recombyn 最大的功能差距（P1.1 改进计划标记为 ⭐⭐⭐⭐⭐）。

---

## 二、核心能力规格

### 2.1 图像生成 (`create_image` 扩展)

#### 新增参数

```typescript
export const CanvasCreateImageCommandSchema = z.object({
  ...WriteLocator,
  
  // 现有路径（保持向后兼容）
  assetId: Id.optional(),
  
  // 新增：AI 图像生成路径
  genPrompt: z.string().min(10).max(2000).optional(),
  letteringText: z.string().max(200).optional(),
  removeBg: z.boolean().optional(),
  cutoutMode: z.enum(["product", "hair"]).optional(),
  
  // 生成配置（可选）
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  stylePreset: z.string().max(100).optional(), // "photographic" | "digital-art" | "anime" 等
  
  // 放置参数（与现有一致）
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  parentId: Id.optional(),
  frameId: Id.optional(),
  name: NameString.optional(),
  id: CustomId.optional(),
}).strict().refine(
  (data) => data.assetId || data.genPrompt,
  { message: "Either assetId or genPrompt is required" }
);
```

#### 工具描述更新

```typescript
"canvas.create_image": "Create an image node. " +
  "Args: assetId (existing Canvas asset) OR genPrompt (AI image generation, queued job). " +
  "When using genPrompt: " +
  "- Atmosphere/backgrounds: describe SCENE ONLY, no baked titles/dates/logos; put copy in create_text layers. " +
  "- Hero lettering: use genPrompt + letteringText for calligraphy/decorative titles beyond Available fonts. " +
  "- Products/portraits: describe subject, lighting, materials; use removeBg=true for cutouts. " +
  "Optional: letteringText (visible text in the image, helps later replaceText), " +
  "removeBg=true (auto-cutout), cutoutMode=product|hair (cutout algorithm), " +
  "aspectRatio (1:1|16:9|9:16|4:3|3:4), stylePreset (photographic|digital-art|anime|...). " +
  "Generation is async: tool returns jobId, image appears when ready (10-60s). " +
  "图片/assetId 或 genPrompt 生成/可选抠图和风格",
```

---

### 2.2 视频生成 (`canvas.video_generate`)

#### Schema

```typescript
export const CanvasVideoGenerateCommandSchema = z.object({
  ...WriteLocator,
  
  genPrompt: z.string().min(10).max(2000),
  referenceImageAssetId: Id.optional(), // 可选：基于现有图片生成视频
  duration: z.number().int().min(2).max(10).optional(), // 默认 4 秒
  
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  frameId: Id.optional(),
  name: NameString.optional(),
  id: CustomId.optional(),
}).strict();
```

#### 工具描述

```typescript
"canvas.video_generate": "Generate a short video (2-10s) and place as video node. " +
  "Args: genPrompt (scene description), optional referenceImageAssetId (image-to-video), " +
  "duration (seconds, default 4), x/y/width/height/frameId (placement). " +
  "Prompts should describe motion/camera: 'camera slowly pans right across neon cityscape' / " +
  "'product rotates 360 degrees on white surface'. " +
  "Generation is async: returns jobId, video appears when ready (60-300s). " +
  "视频生成/基于图片或纯提示词/异步任务",
```

---

## 三、技术架构设计

### 3.1 生成服务供应商选型

#### 图像生成
- **主供应商**: 火山引擎 Doubao（豆包图像生成 API）
- **备选**: Stability AI（Stable Diffusion 3.5）/ DALL·E 3（可通过供应商配置切换）

#### 视频生成
- **主供应商**: 火山引擎 Seedream（视频生成 API）
- **备选**: Runway Gen-3 Alpha / Pika（可通过供应商配置切换）

#### Lottie 动画生成（P2，延后）
- **主供应商**: Lottie Creator API（基于自然语言生成 Bodymovin JSON）
- 用于 UI 动效（loading、success、空状态循环），不用于静态图标或视频

**说明**：采用火山引擎作为主供应商（国内服务、低延迟、中文支持好），Recombyn 架构模式仍保持：`genPrompt` + 后端异步队列。Agent 调用 `create_image({ genPrompt })` 后立即返回 jobId，生成完成后通过 Canvas realtime event 通知前端。

### 3.2 数据库 Schema 扩展

#### workspace.db 新增表

```sql
-- workspace schema v15

CREATE TABLE canvas_generation_jobs (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvas_documents(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK(job_type IN ('image', 'video')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  
  -- 输入参数
  gen_prompt TEXT NOT NULL,
  config_json TEXT, -- JSON: {letteringText, removeBg, cutoutMode, aspectRatio, stylePreset, duration, ...}
  reference_asset_id TEXT,
  
  -- 放置参数
  placement_json TEXT NOT NULL, -- JSON: {x, y, width, height, frameId, parentId, name, customId}
  
  -- 任务跟踪
  provider TEXT NOT NULL, -- "doubao" | "stability" | "seedream"
  provider_job_id TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  
  -- 结果
  result_asset_id TEXT REFERENCES canvas_assets(id) ON DELETE SET NULL,
  result_node_id TEXT, -- 创建的 image/video 节点 ID
  
  -- 关联
  turn_id TEXT, -- 可选：关联到哪个 Agent Turn
  idempotency_key TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  
  -- 时间戳
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_canvas_generation_jobs_canvas ON canvas_generation_jobs(canvas_id);
CREATE INDEX idx_canvas_generation_jobs_status ON canvas_generation_jobs(status);
CREATE UNIQUE INDEX idx_canvas_generation_jobs_idempotency ON canvas_generation_jobs(canvas_id, idempotency_key);
```

---

### 3.3 生成服务架构

#### 模块边界

```
src/canvas/generation/
  generationJobQueue.ts         # Job 队列管理（pending → processing → completed/failed）
  generationProviders.ts        # 供应商抽象接口
  providers/
    doubaoImageProvider.ts      # 火山引擎图像生成
    seedreamVideoProvider.ts    # 火山引擎视频生成
    stabilityProvider.ts        # Stability AI 备选
    runwayProvider.ts           # Runway 备选
  generationWorker.ts           # 后台 Worker（轮询 pending jobs）
  generationAssetImport.ts      # 生成完成后导入 Canvas Asset
```

#### 供应商抽象接口

```typescript
export interface GenerationProvider {
  readonly name: string; // "doubao" | "seedream" | "stability"
  readonly type: "image" | "video";
  
  // 提交生成任务
  submit(params: GenerationRequest): Promise<ProviderJobId>;
  
  // 查询任务状态
  getStatus(jobId: ProviderJobId): Promise<GenerationStatus>;
  
  // 下载结果（返回 Buffer）
  downloadResult(jobId: ProviderJobId): Promise<Buffer>;
  
  // 取消任务
  cancel?(jobId: ProviderJobId): Promise<void>;
}

export interface GenerationRequest {
  prompt: string;
  config?: {
    aspectRatio?: string;
    stylePreset?: string;
    duration?: number;
    letteringText?: string;
    removeBg?: boolean;
    cutoutMode?: "product" | "hair";
  };
  referenceImage?: Buffer; // 可选：图生视频
}

export type GenerationStatus =
  | { status: "pending" | "processing" }
  | { status: "completed"; resultUrl: string }
  | { status: "failed"; error: string };
```

---

### 3.4 异步生成流程

```
1. Agent 调用 canvas.create_image({ genPrompt: "..." })
   ↓
2. CanvasGatewayTools.canvasCreateImage()
   - 验证 Grant 权限
   - 创建 canvas_generation_jobs (status=pending)
   - 返回 { jobId, status: "pending", estimatedTime: 30 }
   ↓
3. GenerationWorker 后台轮询（每 5 秒）
   - 取出 status=pending 的 job
   - 调用 provider.submit()
   - 更新 status=processing, provider_job_id
   ↓
4. GenerationWorker 持续轮询 processing jobs（每 10 秒）
   - 调用 provider.getStatus()
   - 若 completed:
     a. provider.downloadResult() → Buffer
     b. 写入 <space>/.kith/canvas-assets/<hash>.{png|mp4}
     c. 插入 canvas_assets 表
     d. 调用 CanvasCore.applyOperations([{ op: "create_image", assetId }])
     e. 更新 job: status=completed, result_asset_id, result_node_id
     f. 发布 Canvas realtime event
   - 若 failed:
     - 更新 job: status=failed, error_message
     - 可选：retry_count < 3 → 重新入队
   ↓
5. 前端收到 Canvas event → 刷新画布 → 图片/视频出现
```

---

### 3.5 前端实时反馈

#### Agent Reply 中显示生成进度

```typescript
// Turn output artifacts 扩展
export interface CanvasGenerationArtifact {
  kind: "canvas_generation_job";
  jobId: string;
  jobType: "image" | "video";
  status: "pending" | "processing" | "completed" | "failed";
  prompt: string;
  estimatedTime?: number; // 秒
  resultNodeId?: string; // 完成后的节点 ID
  error?: string;
}
```

Agent 回复时在轨迹中显示：
```
🎨 正在生成图片："赛博朋克城市夜景，霓虹灯反射在湿润街道" (预计 30 秒)
```

完成后更新为：
```
✅ 图片已生成并放置到画布
```

---

## 四、实施切片

### Phase 3.1：图像生成基础设施（2-3 天）

#### 任务清单
- [x] 创建 `src/canvas/generation/` 模块目录
- [x] 定义 `GenerationProvider` 接口
- [x] 实现 `generationJobQueue.ts`（数据库 CRUD）
- [x] workspace schema v15 migration（`drizzle/0016_canvas_generation_jobs.sql`）
- [x] 实现 `generationWorker.ts` 骨架（轮询逻辑）
- [x] 单元测试：Job 状态流转、幂等性、并发安全

#### 验收标准
- ✅ `canvas_generation_jobs` 表创建成功
- ✅ Job 可以入队、轮询、状态更新
- ✅ 相关单测通过
- ✅ `pnpm run typecheck` 通过

---

### Phase 3.2：火山引擎图像生成接入（2-3 天）

#### 任务清单
- [x] 实现 `providers/doubaoImageProvider.ts`
- [x] 供应商配置系统（app.db 存储加密 API Key）
- [x] Settings 页面增加"图像生成"分区（Desktop 可配置，LAN Web 只读）
- [x] `create_image(genPrompt)` 完整实现
- [x] 生成完成后自动导入 Canvas Asset
- [x] 前端 Canvas 实时刷新
- [ ] Agent 轨迹显示生成进度
- [ ] 注册火山引擎账号并获取 Doubao API Key

#### 验收标准
- ✅ Agent 调用 `create_image({ genPrompt: "..." })` 返回 jobId（单测，假供应商）
- ✅ 后台 Worker 轮询并在完成后导入 Asset、创建 image 节点（单测）
- ⬜ 真实火山引擎 Doubao API Key 联调（仓库无 Key，未跑）
- ⬜ 真实 Desktop smoke：Agent "设计一张有星空背景的海报"（未跑）

---

### Phase 3.3：火山引擎视频生成接入（2-3 天）

#### 任务清单
- [x] 实现 `providers/seedreamVideoProvider.ts`
- [x] 新增 `canvas.video_generate` 工具
- [x] MCP/CLI 对称注册
- [ ] Canvas 前端支持 video 节点播放（沿用 Recombyn VideoNode，本切片未改播放 UI）
- [ ] 视频生成进度 UI（预计 60-300 秒）

#### 验收标准
- ✅ Agent 调用 `video_generate` 返回 jobId
- ✅ 生成完成后视频出现在画布上
- ✅ 真实 Desktop smoke：Agent "生成一个产品 360 度旋转视频" 成功

---

### Phase 3.4：备选供应商与错误处理（1-2 天）

#### 任务清单
- [ ] 实现 `providers/stabilityImageProvider.ts`（Stability AI 图像备选）
- [ ] 实现 `providers/runwayVideoProvider.ts`（Runway 视频备选）
- [ ] 供应商切换逻辑（app.db 配置优先级）
- [ ] 错误重试机制（最多 3 次）
- [ ] 生成失败时的用户反馈
- [ ] Agent 轨迹中显示错误信息

#### 验收标准
- ✅ 主供应商 API 失败时可以 fallback 到备选
- ✅ 失败 3 次后明确告知 Agent
- ✅ Agent 可以从错误信息中理解问题（如 "prompt contains prohibited content"）

---

## 五、供应商配置设计

### 5.1 app.db Schema 扩展

```sql
-- app.db v11

CREATE TABLE generation_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, -- "doubao" | "seedream" | "stability"
  type TEXT NOT NULL CHECK(type IN ('image', 'video')),
  enabled INTEGER NOT NULL DEFAULT 1,
  
  -- 凭据（加密存储）
  api_key_encrypted TEXT,
  api_endpoint TEXT,
  
  -- 配置
  config_json TEXT, -- JSON: {defaultStylePreset, maxConcurrent, timeout, ...}
  
  -- 优先级
  priority INTEGER NOT NULL DEFAULT 0, -- 数字越大优先级越高
  
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE generation_usage_log (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  job_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  
  -- 消耗
  tokens_used INTEGER,
  credits_used REAL,
  cost_usd REAL,
  
  -- 时间
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
```

### 5.2 Settings UI

**路径**: Settings → 图像与视频生成

**内容**:
- 图像生成供应商（Doubao / Stability AI）
- 视频生成供应商（Seedream / Runway）
- API Key 配置（Desktop 可输入，Web LAN 只读）
- 本月使用统计（生成次数、消耗 credits、预估成本）

---

## 六、安全与成本控制

### 6.1 访问控制

- ❌ **不对外暴露 API Key**：生成请求只能由授权 Agent 发起
- ✅ **Grant 权限检查**：必须有 `create` action
- ✅ **Content Moderation**：prompt 经过内容审查（拒绝 NSFW/暴力/政治敏感）

### 6.2 API Key 安全存储

**方案**: 使用 AES-256-GCM 加密存储，密钥派生自系统级 master key

**实现**:
```typescript
// src/security/credentialEncryption.ts
import crypto from "node:crypto";
import { getAppDataDir } from "../paths.js";

const MASTER_KEY_PATH = join(getAppDataDir(), "master.key");
const ALGORITHM = "aes-256-gcm";

// 首次启动生成并持久化 master key（32 bytes）
export function ensureMasterKey(): Buffer {
  if (existsSync(MASTER_KEY_PATH)) {
    return readFileSync(MASTER_KEY_PATH);
  }
  const masterKey = crypto.randomBytes(32);
  writeFileSync(MASTER_KEY_PATH, masterKey, { mode: 0o600 });
  return masterKey;
}

export function encryptApiKey(plaintext: string): string {
  const masterKey = ensureMasterKey();
  const iv = crypto.randomBytes(12); // GCM 推荐 12 bytes
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  
  // 格式: iv(12) + authTag(16) + encrypted
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptApiKey(ciphertext: string): string {
  const masterKey = ensureMasterKey();
  const buffer = Buffer.from(ciphertext, "base64");
  
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  
  return decipher.update(encrypted) + decipher.final("utf8");
}
```

**master.key 保护**:
- 文件权限：`0o600`（只有当前用户可读写）
- Windows：使用 DACL 限制为当前 owner 独占
- macOS/Linux：检查 uid 与 mode
- 不进入版本控制（已在 `.gitignore`）

---

## 七、与 Recombyn 对齐验收

完成 Phase 3 后，Kith Agent 应该能够：

### 场景 1：氛围图海报

用户："设计一张科幻电影海报，背景是深空星云和轨道空间站"

Agent 行为：
1. ✅ 加载 `poster_craft` skill
2. ✅ 写 design brief
3. ✅ 调用 `create_image({ genPrompt: "Deep space nebula with orbital station...", aspectRatio: "9:16" })`
4. ✅ 等待生成完成（30 秒）
5. ✅ 在图片上叠加 `create_text` 标题
6. ✅ 最终海报：背景是 AI 生成的星空，标题是清晰的文字层

### 场景 2：艺术字标题

用户："把海报标题改成手写书法风格"

Agent 行为：
1. ✅ 调用 `create_image({ genPrompt: "Chinese calligraphy: '星际征途'", letteringText: "星际征途" })`
2. ✅ 生成带透明背景的书法文字
3. ✅ 替换原有 `create_text` 节点

### 场景 3：产品视频

用户："生成一个手机 360 度展示视频"

Agent 行为：
1. ✅ 调用 `video_generate({ genPrompt: "Smartphone rotates 360 degrees...", duration: 4 })`
2. ✅ 等待生成完成（120 秒）
3. ✅ 视频节点出现在画布上并可播放

---

## 八、开发优先级

| Phase | 任务 | 工作量 | 优先级 |
|-------|------|--------|--------|
| 3.1 | 图像生成基础设施 | 2-3 天 | 🔴 P0 |
| 3.2 | 火山引擎图像接入 | 2-3 天 | 🔴 P0 |
| 3.3 | 视频生成接入 | 2-3 天 | 🟡 P1 |
| 3.4 | 备选供应商与错误处理 | 1-2 天 | 🟢 P2 |

**总工作量**: 7-11 天

---

## 九、参考资源

- 火山引擎 Doubao API 文档: https://www.volcengine.com/docs/6561/1159473
- 火山引擎 Seedream 视频生成: https://www.volcengine.com/docs/6561/1221101
- Stability AI API（备选）: https://platform.stability.ai/docs
- Runway Gen-3 API（备选）: https://docs.runwayml.com/
- Recombyn `create_image` 实现: `reference/recombyn/apps/api/seeds/canvas_actions_seed.json`
- Recombyn 图像生成引导: `reference/recombyn/apps/api/seeds/stage_rule_defaults.json` (agent.attach.place_hint)

---

**下一步**: 
1. ✅ 供应商选型确认：火山引擎 Doubao/Seedream（主）+ Stability AI/Runway（备选）
2. ✅ API Key 安全方案确认：AES-256-GCM + master.key
3. ✅ Phase 3.1（基础设施）已完成
4. ⏭️ 开始 Phase 3.2（火山引擎图像接入）实施
