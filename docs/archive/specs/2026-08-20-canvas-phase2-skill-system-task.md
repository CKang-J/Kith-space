# Canvas Agent Phase 2：设计技能系统 - 任务分派

> 日期：2026-08-20
> 负责人：@Cursor
> 基线：Phase 0 和 Phase 1 已完成
> 目标：让 Kith-space Agent 的画布操作效果达到 Recombyn 原生 Agent 水平
> 参考规格：`2026-08-19-canvas-agent-effect-alignment.md`

## 1. 核心目标

**让 Agent 从"会操作工具"升级到"会做设计"**

Phase 0/1 已经让 Agent 会"正确调用工具"（参数完整、描述详尽、操作协议规范），但还不会"做设计"。Phase 2 要通过设计技能系统，让 Agent 获得专业的设计方法论和领域知识。

### 1.1 验收标准

用户说："设计一张万圣节活动海报"

Agent 应该：
1. ✅ 主动加载 `poster_craft` skill
2. ✅ 先生成结构化 design brief（目标/受众/情绪/视觉方向）
3. ✅ 完整构图（hero 区/标题/支持文本/CTA）
4. ✅ 色彩氛围符合万圣节主题（橙黑配色，不是紫蓝渐变）
5. ✅ 层次清晰（视觉焦点明确、排版规范）
6. ✅ 不出现 AI 俗套（玻璃卡片、等距功能卡、随机粒子等）

---

## 2. 任务分解

Phase 2 分为 **3 个子任务**，按顺序完成：

### Task 2.1：Skill 基础设施（1-2天）

搭建 skill 系统的骨架，包括：
- Skill registry（注册表）
- Skill loader（加载器）
- 两个新工具：`canvas.skill_list` 和 `canvas.skill_get`
- Skill catalog 注入 Canvas skill pack

### Task 2.2：Foundation Skills 移植（2-3天）

移植 Recombyn 的 6 个基础技能：
1. `design_brief` — 设计简报方法论（P0 最关键）
2. `composition` — 构图理论
3. `color` — 色彩理论
4. `typography` — 排版规则
5. `anti_ai_slop` — 反 AI 俗套禁令（P0 关键）
6. `polish` — 打磨与自检清单

### Task 2.3：Domain Skills 移植（2-3天）

移植 Recombyn 的 3 个领域技能：
1. `poster_craft` — 海报设计（P0 优先）
2. `landing_page` — 落地页设计（P1）
3. `banner_ad` — 横幅广告设计（P1）

---

## 3. Task 2.1：Skill 基础设施

### 3.1 目标目录结构

```
src/canvas/skills/
  foundation/
    design_brief.md
    composition.md
    color.md
    typography.md
    anti_ai_slop.md
    polish.md
  domains/
    poster_craft.md
    landing_page.md
    banner_ad.md
  skillRegistry.ts      # 技能注册与查询
  skillLoader.ts        # 读取 .md 文件
  contracts.ts          # TypeScript 类型定义
```

### 3.2 核心类型定义

`src/canvas/skills/contracts.ts`：

```typescript
export type SkillCategory = "foundation" | "domains";

export interface SkillMetadata {
  skillKey: string;           // 唯一标识，如 "poster_craft"
  displayName: string;        // 显示名称，如 "Poster Craft"
  category: SkillCategory;
  whenToUse: string;          // 何时使用（一句话）
  description: string;        // 简短描述
  relatedSkills?: string[];   // 关联技能
  priority: "P0" | "P1" | "P2"; // 优先级
}

export interface Skill {
  metadata: SkillMetadata;
  content: string;            // Markdown 全文
}

export interface SkillCatalog {
  foundation: SkillMetadata[];
  domains: SkillMetadata[];
}
```

### 3.3 Skill Registry

`src/canvas/skills/skillRegistry.ts`：

```typescript
import type { SkillMetadata, SkillCatalog } from "./contracts.ts";

// 手工注册所有 skills 的元数据
const SKILL_REGISTRY: Record<string, SkillMetadata> = {
  design_brief: {
    skillKey: "design_brief",
    displayName: "Design Brief",
    category: "foundation",
    whenToUse: "Starting any new design from scratch",
    description: "Structured design brief template covering purpose, audience, emotion, visual thesis, and composition archetype",
    priority: "P0",
  },
  composition: {
    skillKey: "composition",
    displayName: "Composition",
    category: "foundation",
    whenToUse: "Making layout and composition decisions",
    description: "Layout archetypes (hero, split, grid, etc.) and composition rules (balance, focal point, rhythm)",
    priority: "P0",
  },
  color: {
    skillKey: "color",
    displayName: "Color",
    category: "foundation",
    whenToUse: "Choosing color palette or making color decisions",
    description: "Color theory, palette strategies (monochrome, analogous, complementary, triadic), and emotional associations",
    priority: "P0",
  },
  typography: {
    skillKey: "typography",
    displayName: "Typography",
    category: "foundation",
    whenToUse: "Choosing fonts or setting type hierarchy",
    description: "Type ladders (hero/title/body/caption), font pairing rules, and hierarchy principles",
    priority: "P0",
  },
  anti_ai_slop: {
    skillKey: "anti_ai_slop",
    displayName: "Anti-AI Slop",
    category: "foundation",
    whenToUse: "Always (implicit check before finalizing)",
    description: "Common AI design clichés to avoid: purple-blue gradients, glassmorphism, isometric function cards, random particles, etc.",
    priority: "P0",
  },
  polish: {
    skillKey: "polish",
    displayName: "Polish",
    category: "foundation",
    whenToUse: "Final refinement before completion",
    description: "Refinement checklist and self-review criteria",
    priority: "P1",
  },
  poster_craft: {
    skillKey: "poster_craft",
    displayName: "Poster Craft",
    category: "domains",
    whenToUse: "Creating posters, roll-ups, or key visuals",
    description: "End-to-end poster design playbook: brief → art direction → layout → execution → review",
    relatedSkills: ["design_brief", "composition", "color", "typography", "anti_ai_slop"],
    priority: "P0",
  },
  landing_page: {
    skillKey: "landing_page",
    displayName: "Landing Page",
    category: "domains",
    whenToUse: "Designing landing pages or homepage hero sections",
    description: "Landing page design playbook: hero section, value props, social proof, CTA hierarchy",
    relatedSkills: ["design_brief", "composition", "typography"],
    priority: "P1",
  },
  banner_ad: {
    skillKey: "banner_ad",
    displayName: "Banner Ad",
    category: "domains",
    whenToUse: "Creating banner ads or social media ads",
    description: "Banner ad design playbook: attention-grabbing within size constraints, clear CTA",
    relatedSkills: ["design_brief", "color", "typography"],
    priority: "P1",
  },
};

export function getSkillMetadata(skillKey: string): SkillMetadata | undefined {
  return SKILL_REGISTRY[skillKey];
}

export function listSkills(): SkillCatalog {
  const all = Object.values(SKILL_REGISTRY);
  return {
    foundation: all.filter((s) => s.category === "foundation"),
    domains: all.filter((s) => s.category === "domains"),
  };
}

export function getAllSkillKeys(): string[] {
  return Object.keys(SKILL_REGISTRY);
}
```

### 3.4 Skill Loader

`src/canvas/skills/skillLoader.ts`：

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill, SkillMetadata } from "./contracts.ts";
import { getSkillMetadata } from "./skillRegistry.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export async function loadSkill(skillKey: string): Promise<Skill | null> {
  const metadata = getSkillMetadata(skillKey);
  if (!metadata) return null;

  const category = metadata.category;
  const filePath = join(__dirname, category, `${skillKey}.md`);

  try {
    const content = await readFile(filePath, "utf-8");
    return { metadata, content };
  } catch (error) {
    console.error(`Failed to load skill "${skillKey}":`, error);
    return null;
  }
}
```

### 3.5 新增两个 Canvas 工具

#### canvas.skill_list

返回可用 skills 的目录（metadata only，不含全文）。

`src/canvas/canvasGatewayTools.ts` 新增：

```typescript
import { listSkills } from "./skills/skillRegistry.ts";

export async function canvasSkillList(grant: CanvasAccessGrantRow): Promise<SkillCatalog> {
  // 只要有 read_snapshot 或 read_live 就能看目录
  if (!grant.actions.read_snapshot && !grant.actions.read_live) {
    throw new Error("canvas.skill_list requires read permission");
  }
  return listSkills();
}
```

#### canvas.skill_get

返回指定 skill 的完整内容（Markdown 全文）。

```typescript
import { loadSkill } from "./skills/skillLoader.ts";

export async function canvasSkillGet(
  grant: CanvasAccessGrantRow,
  skillKey: string,
): Promise<string> {
  if (!grant.actions.read_snapshot && !grant.actions.read_live) {
    throw new Error("canvas.skill_get requires read permission");
  }

  const skill = await loadSkill(skillKey);
  if (!skill) {
    throw new Error(`Skill "${skillKey}" not found`);
  }

  return skill.content;
}
```

#### Gateway 注册

`src/capabilities/capabilityGateway.ts` 新增方法：

```typescript
async canvasSkillList(claims: TurnCapabilityClaims): Promise<unknown> {
  const grant = await this.getCanvasGrant(claims);
  return canvasSkillList(grant);
}

async canvasSkillGet(claims: TurnCapabilityClaims, skillKey: string): Promise<string> {
  const grant = await this.getCanvasGrant(claims);
  return canvasSkillGet(grant, skillKey);
}
```

#### MCP 注册

`src/server/mcp/stdio.ts` 新增：

```typescript
registerSchema(
  "canvas.skill_list",
  "List available Canvas design skills (foundation + domains). Returns catalog with skill keys, categories, and when-to-use descriptions.",
  z.object({}),
  "GET",
  "/agent-gateway/canvas/skill_list"
);

registerSchema(
  "canvas.skill_get",
  "Load full content of a Canvas design skill. Args: skillKey (from skill_list). Returns Markdown playbook.",
  z.object({ skillKey: z.string() }),
  "GET",
  "/agent-gateway/canvas/skill_get"
);
```

#### CLI 注册

`src/cli/index.ts` 新增：

```bash
canvas skill-list
canvas skill-get <skillKey>
```

### 3.6 扩展 Canvas Skill Pack

`src/canvas/canvasSkills.ts` 在 `CANVAS_CAPABILITY_DISCOVERY` 末尾增加：

```markdown
=== CANVAS_SKILLS_CATALOG ===
Available design skills (use canvas.skill_get to load full content):

Foundation:
- design_brief: Structured design brief template (purpose/audience/emotion/visual_thesis/composition)
- composition: Layout archetypes and composition rules
- color: Color theory and palette strategies
- typography: Type ladders and font selection rules
- anti_ai_slop: Common AI design clichés to avoid
- polish: Refinement and self-review checklist

Domains:
- poster_craft: Poster / roll-up / KV design playbook
- landing_page: Landing page / homepage design playbook
- banner_ad: Banner ad design playbook

How to choose:
- New design from scratch → load ONE primary surface skill (poster_craft / landing_page / ...) + design_brief
- Just recolor / rearrange → no skill needed, use typed tools directly
- Style/color decisions → load color + composition
- Always keep anti_ai_slop in mind (or load it explicitly)
```

### 3.7 Task 2.1 验收标准

- [ ] 目录结构创建完成
- [ ] `skillRegistry.ts` / `skillLoader.ts` / `contracts.ts` 实现完成
- [ ] `canvas.skill_list` 工具可用（返回 catalog）
- [ ] `canvas.skill_get` 工具可用（返回 skill 内容）
- [ ] MCP 和 CLI 都能调用这两个工具
- [ ] Canvas skill pack 中加入 skill catalog
- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm run web:build` 通过

---

## 4. Task 2.2：Foundation Skills 移植

### 4.1 Skill Markdown 格式规范

每个 skill 文件遵循以下结构：

```markdown
# <Skill Name>

**Deliverable**: <适用场景>.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns the craft rules.

## When to use

<何时需要这个 skill>

## Process overview

<该 skill 涉及的完整流程>

## <Section 1>

<具体内容>

## <Section 2>

<具体内容>

## Hard rules

<硬性禁令清单>

## Done when

<完成标准>

## Related skills

<关联技能列表>
```

### 4.2 需要移植的 6 个 Foundation Skills

从 `reference/recombyn/skills/foundation/` 移植以下技能：

#### 4.2.1 design_brief.md（P0）

**参考源**：`reference/recombyn/skills/foundation/design_brief/`

**核心内容**：
- 设计简报模板（Purpose / Audience / Emotion / Visual Thesis / Composition Archetype）
- 为什么需要先写 brief（对齐目标、避免盲目执行）
- Brief 的结构和每个字段的含义
- 示例 brief

**移植要点**：
- 保持英文为主（模型对英文设计术语更敏感）
- 可在末尾加中文关键词辅助："设计简报/目的/受众/情绪/视觉论点"

#### 4.2.2 composition.md（P0）

**参考源**：`reference/recombyn/skills/foundation/composition/`

**核心内容**：
- 构图 archetypes（hero / split / grid / masonry / editorial / asymmetric / centered）
- 构图原则（balance / focal point / rhythm / white space / visual flow）
- 如何选择构图类型
- 常见错误

#### 4.2.3 color.md（P0）

**参考源**：`reference/recombyn/skills/foundation/color/`

**核心内容**：
- 色彩理论基础（色相/饱和度/亮度）
- 配色策略（monochrome / analogous / complementary / triadic / split-complementary）
- 情绪色彩关联（红=激情、蓝=冷静、橙=活力、绿=自然等）
- 禁止事项（不要紫蓝渐变、不要过度饱和）

#### 4.2.4 typography.md（P0）

**参考源**：`reference/recombyn/skills/foundation/typography/`

**核心内容**：
- 排版阶梯（hero 72-96px / title 48-64px / subtitle 24-32px / body 16-20px / caption 12-14px）
- 字体配对规则（衬线+非衬线、粗+细、大+小）
- 层次原则（大小对比、字重对比、颜色对比）
- 可读性规则（行长 50-75 字符、行高 1.4-1.6 倍字号、段落间距）

#### 4.2.5 anti_ai_slop.md（P0）

**参考源**：`reference/recombyn/skills/foundation/anti_ai_slop/`

**核心内容**：
- AI 设计常见俗套清单：
  - 紫蓝渐变背景（purple-blue gradient）
  - 玻璃拟态卡片（glassmorphism cards）
  - 等距功能卡片网格（isometric function card grid）
  - 随机粒子/点阵背景（random particles / dot matrix）
  - 3D 漂浮元素（floating 3D elements）
  - 过度使用 emoji 作为图标
  - 千篇一律的圆角矩形卡片堆叠
- 为什么要避免（缺乏原创性、用户已经审美疲劳）
- 替代方案（用有意义的构图、克制的色彩、清晰的层次）

#### 4.2.6 polish.md（P1）

**参考源**：`reference/recombyn/skills/foundation/polish/`

**核心内容**：
- 打磨清单（alignment check / spacing consistency / color contrast / hierarchy clarity / typo check）
- 自检问题列表
- 何时认为"完成"

### 4.3 移植工作流程

对每个 skill：

1. **阅读原文**：完整阅读 `reference/recombyn/skills/foundation/<skill>/` 中的 Markdown 文件
2. **理解意图**：把握 skill 的核心方法论和关键规则
3. **提炼精简**：保留核心内容，删除冗余示例和 Recombyn 特定引用
4. **格式规范**：按照 4.1 的格式规范重新组织
5. **保持英文**：主体内容用英文，末尾可加中文关键词
6. **移植文件**：写入 `src/canvas/skills/foundation/<skill_key>.md`

### 4.4 Task 2.2 验收标准

- [ ] 6 个 foundation skills 文件创建完成
- [ ] 每个 skill 符合格式规范
- [ ] 调用 `canvas.skill_get("design_brief")` 返回正确内容
- [ ] 调用 `canvas.skill_get("anti_ai_slop")` 返回正确内容
- [ ] 所有 6 个 skills 在 `canvas.skill_list` 中正确列出
- [ ] `pnpm run typecheck` 通过

---

## 5. Task 2.3：Domain Skills 移植

### 5.1 需要移植的 3 个 Domain Skills

#### 5.1.1 poster_craft.md（P0 优先）

**参考源**：`reference/recombyn/skills/domains/poster_craft/`

**核心内容**：
- 海报设计完整流程（INPUT → BRIEF → ART DIRECTION → LAYOUT PLAN → DESIGN SYSTEM → EXECUTION → OBSERVE → REVIEW → CORRECTION → FINAL）
- 海报构图 archetypes（hero-dominant / split-hero / editorial / typographic）
- 层次规划（primary: 主标题 / secondary: 副标题/支持文本 / tertiary: 日期/CTA）
- 色彩策略（情绪色 + 中性底 / 主色 + 点缀色）
- 排版规则（hero title 大且醒目 / body text 可读 / CTA 明确）
- 执行步骤（先 create_frame → 背景层 → hero 元素 → 标题 → 支持内容 → CTA → 装饰）
- Hard rules（不用 emoji 作图标 / 不用 CSS gradient / 标题不超过 2 行 / CTA 必须可操作）
- Done when（构图完整 / 层次清晰 / 色彩协调 / 排版规范 / 无 AI slop）

**移植要点**：
- 这是 Phase 2 最关键的 skill，要完整移植
- 流程步骤要清晰、可执行
- Hard rules 要明确、可检查

#### 5.1.2 landing_page.md（P1）

**参考源**：`reference/recombyn/skills/domains/landing_page/`

**核心内容**：
- 落地页设计流程
- Hero section 结构（headline / subheadline / hero image or video / primary CTA）
- Value props 展示（3-4 个特性卡片）
- Social proof 区（客户 logo / testimonials）
- CTA 层次（primary / secondary）

#### 5.1.3 banner_ad.md（P1）

**参考源**：`reference/recombyn/skills/domains/banner_ad/`

**核心内容**：
- 横幅广告设计流程
- 尺寸约束下的信息优先级（品牌 / 核心信息 / CTA）
- 视觉冲击力技巧（高对比 / 鲜明色彩 / 简洁排版）
- CTA 按钮设计（明确文案 / 足够大 / 高对比）

### 5.2 移植工作流程

同 Task 2.2。

### 5.3 Task 2.3 验收标准

- [ ] 3 个 domain skills 文件创建完成
- [ ] `poster_craft.md` 完整且可执行
- [ ] 调用 `canvas.skill_get("poster_craft")` 返回正确内容
- [ ] 所有 3 个 skills 在 `canvas.skill_list` 的 domains 分类中正确列出
- [ ] `pnpm run typecheck` 通过

---

## 6. 整体验收标准

Phase 2 全部完成时，需满足：

### 6.1 自动化验收

- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm run web:build` 通过
- [ ] `pnpm test --unit` 通过（如有新增单测）
- [ ] `canvas.skill_list` 返回 6+3=9 个 skills
- [ ] `canvas.skill_get("poster_craft")` 返回完整 Markdown 内容
- [ ] Canvas skill pack 中包含 skill catalog 说明

### 6.2 真实 Agent 验收（在 Desktop 环境）

**场景 1：简单海报**

用户："设计一张万圣节活动海报，主题是 Trick or Treat，时间 10 月 31 日晚 7 点，地点 XX 社区中心"

预期 Agent 行为：
1. 调用 `canvas.skill_list` 查看可用 skills
2. 调用 `canvas.skill_get("poster_craft")` 加载海报技能
3. 可能调用 `canvas.skill_get("design_brief")` 和 `canvas.skill_get("anti_ai_slop")`
4. 先写 design brief（目标：吸引家庭参加 / 受众：社区居民 / 情绪：欢乐刺激 / 视觉：橙黑配色+万圣节元素）
5. `canvas.create_frame`（1080x1920）
6. 创建背景（橙色或深色，不是紫蓝渐变）
7. 创建主标题"Trick or Treat"（大且醒目）
8. 创建副标题和活动信息
9. 创建装饰元素（南瓜、蝙蝠等，用形状或 boolean_op，不用 emoji）
10. 最终效果：构图完整、色彩符合主题、层次清晰、无 AI 俗套

**场景 2：颜色决策**

用户："设计一张科技感的产品发布会海报"

预期 Agent 行为：
1. 加载 `poster_craft` + `color`
2. 选择冷色调（蓝/青）而不是紫蓝渐变
3. 克制的配色（主色+点缀色，不过度饱和）

### 6.3 质量标准

完成的海报应该：
- ✅ 有明确的视觉焦点（不混乱）
- ✅ 色彩符合主题情绪（不千篇一律）
- ✅ 排版层次清晰（标题>副标题>正文）
- ✅ 不出现 AI 俗套（紫蓝渐变、玻璃卡片、等距卡片网格、emoji 图标）
- ✅ 构图完整（不是随机元素堆砌）

---

## 7. 实施注意事项

### 7.1 Skill 内容质量

- **保持英文**：设计术语用英文更准确，模型理解更好
- **具体到可执行**：不要泛泛而谈，要给出具体步骤和参数范围
- **负面约束明确**：禁止事项要列清楚（比 "推荐做法" 更有效）
- **示例清晰**：必要时给出好/坏示例对比

### 7.2 Token 成本控制

- Skills 内容较长（每个 2-5KB），全部加载会增加 token 消耗
- 缓解措施：
  - Agent 按需加载（不是每次都加载所有 skills）
  - catalog 提供 "when to use" 引导，帮助 Agent 选择正确的 skill
  - 后续可考虑服务端缓存和压缩

### 7.3 与现有架构的集成

- 所有新工具都通过 CapabilityGateway
- 只读工具，只需要 `read_snapshot` 或 `read_live` 权限
- Skill 内容是纯文本，不涉及数据库或外部 API
- 不需要额外 feature flag（与 Phase 3 的图像生成不同）

### 7.4 调试技巧

如果 Agent 效果不好：
1. 检查是否真的加载了对应 skill（看 turn context）
2. 检查 skill 内容是否正确注入
3. 检查 Agent 是否理解 skill 内容（观察它的 design brief 和执行步骤）
4. 必要时增强 skill 的 "Hard rules" 部分（负面约束）

---

## 8. 参考资源

### Recombyn 源文件

**Foundation Skills**：
- `reference/recombyn/skills/foundation/design_brief/`
- `reference/recombyn/skills/foundation/composition/`
- `reference/recombyn/skills/foundation/color/`
- `reference/recombyn/skills/foundation/typography/`
- `reference/recombyn/skills/foundation/anti_ai_slop/`
- `reference/recombyn/skills/foundation/polish/`

**Domain Skills**：
- `reference/recombyn/skills/domains/poster_craft/`（重点）
- `reference/recombyn/skills/domains/landing_page/`
- `reference/recombyn/skills/domains/banner_ad/`

**设计系统提示词**（了解 Recombyn 的设计流程）：
- `reference/recombyn/apps/api/seeds/design_prompt_packs/stages/decide.md`
- `reference/recombyn/apps/api/seeds/design_prompt_packs/stages/paint.md`

### Kith-space 相关文件

- `src/canvas/canvasSkills.ts` — 当前 Canvas skill pack
- `src/canvas/canvasAgentTools.ts` — 工具定义和描述
- `docs/archive/specs/2026-08-19-canvas-agent-effect-alignment.md` — 总体规格

---

## 9. 工作检查点

### Checkpoint 1：Task 2.1 完成后

- [ ] 能调用 `canvas.skill_list` 看到 9 个 skills（即使内容还是空的）
- [ ] 能调用 `canvas.skill_get("design_brief")` 返回占位内容

### Checkpoint 2：Task 2.2 完成后

- [ ] 6 个 foundation skills 内容完整
- [ ] `canvas.skill_get("design_brief")` 返回有效的设计简报模板

### Checkpoint 3：Task 2.3 完成后（Phase 2 完成）

- [ ] 9 个 skills 全部可用
- [ ] 真实 Agent 测试：万圣节海报效果符合预期

---

## 10. 后续计划

Phase 2 完成后，进入 **Phase 3：图像/视频生成接入**（5-7 天）：
- 接入火山引擎（Doubao Ark + Seedream）
- `canvas.image_generate` 工具
- `canvas.video_generate` 工具
- 图像模型和视频模型设置页

最终目标：Agent "做一张有赛博朋克城市背景的海报" → 自动生成背景图并正确放置。
