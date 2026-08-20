# Recombyn 图像生成完整链路 vs Kith 移植方案

## 目标

找到 Recombyn 如何实现 `create_image({ genPrompt: "..." })` 图像生成的**完整链路**，并整理出可以直接移植到 Kith 的方案。

---

## 1. Agent 调用入口

### Recombyn: `create_image` 工具定义

**文件**: `reference/recombyn/apps/api/seeds/canvas_actions_seed.json`

```json
{
  "op_key": "create_image",
  "kind": "create",
  "label": "Create image",
  "sort_order": 40,
  "model_hint": "Add an image node. Args: src|url or attachmentIndex (user attach), x,y,width,height. Or genPrompt for AI image hydrate. Optional letteringText=visible text in the image (helps later replaceText). Optional removeBg=true|cutoutMode=product|hair — host auto-cutouts after gen (required for ecommerce product plates so no white box remains). Atmosphere/poster heroes: genPrompt must be SCENE ONLY — no baked titles/dates/logos; put copy in create_text. Finished poster refs with baked text: STYLE only — prefer genPrompt clean bg, not full-bleed attachmentIndex. Lettering gate: use create_text+fontFamily only if Available fonts match the needed look ~≥90%; otherwise (esp. hero/main title) genPrompt + letteringText. Do not hardcode brush/calligraphy mood → catalog calligraphy font.",
  "args_schema": {
    "src": "string?",
    "attachmentIndex": "number?",
    "genPrompt": "string?",
    "letteringText": "string?",
    "removeBg": "boolean?",
    "cutoutMode": "product|hair?",
    "x": "number",
    "y": "number",
    "width": "number",
    "height": "number",
    "_rev": "image-cutout-product-1"
  }
}
```

**关键参数**：
- `genPrompt`: AI 生成提示词（核心）
- `letteringText`: 可见文本内容（用于书法字体场景）
- `removeBg` / `cutoutMode`: 背景移除模式（product / hair）
- `x, y, width, height`: 画布位置和尺寸

---

## 2. 后端处理流程

### Recombyn: 异步 Hydration 机制

**核心文件**: `reference/recombyn/apps/api/app/services/design/ops/image_hydrate.py`

#### 2.1 入口函数 `hydrate_tool_ops_images`

```python
async def hydrate_tool_ops_images(
    ops: list[dict[str, Any]],
    *,
    limit: int = 6,
    policy: str = "auto",
    rules: dict[str, str] | None = None,
    on_progress: _OnProgress | None = None,
    trace_id: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Apply/action entry: Celery when enabled, else in-process (ADR 0005)."""
```

**工作流**：
1. 检查是否有待 hydrate 的 `create_image` op（只有 `genPrompt`，无 `src`）
2. 如果 `design_image_hydrate_async=True`，则入队到 Celery
3. 否则走 in-process 路径直接生成

#### 2.2 Celery 异步路径

**文件**: `reference/recombyn/apps/api/worker/tasks.py:run_image_hydrate_job`

```python
@celery.task(
    name="worker.tasks.run_image_hydrate_job",
    bind=True,
    autoretry_for=_JOB_TRANSIENT,
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    retry_kwargs={"max_retries": 2},
)
def run_image_hydrate_job(self, job_id: str) -> dict:
    """Fill create_image genPrompt ops via image providers (ADR 0005 / 0007)."""
    job = get_job(job_id, kind=_HYDRATE_KIND)
    # ... 从 Redis job store 读取 ops
    hydrated, filled = asyncio.run(
        _hydrate_tool_ops_images(
            list(ops),
            limit=max(1, min(24, limit)),
            policy=policy,
            rules={str(k): str(v) for k, v in rules.items()},
        )
    )
    update_job(job_id, kind=_HYDRATE_KIND, status="done", progress=100, result=result)
```

#### 2.3 真实图像生成调用

**文件**: `reference/recombyn/apps/api/app/services/design/ops/image_hydrate.py:_hydrate_tool_ops_images`

```python
async def _hydrate_tool_ops_images(...) -> tuple[list[dict[str, Any]], int]:
    from app.services.llm.image import generate_image
    
    catalog_id = _image_model_from_rules(rules)
    resolution = _resolution_for_model(catalog_id)
    
    # 并发生成所有待 hydrate 的图像
    async def _one(op: dict[str, Any]) -> dict[str, Any]:
        args = dict(op.get("args") or {})
        prompt = str(args.get("genPrompt") or args.get("prompt") or "").strip()
        lettering = str(args.get("letteringText") or args.get("lettering_text") or "").strip()
        
        # 如果有 letteringText，拼接到 prompt 中
        if lettering and lettering not in prompt:
            prompt = f"{prompt}\nExact glyphs to render (letteringText): {lettering}. ..."
        
        aspect = _aspect_or_size_from_args(args)  # 从 width/height 推导纵横比
        
        result = await generate_image(
            prompt=prompt[:800],
            model=catalog_id,
            aspect_ratio=aspect,
            quality="standard",
            resolution=resolution,
        )
        url = (result.get("images") or [None])[0]
        
        if url:
            src = str(url)
            # 如果有 cutoutMode，自动抠图
            cut_mode = _cutout_mode_for_hydrate(args)
            if cut_mode:
                src, applied = await _maybe_cutout_hydrated_src(src, cut_mode)
                if applied:
                    args["cutoutApplied"] = True
            args["src"] = src
        
        return {"name": "create_image", "args": args, "op_id": op.get("op_id")}
    
    # 并发执行，有超时保护
    task_by_idx = {asyncio.create_task(_one(ops[i])): i for i in pending_idx}
    done, pending = await asyncio.wait(set(task_by_idx.keys()), timeout=budget)
```

---

## 3. 异步生成服务

### Recombyn: 统一图像生成接口

**文件**: `reference/recombyn/apps/api/app/services/llm/image.py`

#### 3.1 生成入口 `generate_image`

```python
async def generate_image(
    *,
    prompt: str,
    model: str | None = None,
    aspect_ratio: str | None = None,
    quality: str | None = None,
    resolution: str | None = None,
    images: list[str] | None = None,  # 参考图
) -> dict[str, Any]:
    """Generate images via LangChain ``image_chain`` (Doubao / OpenRouter)."""
    from app.services.llm import usage_callback_handler
    
    handler = usage_callback_handler(source="image", kind="tool")
    result = await image_chain.ainvoke({
        "prompt": prompt,
        "model": model,
        "aspect_ratio": aspect_ratio,
        "quality": quality,
        "resolution": resolution,
        "images": images,
    }, config={"callbacks": [handler]})
    
    return result  # {"images": [url1, url2, ...], "model": "...", ...}
```

#### 3.2 Provider 调度

```python
async def _generate_image_core(...) -> dict[str, Any]:
    """Provider dispatch (BYOK / Doubao / OpenRouter)."""
    from app.services.llm import get_llm_endpoint
    
    if parse_byok_model_ref(model):
        # 用户自定义供应商
        endpoint = get_llm_endpoint(model)
        return await _generate_byok_image(endpoint, ...)
    
    catalog_id = resolve_image_model(model)
    api_model = _api_model_id(catalog_id)
    provider = _image_provider(catalog_id)
    
    if provider == "openrouter":
        return await _generate_openrouter_image(...)
    else:
        return await _generate_doubao_image(...)  # Doubao Ark / Seedream
```

#### 3.3 Doubao Ark 实现

```python
async def _generate_doubao_image(...) -> dict[str, Any]:
    client, _endpoint = build_async_openai_client(
        provider="doubao",
        api_model=api_model,
    )
    limits = _catalog_image_limits(catalog_id)
    size = _size_for_catalog(aspect_ratio, resolution, limits)
    
    extra_body: dict[str, Any] = {"watermark": False}
    opt = _optimize_prompt_options(quality)
    if opt:
        extra_body["optimize_prompt_options"] = opt
    
    # 参考图（i2i）
    refs = [u.strip() for u in (images or []) if isinstance(u, str) and u.strip()]
    if refs:
        extra_body["image"] = refs[0] if len(refs) == 1 else refs
    
    result = await client.images.generate(
        model=api_model,
        prompt=prompt,
        size=size,  # "2048x2048" / "1440x2560"
        response_format="url",
        output_format="png",
        extra_body=extra_body,
    )
    
    data = result.model_dump()
    out = _extract_images(data)
    return {
        "images": out,  # [url1, url2, ...]
        "text": None,
        "model": catalog_id,
    }
```

---

## 4. Asset 导入

### Recombyn: `create_asset_from_url`

**文件**: `reference/recombyn/apps/api/app/services/assets.py`

**调用路径**: `chat_image_jobs.py:execute_image_generate` → `assets.py:create_asset_from_url`

```python
def create_asset_from_url(
    user_id: str,
    url: str,
    *,
    kind: str = "image",
    source: str = "ai_image",
    prompt: str | None = None,
) -> dict[str, Any]:
    """
    1. 从 URL 下载图像（支持 data: URL 和 http(s) URL）
    2. 存储到 COS/S3 或本地 storage
    3. 写入 assets 表
    """
    data, ctype = _fetch_bytes(url)  # 下载
    ext, mime = _guess_ext_mime(url, ctype)
    width, height = _probe_image_size(data)  # PIL 读取尺寸
    
    asset_id = f"asset_{uuid.uuid4().hex[:16]}"
    object_key = f"assets/{user_id}/{asset_id}.{ext}"
    put_bytes(object_key, data, content_type=mime)  # 存储
    
    public_url = _display_url(
        object_key,
        source_url=url,
        kind=kind,
        image_bytes=data if kind == "image" else None,
        mime=mime,
    )
    
    # 写入数据库
    with Session(engine) as session:
        row = crud.create_asset(
            session=session,
            asset_id=asset_id,
            user_id=user_id,
            kind=kind,
            object_key=object_key,
            url=public_url,  # 公开 URL 或 data: URL
            mime=mime,
            width=width,
            height=height,
            source=source,  # "ai_image"
            prompt=prompt,
            created_at=time.time(),
        )
    return _row_to_asset(row)
```

**返回格式**：
```python
{
    "id": "asset_abc123",
    "kind": "image",
    "url": "https://cos.example.com/assets/user123/asset_abc123.png",  # 或 data: URL
    "objectKey": "assets/user123/asset_abc123.png",
    "mime": "image/png",
    "width": 2048,
    "height": 2048,
    "source": "ai_image",
    "prompt": "a cute cat",
    "meta": null,
    "createdAt": 1234567890000
}
```

---

## 5. 前端占位符

### Recombyn: ImageGeneratorNode

**文件**: `reference/recombyn/apps/web/src/components/editor/nodes/ImageGeneratorNode/ImageGeneratorCard.tsx`

#### 5.1 节点渲染

前端在画布上创建一个 **placeholder node**（`key="imageGenerator"`），显示：
- 空矩形占位板（x, y, width, height）
- 浮动 Composer（输入框 + 设置 + 发送按钮）
- 生成中状态显示（`processStatus: "running"`）

```tsx
function ImageGeneratorCard({ nodeId, sceneBox, showComposer, disabled }: Props) {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("2K");
  const [modelId, setModelId] = useState("doubao-seedream-5-0-lite");
  
  const onGenerate = async () => {
    setSending(true);
    dispatch(patchDocumentNode({
      nodeId,
      patch: {
        attrs: {
          processStatus: "running",
          processKind: "generate",
          processLabel: "生成中...",
          genPrompt: prompt,  // 保存 prompt 到 node attrs
        },
      },
    }));
    
    const body = {
      prompt: text,
      model: modelId,
      quality: "standard",
      resolution,
      aspect_ratio: aspectRatio !== "smart" ? aspectRatio : undefined,
      images: refImages,  // 参考图
    };
    
    // 并发生成多张（imageCount=2 时发两次请求）
    const slotUrls = await Promise.all(
      Array.from({ length: imageCount }, async () => {
        const res = await generateImage(body, { signal: ac.signal });
        return pickUrl(res);
      })
    );
    
    // 成功后原地 promote 为 image node
    dispatch(finishImageGenerator({
      nodeId,
      src: slotUrls[0],
      variants: slotUrls,
      genPrompt: text,
    }));
  };
}
```

#### 5.2 Redux 状态管理：`finishImageGenerator`

**文件**: `reference/recombyn/apps/web/src/store/modules/editor.ts`

```typescript
finishImageGenerator(state, action) {
  const nodeId = String(action.payload?.nodeId || '');
  const src = String(action.payload?.src || '').trim();
  if (!state.document || !nodeId || !src) return;
  
  pushHistory(state);
  const variants = Array.isArray(action.payload?.variants)
    ? action.payload.variants.map(u => String(u || '').trim()).filter(Boolean)
    : undefined;
  
  // 将 imageGenerator node 转换为 image node
  state.document = promoteImageGeneratorToImage(state.document, nodeId, {
    src,
    width: action.payload?.width,
    height: action.payload?.height,
    x: action.payload?.x,
    y: action.payload?.y,
    name: action.payload?.name,
    variants,
    genPrompt: action.payload?.genPrompt,
  });
  
  state.dirty = true;
  state.sceneReloadToken += 1;
  state.selectedNodeId = nodeId;
}
```

**`promoteImageGeneratorToImage` 核心逻辑**：
1. 保持原有的 x, y, width, height（原地生成）
2. 将 `key: "imageGenerator"` 改为 `key: "image"`
3. 设置 `attrs.src = url`
4. 清理 `processStatus`, `processKind`, `processLabel`
5. 保留 `genPrompt` 和 `variants` 用于后续编辑

---

## 6. 实时更新机制

### Recombyn: 前端轮询模式

Recombyn 的 **Canvas hydrate** 是在 **Agent 工具执行流程中同步等待**的：

1. Agent 调用 `create_image({ genPrompt: "cat" })`
2. Backend 检测到 `genPrompt`，入队 Celery job
3. **前端在 Agent 回复流中等待工具返回**（最长 90s）
4. Job 完成后返回 `{"name": "create_image", "args": {"src": "https://..."}}`
5. 前端收到完整 tool result，直接渲染图像节点

**关键点**：
- **不是**独立的前端轮询
- **是** Agent 工具调用的一部分，阻塞在 turn 执行流中
- 超时或失败会 fallback 到 in-process 路径

---

## 7. Kith 移植清单

### 7.1 已实现部分（当前 Kith 代码）

✅ **Job 队列基础设施**：
- `src/canvas/generation/generationJobQueue.ts` - 入队、查询、更新状态
- `src/canvas/generation/generationSupervisor.ts` - 轮询 pending jobs
- `src/canvas/generation/generationWorker.ts` - 调用供应商 API
- `src/canvas/generation/generationProviders.ts` - Doubao/Seedance 适配器
- `src/db/schema.ts:canvasGenerationJobs` - SQLite 表

✅ **Agent 工具定义**：
- `src/canvas/tools/canvasImageTools.ts:create_image` 接受 `genPrompt`
- `idempotencyKey` 生成，防止重复入队

✅ **Asset 导入**：
- `src/canvas/generation/generationAssetImport.ts:importGeneratedAsset`
- 下载、存储到 `.kith/canvas-assets/`
- 写入 `canvas_assets` 表

### 7.2 Kith 与 Recombyn 的关键差异

| 维度 | Recombyn | Kith（当前） | 需要调整 |
|------|----------|------------|----------|
| **入队时机** | Agent 工具执行时（hydrate） | Agent 工具执行时 | ✅ 一致 |
| **等待机制** | 同步等待（90s timeout） | 异步 Job + 前端轮询 | ⚠️ Kith 是异步的，需要前端轮询或 SSE |
| **返回值** | 直接返回 `src` URL | 返回 `jobId` | ⚠️ 需要 Agent 处理 `jobId` → 等待完成 → 使用 `assetId` |
| **占位符** | `imageGenerator` node | 无专用占位符 | ❌ 需要实现前端占位符 |
| **实时更新** | 工具调用返回时 | Worker 写回 + SSE 通知 | ⚠️ 需要实现 SSE 或轮询 |
| **Cutout** | 自动抠图（removeBg） | 未实现 | ❌ 需要集成 remove-bg |

### 7.3 需要新增的核心文件

#### 后端（TypeScript）

1. **`src/canvas/tools/canvasImageHydration.ts`** - Hydration 逻辑
   ```typescript
   export async function hydrateImageGenPrompt(
     db: SpaceDb,
     canvasId: string,
     genPrompt: string,
     placement: { x: number; y: number; width: number; height: number },
     config: { aspectRatio?: string; resolution?: string; model?: string },
     turnId?: string,
   ): Promise<{ jobId: string }> {
     const job = createGenerationJob(db, {
       canvasId,
       jobType: "image",
       genPrompt,
       placement,
       config,
       provider: "doubao",
       turnId,
       idempotencyKey: generateIdempotencyKey(canvasId, genPrompt, placement),
     });
     return { jobId: job.id };
   }
   ```

2. **`src/canvas/generation/generationCutout.ts`** - 抠图服务（可选）
   ```typescript
   export async function removeBackground(
     imageUrl: string,
     mode: "product" | "hair",
   ): Promise<string> {
     // 调用 rembg / remove.bg API
   }
   ```

3. **`src/server/routes-api/canvasGenerationJobs.ts`** - 前端轮询接口
   ```typescript
   router.get("/spaces/:spaceId/canvas/:canvasId/generation-jobs/:jobId", async (ctx) => {
     const job = getGenerationJob(db, ctx.params.jobId);
     ctx.body = {
       id: job.id,
       status: job.status,  // pending / processing / completed / failed
       resultAssetId: job.resultAssetId,
       resultNodeId: job.resultNodeId,
       errorMessage: job.errorMessage,
     };
   });
   ```

#### 前端（TypeScript）

4. **`web/src/features/canvas/components/ImageGeneratorPlaceholder.tsx`** - 占位符组件
   ```tsx
   export function ImageGeneratorPlaceholder({
     nodeId,
     genPrompt,
     jobId,
     onComplete,
   }: Props) {
     const [status, setStatus] = useState<"pending" | "processing" | "completed" | "failed">("pending");
     const [progress, setProgress] = useState(0);
     
     useEffect(() => {
       const interval = setInterval(async () => {
         const job = await fetchGenerationJob(jobId);
         setStatus(job.status);
         if (job.status === "completed") {
           clearInterval(interval);
           onComplete(job.resultAssetId, job.resultNodeId);
         }
       }, 2000);
       return () => clearInterval(interval);
     }, [jobId]);
     
     return (
       <div className="image-generator-placeholder">
         <div className="spinner" />
         <p>{genPrompt}</p>
         <p>{status === "processing" ? "生成中..." : "排队中..."}</p>
       </div>
     );
   }
   ```

5. **`web/src/features/canvas/hooks/useGenerationJobPolling.ts`** - 轮询 Hook
   ```typescript
   export function useGenerationJobPolling(jobId: string | null) {
     const [job, setJob] = useState<GenerationJob | null>(null);
     
     useEffect(() => {
       if (!jobId) return;
       const poll = async () => {
         const data = await fetchGenerationJob(jobId);
         setJob(data);
         if (data.status === "completed" || data.status === "failed") {
           return true;  // stop polling
         }
         return false;
       };
       
       const interval = setInterval(async () => {
         const shouldStop = await poll();
         if (shouldStop) clearInterval(interval);
       }, 2000);
       
       return () => clearInterval(interval);
     }, [jobId]);
     
     return job;
   }
   ```

### 7.4 需要修改的现有文件

1. **`src/canvas/tools/canvasImageTools.ts`**
   - 修改 `create_image` 工具实现：
     ```typescript
     if (args.genPrompt) {
       const { jobId } = await hydrateImageGenPrompt(db, canvasId, args.genPrompt, ...);
       // 不立即创建节点，而是返回 jobId 让 Agent 知道正在生成
       return {
         success: true,
         message: `Image generation started (jobId: ${jobId}). Poll /generation-jobs/${jobId} for status.`,
         jobId,
       };
     }
     ```

2. **`src/canvas/generation/generationWorker.ts`**
   - 完成后写回画布：
     ```typescript
     async function processImageJob(job: GenerationJobRow): Promise<void> {
       const result = await doubaoAdapter.generateImage({
         prompt: job.genPrompt,
         size: "2048x2048",
       });
       
       const asset = await importGeneratedAsset(db, canvasId, result.url, "image");
       
       // 创建 image node
       const nodeId = await createImageNode(db, canvasId, {
         src: asset.localPath,
         x: placement.x,
         y: placement.y,
         width: placement.width,
         height: placement.height,
       });
       
       updateJobStatus(db, job.id, {
         status: "completed",
         resultAssetId: asset.id,
         resultNodeId: nodeId,
       });
       
       // 发布 SSE 通知前端
       emitCanvasUpdate(canvasId, { type: "generation_completed", jobId: job.id, nodeId });
     }
     ```

3. **`web/src/features/canvas/host/NativeRecombynCanvasHarness.tsx`**
   - 监听 SSE 事件，自动刷新画布：
     ```typescript
     useEffect(() => {
       const eventSource = new EventSource(`/api/canvas/${canvasId}/events`);
       eventSource.addEventListener("generation_completed", (e) => {
         const data = JSON.parse(e.data);
         refetchCanvasScene();  // 重新加载画布
       });
       return () => eventSource.close();
     }, [canvasId]);
     ```

### 7.5 可选优化

- **Cutout 集成**：集成 `rembg` Python 库或 `remove.bg` API
- **Lettering 支持**：将 `letteringText` 拼接到 prompt
- **参考图支持**：支持 `images` 参数（i2i）
- **批量生成**：支持 `imageCount` 参数，返回多个 variants

---

## 8. 实施步骤

### Phase 1: 最小可行路径（MVP）

1. ✅ Job 队列已实现
2. ✅ Worker 已实现
3. ✅ Asset 导入已实现
4. ❌ **修改 `create_image` 工具**：返回 `jobId` 而非立即创建节点
5. ❌ **实现前端轮询**：`useGenerationJobPolling` Hook
6. ❌ **实现占位符**：`ImageGeneratorPlaceholder` 组件
7. ❌ **Worker 写回画布**：完成后创建 image node

### Phase 2: 完整体验

8. ❌ **SSE 实时通知**：替代轮询
9. ❌ **Cutout 支持**：`removeBg` / `cutoutMode`
10. ❌ **Lettering 支持**：`letteringText` → 书法字体
11. ❌ **参考图支持**：`images` 参数

### Phase 3: 生产硬化

12. ❌ **重试机制**：失败自动重试
13. ❌ **超时保护**：90s 超时 fallback
14. ❌ **错误处理**：结构化错误反馈
15. ❌ **监控告警**：Job 队列积压、失败率

---

## 9. 关键技术事实

### Recombyn 的设计亮点

1. **同步等待 + 异步队列混合**：
   - Agent 工具调用时同步等待（最长 90s）
   - 超时或队列不可用时 fallback 到 in-process
   - 前端**不需要**独立轮询，直接收到工具返回

2. **Hydration 是工具执行的一部分**：
   - 不是独立的后台任务
   - Agent 的 turn 会等待图像生成完成
   - 返回值直接包含 `src` URL

3. **自动抠图**：
   - 根据 prompt 关键词自动判断（"white background", "product shot"）
   - 支持 `removeBg=true` 显式指定
   - 调用 `remove_background` 服务（rembg）

### Kith 的架构差异

1. **完全异步**：
   - Worker 独立运行
   - Agent 不等待生成完成
   - 需要前端轮询或 SSE 通知

2. **优势**：
   - 不阻塞 Agent turn
   - 支持超长时间生成（视频）
   - 更易横向扩展

3. **劣势**：
   - 需要额外的通知机制
   - Agent 需要处理 `jobId`
   - 前端需要占位符 + 轮询

---

## 10. 总结

### 可直接移植的部分

✅ **图像生成 API 调用**：Doubao Ark 适配器已完成  
✅ **Asset 下载和存储**：`importGeneratedAsset` 已完成  
✅ **Job 队列和 Worker**：基础设施已完成  

### 需要补充的核心功能

❌ **Agent 工具返回 jobId**：修改 `create_image` 工具逻辑  
❌ **前端占位符组件**：显示生成中状态  
❌ **前端轮询或 SSE**：监听 Job 完成  
❌ **Worker 写回画布**：完成后创建 image node  

### 迁移建议

**优先级 P0（必须）**：
1. 修改 `create_image` 工具，返回 `jobId`
2. 实现前端轮询（2s 间隔）
3. Worker 完成后写回画布（创建 image node）
4. 简单占位符（显示 "生成中..."）

**优先级 P1（推荐）**：
5. SSE 实时通知（替代轮询）
6. 完整占位符组件（进度、取消）
7. 错误处理和重试

**优先级 P2（可选）**：
8. Cutout 支持（`removeBg`）
9. Lettering 支持（`letteringText`）
10. 参考图支持（`images`）

---

## 附录：核心数据结构

### Recombyn Job Store（Redis）

```python
{
  "job_id": "abc123",
  "kind": "hydrate",  # 或 "image"（独立生成）
  "status": "queued|processing|done|failed",
  "progress": 0-100,
  "ops": [{"name": "create_image", "args": {"genPrompt": "cat", ...}}],
  "limit": 6,
  "policy": "auto",
  "rules": {"assets.image_default_model": "doubao-seedream-5-0-lite"},
  "result": {"ops": [...], "filled": 2},
  "error": null,
  "trace_id": "xyz789"
}
```

### Kith Job Table（SQLite）

```sql
CREATE TABLE canvas_generation_jobs (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  job_type TEXT NOT NULL,  -- "image" | "video"
  status TEXT NOT NULL,     -- "pending" | "processing" | "completed" | "failed"
  gen_prompt TEXT NOT NULL,
  config_json TEXT,         -- {"aspectRatio": "1:1", "resolution": "2K", "model": "..."}
  placement_json TEXT NOT NULL,  -- {"x": 100, "y": 100, "width": 512, "height": 512}
  provider TEXT NOT NULL,   -- "doubao" | "seedance"
  provider_job_id TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  result_asset_id TEXT,     -- 生成完成后的 asset ID
  result_node_id TEXT,      -- 生成完成后的 node ID
  turn_id TEXT,
  idempotency_key TEXT UNIQUE,
  expected_revision INTEGER,
  created_at DATETIME NOT NULL,
  started_at DATETIME,
  completed_at DATETIME,
  updated_at DATETIME NOT NULL
);
```

---

**文档版本**: v1.0  
**生成时间**: 2026-08-20  
**状态**: 完整对比 + 移植清单
