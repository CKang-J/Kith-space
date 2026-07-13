# Kith-space 品牌资产

Kith-space 的主标志采用“三层本地 Space”概念：三张错位平面分别对应 Home 与多个根植本地文件夹的 Space，前景平面形成 `K`。

用户确认的生成设计稿是品牌视觉的唯一母版。标志的几何、层间比例、透明叠色、阴影与字标不得重新绘制或按色值近似；需要新尺寸时只能从已确认的原始像素派生。

## 权威源

- `assets/brand/kith-space-design-master.png`：用户确认的完整生成设计稿原文件。
- `assets/brand/kith-space-icon-source.png`：从设计稿原始像素裁出的 558 × 558 应用图标母版；内部像素保持原稿，四角带精确 Alpha。
- `assets/brand/kith-space-lockup-source.png`：从设计稿原始像素裁出的 `Kith-space` 横向字标。

## 产品资产

- `web/public/favicon.ico`：Windows/Electron 多尺寸图标，包含 16、24、32、48、64、128 和 256 px。
- `web/public/icons/kith-space-*.png`：从 558 × 558 图标母版直接缩放生成的 RGBA PNG，尺寸为 16、24、32、48、64、128、256、512 和 1024 px。

浏览器使用 `kith-space-256.png`，ICO 作为兼容回退；Windows 打包使用 `favicon.ico`。Desktop 主窗口与托盘共用同一个图标路径：开发态读取 `web/public/favicon.ico`，打包态读取 resources 内的 `web/dist/favicon.ico`，避免 `desktop:dev` 回退到 Electron 默认任务栏图标。仓库不再保留重新描摹的 SVG，因为在缺少设计稿原始矢量文件时，任何 SVG 重绘都会改变已确认的视觉。

外轮廓按 558 px 母版上的 120 px 标准圆角裁切；其他尺寸使用等比例半径 `120 × size / 558`。Alpha 由 8 × 8 子像素覆盖率生成，圆弧边缘保留抗锯齿；半透明边缘从图形内侧取色，避免在深色背景上出现暖白描边。四角必须完全透明，四条直边中点必须完全不透明。

`web/src/brandAssets.test.ts` 固定权威设计稿、图标裁切母版、横向字标、1024 px 产品图标和 ICO 的 SHA-256，并直接解码 PNG 验证透明四角、实心边中点和抗锯齿 Alpha；有意更换品牌稿时必须同时更新相关资产与该回归契约。应用名称统一写作 `Kith-space`。
