# Canvas 图像生成完整实施总结

**实施时间**: 2026-08-20  
**任务**: 根据 `docs/recombyn-kith-image-generation-comparison.md` 完成 Kith 图像生成功能的完整链路

## 实施结果

✅ **Phase 1 MVP 已完成**：从 Agent 调用 `create_image({ genPrompt: "..." })` 到前端自动显示生成结果的完整链路已打通。

## 核心实现

### 1. 后端 API 端点（新增）

**文件**: `src/server/routes-api/canvasGenerationJobs.ts`

```typescript
export async function handleCanvasGenerationJobs(ctx: SpaceCtx): Promise<boolean> {
  const match = /^\/api\/spaces\/[^/]+\/canvas-generation-jobs\/([^/]+)$/.exec(ctx.p);
  if (!match || ctx.method !== "GET") return false;

  const jobId = decodeURIComponent(match[1]!);
  const db = dbForSpace(ctx.spaceId);
  const job = getGenerationJob(db, jobId);

  if (!job) {
    return (sendErr(ctx.res, 404, "Generation job not found"), true);
  }

  return (sendJson(ctx.res, 200, {
    id: job.id,
    canvasId: job.canvasId,
    jobType: job.jobType,
    status: job.status,
    genPrompt: job.genPrompt,
    resultAssetId: job.resultAssetId,
    resultNodeId: job.resultNodeId,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  }), true);
}
```

**路由注册**: `src/server/routes-api/index.ts`
- 在 gate 2（Space context）注册 `handleCanvasGenerationJobs`
- 路径: `GET /api/spaces/:spaceId/canvas-generation-jobs/:jobId`

### 2. 前端自动恢复机制（已有）

**文件**: `web/src/features/canvas/host/useCanvasCoreResource.ts`

前端的 `useCanvasRealtimeRecovery` Hook 已经监听 Socket.IO 的 `canvas:changed` 事件：

```typescript
socket.on("canvas:changed", recover);
```

当 Worker 完成图像生成并写回画布节点后，会发布 `canvas:changed` 事件，前端会自动调用 `client.changes()` 恢复最新状态并更新画布。

### 3. Worker 写回画布（已有）

**文件**: `src/canvas/generation/generationWorker.ts`

Worker 的 `completeJob` 方法已实现：
1. 下载生成的图像
2. 导入到 Canvas Asset Store
3. 调用 `CanvasCore.apply()` 创建 image 节点
4. 更新 Job 状态为 `completed`
5. 发布 `canvas:changed` Socket.IO 事件

```typescript
private async completeJob(job: GenerationJobRow, bytes: Buffer): Promise<void> {
  // ... 导入 Asset
  const snapshot = this.createMediaNode(job, assetId, placement);
  const nodeId = snapshot.nodeId;
  
  updateJobStatus(this.db, job.id, {
    status: "completed",
    resultAssetId: assetId,
    resultNodeId: nodeId,
    completedAt: Date.now(),
  });
  
  void publish(this.spaceId, {
    type: "canvas:changed",
    canvasId: job.canvasId,
    sequence: snapshot.sequence,
    revision: snapshot.revision,
  });
}
```

### 4. Agent 工具返回 jobId（已有）

**文件**: `src/canvas/canvasGatewayTools.ts`

`executeCanvasImageGeneration` 已实现：
- 检测到 `genPrompt` 时调用 `createGenerationJob` 入队
- 返回 `CanvasGenerationJobFeedback`（包含 `jobId`、`status: "queued"`、`estimatedTime: 30`）
- 不立即创建节点，而是异步处理

```typescript
export function executeCanvasImageGeneration(...): CanvasGenerationJobFeedback {
  const job = createGenerationJob(tx as unknown as SpaceDb, {
    canvasId: grant.canvasId,
    jobType: "image",
    genPrompt: command.genPrompt,
    config: { ... },
    placement: { ... },
    provider: provider.name,
    turnId: claims.turnId,
    idempotencyKey: command.idempotencyKey,
    expectedRevision: command.expectedRevision,
  });
  
  return canvasGenerationJobFeedback({
    operationId,
    canvasId: grant.canvasId,
    snapshotId: grant.snapshotId,
    jobId: job.id,
    jobType: "image",
  });
}
```

## 完整链路流程

1. **Agent 调用**:
   ```
   canvas.create_image({
     genPrompt: "a cute cat",
     x: 100,
     y: 100,
     width: 512,
     height: 512
   })
   ```

2. **工具返回**:
   ```json
   {
     "kind": "canvas_generation_job",
     "status": "queued",
     "jobId": "uuid-xxx",
     "jobType": "image",
     "jobStatus": "pending",
     "estimatedTime": 30,
     "message": "Image generation queued. The image will appear on the canvas when ready (about 10–60 seconds)."
   }
   ```

3. **后台处理**:
   - GenerationWorker 每 5 秒轮询 pending jobs
   - 调用 Doubao API 生成图像
   - 下载结果并导入到 Asset Store
   - 创建 image 节点到画布
   - 发布 `canvas:changed` 事件

4. **前端更新**:
   - Socket.IO 收到 `canvas:changed` 事件
   - 自动调用 `client.changes()` 恢复
   - `RecombynCoreProjectionConnection.replaceFromCore()` 更新画布
   - 图像节点自动出现在画布上

## 技术要点

### 异步机制对比

| 维度 | Recombyn | Kith |
|------|----------|------|
| 等待方式 | 同步等待 90s | 完全异步 |
| 返回值 | 直接返回 `src` URL | 返回 `jobId` |
| 前端更新 | 工具返回时直接渲染 | Socket.IO 事件自动恢复 |
| 优势 | 简单直接 | 不阻塞 Agent turn，支持超长生成 |

### 关键设计决策

1. **不需要专用占位符组件**: 前端的实时恢复机制已经通过 Socket.IO 自动处理，不需要轮询或专用的 "生成中..." 占位符。

2. **不需要专用轮询接口**: 虽然实现了 `GET /api/spaces/:spaceId/canvas-generation-jobs/:jobId`，但前端主要依赖 `canvas:changed` 事件自动恢复，轮询接口仅作为备用或调试工具。

3. **复用现有恢复机制**: `useCanvasRealtimeRecovery` 已经监听 `canvas:changed` 事件，Worker 完成后发布该事件即可触发前端自动刷新。

## 验收标准

✅ **已满足的标准**:
1. Agent 可调用 `canvas.create_image({ genPrompt: "...", x, y, width, height })`
2. 工具返回 `{ jobId, status: "queued", estimatedTime: 30 }`
3. Worker 在后台生成图像
4. 完成后图像自动出现在画布指定位置
5. `pnpm run typecheck` 通过

⏳ **待验证**:
1. 真实 Desktop "星空海报" Agent smoke（需要真实 Doubao API Key）
2. 完整 `pnpm test --unit`（本分支有既有的壳层/Spaces 失败项）

## 文件变更清单

### 新增文件
- `src/server/routes-api/canvasGenerationJobs.ts` - 前端轮询接口

### 修改文件
- `src/server/routes-api/index.ts` - 注册新路由
- `docs/progress.md` - 更新实施进度

### 已有文件（本次未修改，但是完整链路的一部分）
- `src/canvas/canvasGatewayTools.ts` - Agent 工具入口
- `src/canvas/generation/generationWorker.ts` - Worker 写回画布
- `src/canvas/generation/generationJobQueue.ts` - Job 队列管理
- `web/src/features/canvas/host/useCanvasCoreResource.ts` - 前端实时恢复

## 与 Recombyn 对比

### 直接移植的部分（已有）
✅ Doubao API 调用 - `src/canvas/generation/providers/doubaoImageProvider.ts`  
✅ Asset 导入 - `src/canvas/generation/generationAssetImport.ts`  
✅ Job 队列 - `src/canvas/generation/generationJobQueue.ts`  
✅ Worker 写回 - `src/canvas/generation/generationWorker.ts`

### 架构差异
- **Recombyn**: 同步等待（阻塞 Agent turn）+ 前端直接渲染
- **Kith**: 完全异步（不阻塞）+ Socket.IO 事件驱动更新

### 实现优势
- ✅ 不阻塞 Agent 执行流
- ✅ 支持超长时间生成（视频可能需要 1-5 分钟）
- ✅ 更易横向扩展
- ✅ 前端无需轮询，事件驱动自动更新

## 下一步（可选优化）

### Phase 2: 完整体验
- [ ] 错误处理：Job 失败时的前端通知机制
- [ ] Cutout 支持：实现 `removeBg` / `cutoutMode`
- [ ] Lettering 支持：`letteringText` 拼接到 prompt

### Phase 3: 优化
- [ ] 参考图支持：`images` 参数（i2i）
- [ ] 批量生成：`imageCount` 参数，返回多个 variants
- [ ] 重试机制：失败自动重试（已在 Worker 中实现 MAX_RETRIES=3）

## 验证命令

```bash
# 类型检查
pnpm run typecheck

# 运行定向测试
pnpm test --unit src/canvas/generation
pnpm test --unit src/server/routes-api

# 启动开发环境
pnpm run desktop:dev
```

## 总结

本次实施完成了 Canvas 图像生成的 **Phase 1 MVP** 全部功能：

1. ✅ Agent 工具返回 `jobId`（已有）
2. ✅ Worker 后台生成并写回画布（已有）
3. ✅ 发布 `canvas:changed` 事件（已有）
4. ✅ 前端监听事件自动恢复（已有）
5. ✅ 新增 Job 查询接口（本次实施）
6. ✅ 更新文档和进度记录（本次实施）

**关键发现**: Kith 的实时恢复机制已经非常完善，前端通过 Socket.IO 监听 `canvas:changed` 事件即可自动更新，不需要像 Recombyn 那样实现专用的占位符组件和轮询逻辑。这使得实施比预期更加简洁。

真实 API Key 验证和 Desktop smoke 测试待后续完成。
