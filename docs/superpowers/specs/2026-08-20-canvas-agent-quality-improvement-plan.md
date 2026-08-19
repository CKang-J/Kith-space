# Canvas Agent 设计质量提升方案

**日期**: 2026-08-20  
**状态**: P0 与 P2 已实现；P1（图像生成 / outline_text）仍待做  
**目标**: 让 Kith Canvas Agent 达到 Recombyn 原生 Agent 的设计能力

---

## 问题现状

用户反馈：Agent 生成的海报只会用简单矩形、圆形，毫无设计感。

**根本原因**（对比 Recombyn 后发现）：

1. **工具能力缺失** ⭐⭐⭐⭐⭐
   - Kith `create_image` 只接受现有 `assetId`
   - Recombyn 支持 `genPrompt`（生成氛围图）+ `letteringText`（艺术字）+ `removeBg`/`cutoutMode`

2. **设计决策引导缺失** ⭐⭐⭐⭐⭐
   - Recombyn System Prompt 有 800+ 字设计方法论
   - Kith 只有操作协议（坐标系、frameId 规则），设计引导 <100 字

3. **工具描述不够具体** ⭐⭐⭐⭐
   - Recombyn 每个工具有独立 `model_hint`（150-300 字 + 具体例子）
   - Kith 的描述融合在一个字符串中

4. **字体库不足** ⭐⭐⭐
   - Recombyn 有 40+ 字体（含中英文、衬线/无衬线/手写/装饰体）
   - Kith 字体库未知，需排查

---

## 三阶段修复方案

### 🔴 Phase P0: 设计引导增强（1-2 天，立即见效）

#### P0.1 — 增强 System Prompt 设计方法论

**文件**: `src/canvas/canvasSkills.ts`

在 `CANVAS_CAPABILITY_DISCOVERY` 前面添加 `CANVAS_DESIGN_PRINCIPLES`：

```typescript
export const CANVAS_DESIGN_PRINCIPLES = `
## Design Decision Framework

### Medium Selection (何时用 shape vs image)
- Simple geometry (icons, buttons, basic shapes) → create_shape + boolean_op
- Typography with catalog fonts (≥90% match) → create_text + fontFamily
- Hero lettering (calligraphy, decorative titles) → create_image with letteringText (deferred)
- Atmosphere / materials / photo-realistic elements → create_image with genPrompt (deferred)
- **Never use emoji (🏠🔍❤️🧘👋) in create_text as icons or decorations**

### Icon Construction Hierarchy (如何构建复杂图标)
1. **Primitives + boolean_op** (moon = large circle subtract small circle)
2. **create_shape with pen path** (closed path for filled silhouettes)
3. **create_svg** (only for complex single-path marks that can't be built from primitives)

Examples:
- Moon: create_shape circle (large) + create_shape circle (small) → boolean_op mode=subtract
- Magnifier: create_shape circle (lens) + create_shape rect (handle) → boolean_op mode=union
- Ring: create_shape circle (outer) + create_shape circle (inner) → boolean_op mode=subtract
- Heart: create_shape pen with path="M150,50 C125,25 75,50 150,150 C225,50 175,25 150,50 Z"

### Composition Hard Rules (量化指标)
When creating posters / banners / KV:
- hero_coverage: 60-85% of the artboard
- text_area: ≤20% of the artboard
- primary_focal: exactly 1 (one hero element)
- secondary_focal: ≤2 (optional supporting elements)
- empty_space: ≥15% (breathing room, not filled)
- cta: ≤1 (one call-to-action, or omit if none provided)

### Anti AI Slop (禁止 AI 陈词滥调)
**Never** use these unless the user explicitly requests them or the design brief justifies them:
- Purple-blue gradients (fillType=linear fill="#9333EA" fillEnd="#3B82F6")
- Glassmorphism (semi-transparent cards with blur)
- Random particle effects (decorative dots/circles)
- Emoji as icons (🏠🔍❤️) inside create_text
- Three equal-sized feature cards layout
- Excessive corner rounding (cornerRadius > width/4)
- Generic "floating 3D objects" without design rationale

### Execution Order (Brief → Paint → Review)
1. **BRIEF**: Define purpose, audience, emotion, visual_thesis, composition archetype
2. **ART DIRECTION**: Choose palette roles (primary/accent/ground), type ladder (title/support/meta)
3. **LAYOUT PLAN**: Pick one composition archetype (center_hero / bottom_weighted / rule_of_thirds / editorial / typographic)
4. **EXECUTION**: create_frame → ground (update_frame backgroundColor) → hero marks (shapes/boolean_op) → title (create_text) → support → CTA → sparse decoration
5. **OBSERVE**: Re-read canvas.scene_summary to verify placement and hierarchy
6. **REVIEW**: Check hierarchy (title > support > meta), color contrast, slop hits
7. **SUBTRACT**: Second pass removes unnecessary decoration, not adds more

### Honesty Rule
Unless the user provides them, **do not invent**:
- Logos, brand marks, QR codes
- Prices, phone numbers, review counts
- Extra slogans or marketing copy
- Product images or photos
`;
```

#### P0.2 — 重写所有工具描述，增加具体例子

**文件**: `src/canvas/canvasAgentTools.ts` → `CANVAS_TYPED_TOOL_DESCRIPTIONS`

修改 `canvas.boolean_op` 描述：

```typescript
"canvas.boolean_op": "Boolean operations on 2+ shapes — PRIMARY tool for constructing complex icons with cutouts/combines. " +
  "Prefer this over create_svg when the icon can be built from primitives. " +
  "Examples: " +
  "moon = large circle subtract small circle (mode=subtract); " +
  "magnifier = circle union rect handle (mode=union); " +
  "ring = outer circle subtract inner circle (mode=subtract); " +
  "heart = two circles + triangle boolean union. " +
  "Args: nodeIds (2+ from SCENE), mode=union|subtract|intersect|exclude, confirmDestructive=true. " +
  "Operands are replaced. 布尔运算/挖空/合并/构建复杂图标",
```

修改 `canvas.create_shape` 描述（增加 icon 构建引导）：

```typescript
"canvas.create_shape": "Add a shape. Args: shapeType|type = rect|ellipse|circle|line|arrow|triangle|polygon|star|path|pen|pencil, x,y,width,height, fill, stroke, borderWidth. " +
  "**Icon construction**: Prefer simple primitives (circle/rect/polygon) + boolean_op for complex icons. " +
  "Example: moon = circle + circle → boolean_op subtract; magnifier = circle + rect → boolean_op union. " +
  "Only use create_svg for complex single-path marks that can't be built from 2-4 primitives. " +
  "**Never use emoji (🏠🔍❤️) in create_text as icons**. " +
  // ... rest of description
```

#### P0.3 — 更新 `poster_craft.md` 增加 Bad/Good 案例

**文件**: `src/canvas/skills/domains/poster_craft.md`

在 "2. Art direction" 后面增加：

```markdown
### Visual thesis examples

❌ **Bad** (抽象、无法执行):
- "仙侠高级感"
- "现代简约风格"
- "科技未来感"

✅ **Good** (具体、可执行):
- Halloween poster: "Cut-paper orange (#FF6B35) and cream (#FFF4E6) on charcoal (#1A1A1A); one pumpkin mark built from ellipses + boolean_op; carnival atmosphere, not a SaaS nebula"
- Concert KV: "把这把剑当作博物馆神兵：冷银 (#C0C0C0)、旧玉 (#D4E2D4)、暗金浮雕 (#8B7355)；克制东方神性，不是游戏装备海报"
- Tech event: "Neon cyan (#00D9FF) monoline paths on near-black (#0A0F1C); brutalist grid, not gradient wash"

### Icon construction examples

When the design needs decorative marks or hero elements:

✅ **Use boolean_op**:
- Moon: `create_shape circle (200×200)` + `create_shape circle (160×160 offset)` → `boolean_op mode=subtract`
- Star burst: `create_shape star sides=8` + `create_shape circle` → `boolean_op mode=subtract`
- Ring badge: `create_shape circle (outer)` + `create_shape circle (inner)` → `boolean_op mode=subtract`

❌ **Don't use emoji**:
- ~~`create_text text="🎃" fontSize=120`~~ → Use boolean_op to build a pumpkin from shapes
- ~~`create_text text="🌙" fontSize=80`~~ → Use circle subtract circle for a crescent moon

✅ **Use pen path for organic shapes**:
- Heart: `create_shape shapeType=pen path="M150,50 C125,25 75,50 150,150 C225,50 175,25 150,50 Z" closed=true fill="#FF0000"`
```

---

### 🟡 Phase P1: 工具能力扩展（3-5 天）

#### P1.1 — 实现 `create_image(genPrompt)` 图像生成支持

**优先级**: ⭐⭐⭐⭐⭐（这是与 Recombyn 最大的功能差距）

**涉及文件**:
- `src/canvas/canvasAgentTools.ts` — schema 增加 `genPrompt`/`letteringText`/`removeBg`/`cutoutMode`
- `src/canvas/canvasGatewayTools.ts` — 处理生成 job 入队
- 后端增加图像生成队列（需要接入 Stability AI / Midjourney / DALL·E 3）

**新 Schema**:

```typescript
export const CanvasCreateImageCommandSchema = z.object({
  ...WriteLocator,
  // 现有
  assetId: Id.optional(), // P1: 改为 optional
  
  // 新增
  genPrompt: z.string().min(10).max(2000).optional(),
  letteringText: z.string().max(200).optional(), // 图中的可见文字（用于后续 replaceText）
  removeBg: z.boolean().optional(), // 自动抠图
  cutoutMode: z.enum(["product", "hair"]).optional(), // 抠图模式
  
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

**工具描述更新**:

```typescript
"canvas.create_image": "Create an image node. " +
  "Args: assetId (existing Canvas asset) OR genPrompt (AI image generation, queued job). " +
  "Optional: letteringText (visible text in the image, helps later replaceText), " +
  "removeBg=true (auto-cutout), cutoutMode=product|hair (cutout algorithm). " +
  "Atmosphere/poster heroes: genPrompt must be SCENE ONLY — no baked titles/dates/logos; put copy in create_text. " +
  "Finished poster refs with baked text: use genPrompt for clean bg, not full-bleed with text. " +
  "Lettering: use create_text+fontFamily only if Available fonts match ≥90%; " +
  "otherwise genPrompt + letteringText for hero/main title calligraphy. " +
  "图片/assetId 或 genPrompt/可选抠图",
```

#### P1.2 — 实现 `outline_text` 工具（文字转路径）

**优先级**: ⭐⭐⭐（用于文字挖空效果、描边样式）

**功能**: 将 `create_text` 节点转为可编辑路径，然后可以：
- 用 `boolean_op` 做文字挖空效果
- 用 `update_node stroke` 做描边文字（无填充）
- 用 `update_node` 做路径变形

**Schema**:

```typescript
export const CanvasOutlineTextCommandSchema = z.object({
  ...WriteLocator,
  nodeId: Id.optional(),
  id: Id.optional(),
  nodeIds: z.array(Id).min(1).max(20).optional(),
}).strict().refine(
  (data) => data.nodeId || data.id || data.nodeIds,
  { message: "Either nodeId/id or nodeIds is required" }
);
```

---

### 🟢 Phase P2: 字体库扩展（1-2 天）

#### P2.1 — 移植 Recombyn 字体库

**目标**: 从 Recombyn `fonts_seed.json` 移植所有 40+ 字体到 Kith

**字体分类**（Recombyn 有，需要全部移植）:

1. **中文无衬线** (5 families)
   - Alibaba PuHuiTi (阿里巴巴普惠体) — 3 weights
   - Noto Sans SC — 4 weights
   - ZCOOL XiaoWei (站酷小薇)
   - ZCOOL KuaiLe (站酷快乐体)
   - ZCOOL QingKe HuangYou (站酷庆科黄油体)

2. **中文衬线/书法** (5 families)
   - Noto Serif SC — 3 weights
   - LXGW WenKai (霞鹜文楷) — 3 weights
   - Ma Shan Zheng (马善政楷书)
   - Zhi Mang Xing (志莽行书)
   - Long Cang (龙藏体)
   - Liu Jian Mao Cao (刘建毛草)

3. **英文无衬线** (15 families)
   - Inter, Roboto, Open Sans, Source Sans 3, DM Sans
   - Montserrat, Poppins, Lato, Nunito, Raleway
   - Oswald, Work Sans, Manrope, Rubik, Cabin
   - Noto Sans, IBM Plex Sans, Space Grotesk

4. **英文衬线** (5 families)
   - Playfair Display, Merriweather, Libre Baskerville
   - Cormorant Garamond, Source Serif 4, Noto Serif

5. **装饰/手写** (5 families)
   - Bebas Neue (压缩体)
   - Lobster, Pacifico, Dancing Script, Great Vibes, Caveat (手写/脚本体)

6. **等宽/像素** (5 families)
   - Press Start 2P (像素字体)
   - JetBrains Mono, Fira Code, Source Code Pro, IBM Plex Mono (代码字体)

**实现步骤**:

1. 查找 Kith 当前字体定义位置
2. 创建 `src/canvas/fonts/fontsCatalog.ts` 或类似文件
3. 从 Recombyn `fonts_seed.json` 复制 JSON 数据
4. 确保 Canvas 前端加载这些字体（CSS `@font-face` 或动态加载）
5. 更新 `canvas.scene_summary` 的 `AVAILABLE_FONTS` 输出

---

## 优先级总结

| Phase | 任务 | 工作量 | 影响 | 优先级 |
|-------|------|--------|------|--------|
| P0.1 | 增强 System Prompt 设计方法论 | 2h | ⭐⭐⭐⭐⭐ | 🔴 立即 |
| P0.2 | 重写工具描述增加例子 | 3h | ⭐⭐⭐⭐ | 🔴 立即 |
| P0.3 | 更新 poster_craft.md 案例 | 2h | ⭐⭐⭐⭐ | 🔴 立即 |
| P1.1 | create_image(genPrompt) 图像生成 | 3-5天 | ⭐⭐⭐⭐⭐ | 🟡 本周 |
| P1.2 | outline_text 文字转路径 | 1-2天 | ⭐⭐⭐ | 🟡 本周 |
| P2.1 | 移植 Recombyn 字体库 (40+ fonts) | 1-2天 | ⭐⭐⭐ | 🟢 下周 |

---

## 验收标准

### P0 完成后（设计引导增强）

用户说：**"设计一张万圣节活动海报"**

Agent 应该：
1. ✅ 加载 `poster_craft` + `design_brief` skills
2. ✅ 生成结构化 design brief (purpose/audience/emotion/visual_thesis)
3. ✅ **主动用 boolean_op 构建南瓜图标**（circle + circle subtract），而不是堆简单矩形
4. ✅ 橙黑配色（#FF6B35 + #1A1A1A）
5. ✅ 层次清晰（title 72-96px，date 16-20px）
6. ✅ 不出现 AI 俗套（紫蓝渐变、玻璃卡片、emoji 图标）

### P1 完成后（图像生成能力）

用户说：**"设计一张科幻电影海报，背景要有星空和太空站"**

Agent 应该：
1. ✅ 调用 `canvas.create_image({ genPrompt: "Deep space nebula with orbital station...", ... })`
2. ✅ 生成氛围图作为背景
3. ✅ 在图像上叠加 create_text 标题（不是把文字烤进图里）

### P2 完成后（字体库扩展）

用户说：**"把标题改成书法字体"**

Agent 应该：
1. ✅ 从 AVAILABLE_FONTS 中选择 "Zhi Mang Xing" 或 "Ma Shan Zheng"
2. ✅ 调用 `canvas.update_node({ nodeId: "title-id", fontFamily: "Zhi Mang Xing" })`
3. ✅ 不再只能用 "Alibaba PuHuiTi" 或 "Inter"

---

## 参考资源

- Recombyn 工具定义: `reference/recombyn/apps/api/seeds/canvas_actions_seed.json`
- Recombyn System Prompt: `reference/recombyn/apps/api/seeds/design_prompt_packs/stages/paint.md`
- Recombyn Skills: `reference/recombyn/skills/domains/poster_craft/SKILL.md`
- Recombyn 字体库: `reference/recombyn/apps/api/seeds/fonts_seed.json`
- Kith 工具定义: `src/canvas/canvasAgentTools.ts`
- Kith System Prompt: `src/canvas/canvasSkills.ts`
- Kith Skills: `src/canvas/skills/domains/poster_craft.md`

---

**下一步**: 
1. ~~@Cursor 执行 P0.1-P0.3（设计引导增强）~~ 已落地
2. ~~@Cursor 执行 P2.1（字体库移植）~~ 已落地（46 families，jsDelivr CDN）
3. 主工程师评估 P1.1 (图像生成) 架构设计
4. 真实 Desktop “万圣节海报” Agent smoke 仍待本机验收
