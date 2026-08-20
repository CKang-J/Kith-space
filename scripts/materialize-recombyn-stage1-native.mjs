import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const upstreamRoot = path.join(repoRoot, "reference/recombyn");
const outputRoot = path.join(repoRoot, "web/src/features/canvas/upstream");
const auditPath = path.join(repoRoot, "docs/research/recombyn-stage1-upstream-closure-audit.json");
const expectedCommit = "abd81983716b41c7fc6e2f591c23e6d9bb9c4643";

execFileSync("git", ["-C", upstreamRoot, "cat-file", "-e", `${expectedCommit}^{commit}`]);
if (!existsSync(auditPath)) throw new Error(`Run the closure audit first: ${auditPath}`);
const audit = JSON.parse(readFileSync(auditPath, "utf8"));
if (audit.upstreamCommit !== expectedCommit || !audit.entries.some((entry) => entry.entry === "apps/web/src/pages/EditorPage.tsx")) {
  throw new Error("Closure audit does not describe the native EditorPage entry");
}

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"]);
const repositoryWhitespaceNormalizedSources = new Set([
  "apps/web/src/components/base/checkbox/Checkbox.tsx",
  "apps/web/src/components/base/checkbox/CheckboxGroup.tsx",
  "apps/web/src/components/base/checkbox/CheckboxGroupContext.tsx",
  "apps/web/src/components/base/colorPicker/AlphaSlider.tsx",
  "apps/web/src/components/base/colorPicker/HueSlider.tsx",
  "apps/web/src/components/base/colorPicker/SaturationValueArea.tsx",
  "apps/web/src/components/base/select/index.tsx",
  "apps/web/src/components/base/tooltip/TooltipManager.ts",
  "apps/web/src/components/editor/panels/AgentComposerInput.tsx",
  "apps/web/src/components/editor/useProjectCloudSync.ts",
  "apps/web/src/components/rcb/core/spatialIndex.ts",
  "apps/web/src/components/rcb/selection/SelectionFeature.tsx",
  "apps/web/src/components/rcb/tools/pencilBrushes.ts",
]);
const mapping = [];

function replaceRequired(source, search, replacement, label) {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`Stage 1 transform did not match: ${label}`);
  return next;
}

function readPinnedSource(file) {
  return execFileSync("git", ["-C", upstreamRoot, "show", `${expectedCommit}:${file}`], {
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
}

rmSync(outputRoot, { recursive: true, force: true });
for (const item of audit.combinedFiles) {
  const target = path.join(outputRoot, item.path);
  const sourceBytes = readPinnedSource(item.path);
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceHash !== item.sha256) throw new Error(`Source changed since audit: ${item.path}`);
  if (/apps\/web\/src\/assets\/model\/(dreamina|sync_lipsync)\.png$/.test(item.path)) {
    mapping.push({
      source: item.path,
      sourceSha256: item.sha256,
      target: null,
      disposition: "excluded_unverified_brand_asset",
      changes: ["not copied; license/brand provenance was not established"],
    });
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const extension = path.extname(item.path);
  const changes = [];
  if (sourceExtensions.has(extension)) {
    changes.push("prepend fixed source/Apache modification notice", "rewrite repository-local import aliases", "add host-project typecheck boundary");
    const notice = `/*\n * Modified by Kith-space for the Stage 1 native Canvas island.\n * Source: Recombyn ${expectedCommit} / ${item.path}\n * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.\n * Apache-2.0 and upstream NOTICE apply.\n */\n// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.\n`;
    let rewritten = sourceBytes
      .toString("utf8")
      .replaceAll("from '@/", "from '@recombyn-native/")
      .replaceAll('from "@/', 'from "@recombyn-native/')
      .replaceAll("import('@/", "import('@recombyn-native/")
      .replaceAll('import("@/', 'import("@recombyn-native/')
      .replaceAll("from '@canvas-plugins/", "from '@recombyn-canvas-plugins/")
      .replaceAll('from "@canvas-plugins/', 'from "@recombyn-canvas-plugins/')
      .replaceAll("import('@canvas-plugins/", "import('@recombyn-canvas-plugins/")
      .replaceAll('import("@canvas-plugins/', 'import("@recombyn-canvas-plugins/')
      .replaceAll("from '@recombyn-native/service/design'", "from '@/features/canvas/adapters/recombynStageOneDesign'")
      .replaceAll("from '@floating-ui/react'", "from '@/features/canvas/adapters/recombynFloatingUi'")
      .replaceAll("from 'react-dom'", "from '@/features/canvas/adapters/recombynReactDom'")
      .replace(/import\(['"]@tauri-apps\/[^'"]+['"]\)/g, "import('@/features/canvas/adapters/recombynUnavailablePlatform')");
    if (sourceBytes.includes("import('@tauri-apps/") || sourceBytes.includes('import("@tauri-apps/')) {
      changes.push("route Tauri dynamic imports through the Stage 1 unavailable adapter");
    }
    if (sourceBytes.includes("from '@floating-ui/react'")) {
      changes.push("route Floating UI portals through the Stage 1 island portal adapter");
    }
    if (sourceBytes.includes("from '@/service/design'")) {
      changes.push("route Recombyn design runtime through the Stage 1 unavailable adapter");
    }
    if (sourceBytes.includes("from 'react-dom'")) {
      changes.push("route body-targeted React portals through the Stage 1 island portal adapter");
    }
    if (sourceBytes.includes("window.document.body.style")) {
      changes.push("scope transient resize cursor/user-select state to the Stage 1 island root");
      rewritten = `import { getRecombynIslandRoot } from '@/features/canvas/adapters/recombynFloatingUi';\n${rewritten.replaceAll("window.document.body.style", "getRecombynIslandRoot().style")}`;
    }
    if (item.path.endsWith("/components/editor/panels/agent/flyToChat.tsx")) {
      changes.push("mount selection-to-chat transition chrome inside the Stage 1 island root");
      changes.push("land fly chips on the Kith left Chat composer instead of Recombyn's right AgentDock");
      rewritten = `import { getRecombynPortalRoot } from '@/features/canvas/adapters/recombynFloatingUi';\n${rewritten.replace("document.body.appendChild(el);", "getRecombynPortalRoot().appendChild(el);")}`;
      rewritten = replaceRequired(
        rewritten,
        `  if (agentLand) return agentLand;

  const dock =`,
        `  if (agentLand) return agentLand;

  const kithChatLand = pointFromEl(
    (landId
      ? (globalThis.document.querySelector(
          \`[data-fly-land="\${landId.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"')}"]\`
        ) as HTMLElement | null)
      : null) ||
      (globalThis.document.querySelector('[data-fly-land^="kith-chat:"]') as HTMLElement | null)
  );
  if (kithChatLand) return kithChatLand;

  const dock =`,
        "flyToChat prefer Kith Chat composer",
      );
      rewritten = replaceRequired(
        rewritten,
        `  return {
    x: Math.max(120, window.innerWidth - 220),
    y: Math.max(120, window.innerHeight * 0.62),
  };`,
        `  return {
    x: Math.min(180, Math.max(48, window.innerWidth * 0.16)),
    y: Math.max(120, window.innerHeight * 0.72),
  };`,
        "flyToChat left-side fallback",
      );
    }
    if (item.path.endsWith("/components/base/colorPanel/pickScreenColor.ts")) {
      changes.push("mount the screen-color overlay inside the Stage 1 island portal root");
      rewritten = `import { getRecombynPortalRoot } from '@/features/canvas/adapters/recombynFloatingUi';\n${rewritten.replace("document.body.appendChild(overlay);", "getRecombynPortalRoot().appendChild(overlay);")}`;
    }
    if (item.path.endsWith("/components/rcb/selection/shapeBoolean.ts")) {
      changes.push("normalize polygon-clipping CommonJS interop for Vite");
      rewritten = rewritten.replace(
        "import {\n  difference,\n  intersection,\n  union,\n  xor,",
        "import polygonClipping, {",
      ).replace("} from 'polygon-clipping';", "} from 'polygon-clipping';\nconst { difference, intersection, union, xor } = polygonClipping;");
    }
    if (item.path.endsWith("/components/editor/panels/agent/ModelPickerPanel.tsx")) {
      changes.push("replace unverified model-brand bitmaps and package SVG marks with neutral host fallback");
      rewritten = rewritten
        .replace("import syncLipsync from '@recombyn-native/assets/model/sync_lipsync.png';", "import { neutralModelAsset as syncLipsync } from '@/features/canvas/adapters/recombynBrandAssets';")
        .replace("import dreamina from '@recombyn-native/assets/model/dreamina.png';", "const dreamina = syncLipsync;")
        .replace(/import (\w+) from '@lobehub\/icons-static-svg\/icons\/[^']+';/g, "const $1 = syncLipsync;");
    }
    if (item.path.endsWith("/components/editor/panels/ExportSelectionPanel.tsx")) {
      changes.push("disable Stage 1 export side-effect menu items while retaining native menu UI");
      rewritten = rewritten.replaceAll('role="menuitem"\n                onClick', 'role="menuitem"\n                disabled\n                onClick');
    }
    if (item.path.endsWith("/pages/EditorPage.tsx")) {
      changes.push("remove the Stage 1 AgentDock composition and route selection-to-chat through the host seam");
      rewritten = replaceRequired(
        rewritten,
        /import \{\n  peekHomeAgentBoot,[\s\S]*?\} from '@recombyn-native\/utils\/homeAgentBoot';\n/,
        "",
        "EditorPage home-agent boot import",
      );
      for (const importLine of [
        "import { withReturnTo } from '@recombyn-native/utils/authReturnTo';\n",
        "import type { ComposerContext } from '@recombyn-native/components/editor/panels/AgentComposerInput';\n",
        "import AgentDock from '@recombyn-native/components/editor/panels/AgentDock';\n",
        "import type { ComposerInteractionMode } from '@recombyn-native/components/editor/panels/agent/AgentComposerShell';\n",
      ]) {
        rewritten = replaceRequired(rewritten, importLine, "", `EditorPage removed import ${importLine.trim()}`);
      }
      rewritten = replaceRequired(
        rewritten,
        "import { useProjectCloudSync, flushCurrentProjectNow, ProjectRevisionConflictDialog } from '@recombyn-native/components/editor/useProjectCloudSync';",
        "import { useProjectCloudSync, ProjectRevisionConflictDialog } from '@recombyn-native/components/editor/useProjectCloudSync';",
        "EditorPage flush import",
      );
      rewritten = replaceRequired(
        rewritten,
        "  rcbViewportSceneBounds,\n",
        "",
        "EditorPage AgentDock viewport helper import",
      );
      rewritten = `import { requestCanvasSelectionToChat } from '@/features/canvas/adapters/recombynSelectionToChat';\n${rewritten}`;
      rewritten = replaceRequired(
        rewritten,
        /function resolveHomeAgentInteractionMode\([\s\S]*?\n}\n\nfunction computeStageBackground/,
        "function computeStageBackground",
        "EditorPage home-agent boot helpers",
      );
      rewritten = replaceRequired(
        rewritten,
        /\/\*\* Stable identity[\s\S]*?const MOBILE_AGENT_INTERACTION_MODES[^\n]*\n\n/,
        "",
        "EditorPage mobile AgentDock modes",
      );
      rewritten = rewritten
        .replace("   * auto-adjust again (no post-reveal re-fit when AgentDock width settles).", "   * auto-adjust again after the native canvas stage settles.")
        .replace("      // Wait until stage size stops changing (AgentDock flex) while boot still covers.", "      // Wait until the native stage size stops changing while boot still covers.");
      rewritten = replaceRequired(
        rewritten,
        /  const \[agentOpen, setAgentOpen\][\s\S]*?  const \[attachToChat, setAttachToChat\][^\n]*\n/,
        "  const [inspectOpen, setInspectOpen] = useState(false);\n  const [shareOpen, setShareOpen] = useState(false);\n",
        "EditorPage AgentDock state",
      );
      for (const stateLine of [
        "  const [tourActive, setTourActive] = useState(false);\n",
        "  /** Apply sessionStorage home boot at most once per EditorPage lifetime. */\n  const homeAgentBootAppliedRef = useRef(false);\n",
        "  const authUserId = useSelector((s: any) => s.auth?.user?.id as string | undefined);\n",
      ]) {
        rewritten = replaceRequired(rewritten, stateLine, "", `EditorPage removed state ${stateLine.trim()}`);
      }
      rewritten = replaceRequired(
        rewritten,
        /  \/\*\* Home agent \/ plaza[\s\S]*?\n  }, \[location\.search, location\.pathname, navigate\]\);\n\n/,
        "",
        "EditorPage home-agent boot effect",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const openAgentPanel[\s\S]*?\n  const goHomeFromEditor/,
        "  const goHomeFromEditor",
        "EditorPage AgentDock callbacks",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const agentOpenNonce[\s\S]*?\n  const openShareDialog/,
        "  const openShareDialog",
        "EditorPage AgentDock store signal and toggles",
      );
      rewritten = replaceRequired(
        rewritten,
        /      if \(e\.key\.toLowerCase\(\) === 'c'[\s\S]*?      }\n      if \(e\.key === 'Escape'\) \{\n        setAgentOpen\(false\);/,
        "      if (e.key === 'Escape') {",
        "EditorPage AgentDock shortcut",
      );
      rewritten = replaceRequired(
        rewritten,
        "  }, [workspaceMode, toggleAgentPanel]);",
        "  }, []);",
        "EditorPage shortcut dependencies",
      );
      rewritten = replaceRequired(
        rewritten,
        /\n  useEffect\(\(\) => \{\n    if \(!isMobileViewport\) return;\n    if \(agentOpen\)[\s\S]*?\n  }, \[agentOpen, isMobileViewport\]\);\n/,
        "",
        "EditorPage mobile AgentDock effect",
      );
      rewritten = replaceRequired(rewritten, "              agentOpen={agentOpen}\n", "", "EditorTopChrome agentOpen prop");
      rewritten = replaceRequired(rewritten, "              onOpenAgent={openAgentPanel}\n", "", "EditorTopChrome Agent button callback");
      rewritten = replaceRequired(
        rewritten,
        /              onOpenAgent=\{\(opts\) => \{[\s\S]*?              }}\n              onAddToChat=\{\(target\) => \{[\s\S]*?              }}\n/,
        "              onAddToChat={requestCanvasSelectionToChat}\n",
        "EditorStageWorld selection-to-chat seam",
      );
      rewritten = replaceRequired(
        rewritten,
        /          \{workspaceMode === 'dev' \? \([\s\S]*?\n          \)}\n        <\/div>/,
        "          {workspaceMode === 'dev' && inspectOpen ? (\n            <DevPropertiesPanel onClose={() => setInspectOpen(false)} />\n          ) : null}\n        </div>",
        "EditorPage AgentDock render",
      );
      rewritten = replaceRequired(
        rewritten,
        /\n        \{isMobileViewport && agentOpen \? \([\s\S]*?\n        \) : null}\n/,
        "",
        "EditorPage mobile AgentDock backdrop",
      );
      rewritten = replaceRequired(rewritten, "            onOpenAgent={openAgentForTour}\n", "", "Editor tour Agent callback");
      rewritten = replaceRequired(rewritten, "            onActiveChange={setTourActive}\n", "", "Editor tour Agent hold callback");
    }
    if (item.path.endsWith("/components/editor/page/EditorTopChrome.tsx")) {
      changes.push("remove the AgentDock open button from native top chrome");
      rewritten = replaceRequired(rewritten, "import { TbMessage2Filled } from 'react-icons/tb';\n", "", "EditorTopChrome chat icon import");
      rewritten = replaceRequired(rewritten, "  agentOpen: boolean;\n", "", "EditorTopChrome agentOpen prop");
      rewritten = replaceRequired(rewritten, "  onOpenAgent: () => void;\n", "", "EditorTopChrome onOpenAgent prop");
      rewritten = replaceRequired(rewritten, "  agentOpen,\n", "", "EditorTopChrome agentOpen destructure");
      rewritten = replaceRequired(rewritten, "  onOpenAgent,\n", "", "EditorTopChrome onOpenAgent destructure");
      rewritten = replaceRequired(
        rewritten,
        /          \{!agentOpen \? \([\s\S]*?\n          \) : null}\n/,
        "",
        "EditorTopChrome AgentDock button",
      );
    }
    if (item.path.endsWith("/components/editor/chrome/EditorOnboardingTour.tsx")) {
      changes.push("remove AgentDock-only onboarding steps and callback");
      rewritten = replaceRequired(rewritten, "export type TourStepId = 'welcome' | 'tools' | 'agent' | 'image' | 'done';", "export type TourStepId = 'welcome' | 'tools' | 'done';", "Editor tour step type");
      rewritten = replaceRequired(rewritten, "  /** Open Agent dock when entering this step. */\n  openAgent?: boolean;\n", "", "Editor tour Agent field");
      rewritten = replaceRequired(
        rewritten,
        /  \{\n    id: 'agent',[\s\S]*?\n  },\n  \{\n    id: 'image',[\s\S]*?\n  },\n/,
        "",
        "Editor tour Agent steps",
      );
      rewritten = replaceRequired(rewritten, "  onOpenAgent: () => void;\n", "", "Editor tour Agent prop");
      rewritten = replaceRequired(rewritten, "  onOpenAgent,\n", "", "Editor tour Agent destructure");
      rewritten = replaceRequired(rewritten, "  const onOpenAgentRef = useRef(onOpenAgent);\n  onOpenAgentRef.current = onOpenAgent;\n", "", "Editor tour Agent ref");
      rewritten = replaceRequired(
        rewritten,
        /\n  \/\/ Open Agent only when entering a step that needs it[\s\S]*?\n  }, \[active, step\.id, step\.openAgent\]\);\n/,
        "",
        "Editor tour Agent effect",
      );
    }
    if (item.path.endsWith("/components/editor/chrome/EditorToolStrip.tsx")) {
      changes.push("disable Stage 1 upload side effects and expose adjacent native image/video generator buttons");
      rewritten = rewritten
        .replace("  LuType,\n} from 'react-icons/lu';", "  LuType,\n  LuVideo,\n} from 'react-icons/lu';")
        .replace("tip={L.uploadMedia}\n        active={imageActive}\n        disabled={toolsLocked}", "tip={L.uploadMedia}\n        active={imageActive}\n        disabled")
        .replace(
          "{/* 图像生成器 — places a generator node at viewport center.\n          Video / Lottie / Audio generators: context menu 「生成器」 only. */}",
          "{/* 图片/视频生成器 — adjacent native controls; A / Shift+A. */}",
        )
        .replace(
          "      </ToolBtn>\n\n      {pluginButtons.map",
          "      </ToolBtn>\n\n      <ToolBtn\n        tip={`${L.videoGenerator} (Shift+A)`}\n        disabled={toolsLocked}\n        onClick={spawnVideoGeneratorAtView}\n      >\n        <ToolIcon>\n          <LuVideo className={TOOL_ICON_CLASS} strokeWidth={STROKE} />\n        </ToolIcon>\n      </ToolBtn>\n\n      {pluginButtons.map",
        )
        .replace("tip={L.imageGenerator}\n        disabled={toolsLocked}", "tip={`${L.imageGenerator} (A)`}\n        disabled={toolsLocked}");
    }
    if (item.path.endsWith("/components/editor/panels/AgentComposerInput.tsx")) {
      changes.push("route pure scene-context and local-media helpers through narrow Stage 1 adapters");
      rewritten = replaceRequired(
        rewritten,
        "} from '@recombyn-native/components/editor/panels/agent/runDesignAgent';",
        "} from '@/features/canvas/adapters/recombynComposerSceneContext';",
        "AgentComposerInput scene-context adapter",
      );
      rewritten = replaceRequired(
        rewritten,
        "import { imageSrcToFile } from '@recombyn-native/utils/uploadImage';",
        "import { imageSrcToFile } from '@/features/canvas/adapters/recombynLocalMedia';",
        "AgentComposerInput local media adapter",
      );
      rewritten = rewritten.replace(
        "/** Object storage key from POST /api/v1/uploads — used to delete on remove. */",
        "/** Legacy attachment identity retained for native chip compatibility; Stage 1 never uploads. */",
      );
    }
    if (item.path.endsWith("/utils/uploadImage.ts")) {
      changes.push("replace Recombyn upload transport with a local-only data/blob media boundary");
      rewritten = `type LocalMediaItem = {
  url: string;
  key?: string;
  name?: string;
  mime?: string;
  width?: number;
  height?: number;
};

const nodeUploadAborts = new Map<string, AbortController>();

export function beginNodeUpload(nodeId: string): AbortSignal {
  const id = String(nodeId || '').trim();
  if (!id) return new AbortController().signal;
  abortNodeUpload(id);
  const controller = new AbortController();
  nodeUploadAborts.set(id, controller);
  return controller.signal;
}

export function abortNodeUpload(nodeId: string | null | undefined): void {
  const id = String(nodeId || '').trim();
  const controller = id ? nodeUploadAborts.get(id) : undefined;
  if (!controller) return;
  nodeUploadAborts.delete(id);
  controller.abort();
}

export function finishNodeUpload(nodeId: string | null | undefined): void {
  nodeUploadAborts.delete(String(nodeId || '').trim());
}

export function isUploadAbortError(error: unknown): boolean {
  const value = error as { name?: string; code?: string; message?: string } | null;
  return Boolean(value && (value.name === 'AbortError' || value.code === 'ERR_CANCELED' || /abort|cancel/i.test(String(value.message || ''))));
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      if (result) resolve(result);
      else reject(new Error('empty file preview'));
    };
    reader.onerror = () => reject(new Error('failed to read local media'));
    reader.readAsDataURL(file);
  });
}

export async function uploadImageFile(file: File, opts?: { signal?: AbortSignal }): Promise<LocalMediaItem> {
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const url = await readFileAsDataUrl(file);
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return { url, name: file.name, mime: file.type };
}

export async function deleteUploadedFile(_key: string | null | undefined): Promise<void> {}

export async function uploadComposerAttachment(file: File, opts?: { previewDataUrl?: string }): Promise<{
  uploadKey: string;
  url: string;
  imageRef: string;
  previewDataUrl: string;
  name: string;
}> {
  const previewDataUrl = String(opts?.previewDataUrl || '').trim() || await readFileAsDataUrl(file);
  return { uploadKey: '', url: previewDataUrl, imageRef: previewDataUrl, previewDataUrl, name: file.name || 'media' };
}

export function waitForImageReady(src: string, opts?: { signal?: AbortSignal }): Promise<boolean> {
  if (opts?.signal?.aborted) return Promise.resolve(false);
  return Promise.resolve(/^data:|^blob:/.test(String(src || '').trim()));
}

export function isOurStoredImageUrl(_src: string): boolean { return false; }
export function toDisplayMediaUrl(src: string, _uploadKey?: string | null): string { return String(src || '').trim(); }
export function resolveUploadObjectKey(_src: string): string | null { return null; }

export async function imageSrcToFile(src: string, filename = 'image.png', opts?: { fallbackMime?: string }): Promise<File> {
  const value = String(src || '').trim();
  if (!/^data:|^blob:/.test(value)) throw new Error('Stage 1 accepts local media references only');
  const response = await fetch(value);
  if (!response.ok) throw new Error('failed to read local media');
  const blob = await response.blob();
  const mime = blob.type || opts?.fallbackMime || 'application/octet-stream';
  return new File([blob], filename, { type: mime });
}

export async function uploadImageFromSrc(src: string, filename = 'processed.png', opts?: { signal?: AbortSignal }): Promise<LocalMediaItem> {
  const file = await imageSrcToFile(src, filename);
  return uploadImageFile(file, { signal: opts?.signal });
}
`;
    }
    if (item.path.endsWith("/service/chat.ts")) {
      changes.push("make image/video job clients explicit unavailable while retaining shared media types");
      rewritten = replaceRequired(
        rewritten,
        "import { request } from '@recombyn-native/utils/request';\n",
        "",
        "service/chat removed request transport",
      );
      rewritten = replaceRequired(
        rewritten,
        /\/\*\* POST \/api\/v1\/chat\/image\/jobs[\s\S]*?\n}\n\nexport type GenerateVideoInput/,
        `/** Stage 1 keeps the native type boundary but never calls the Recombyn image job service. */
export async function generateImage(
  _data: GenerateImageInput,
  _opts?: { signal?: AbortSignal },
): Promise<GenerateImageResult> {
  throw new Error('Kith Media Job 尚未实现，Stage 1 暂不支持图片生成');
}

export type GenerateVideoInput`,
        "service/chat image job client",
      );
      rewritten = replaceRequired(
        rewritten,
        /\/\*\* POST \/api\/v1\/chat\/video\/jobs[\s\S]*?\n}\n\nexport type GenerateAudioInput/,
        `/** Stage 1 keeps the native type boundary but never calls the Recombyn video job service. */
export async function generateVideo(
  _data: GenerateVideoInput,
  _opts?: { signal?: AbortSignal },
): Promise<GenerateVideoResult> {
  throw new Error('Kith Media Job 尚未实现，Stage 1 暂不支持视频生成');
}

export type GenerateAudioInput`,
        "service/chat video job client",
      );
      rewritten = replaceRequired(
        rewritten,
        /\/\*\* POST \/api\/v1\/chat\/audio\/jobs[\s\S]*?\n}\n/,
        `/** Stage 1 keeps the native type boundary but never calls the Recombyn audio job service. */
export async function generateAudio(
  _data: GenerateAudioInput,
  _opts?: { signal?: AbortSignal },
): Promise<GenerateAudioResult> {
  throw new Error('Kith Media Job 尚未实现，Stage 1 暂不支持音频生成');
}
`,
        "service/chat audio job client",
      );
      rewritten = replaceRequired(
        rewritten,
        /type MediaJobCreate[\s\S]*?\n}\n\n\/\*\* Stage 1 keeps the native type boundary but never calls the Recombyn image job service\. \*\//,
        "/** Stage 1 keeps the native type boundary but never calls the Recombyn image job service. */",
        "service/chat media polling transport",
      );
    }
    if (item.path.endsWith("/components/editor/nodes/ImageNode/ImageQuickEditComposer.tsx")) {
      changes.push("route image quick-edit generate through the Kith Canvas generation job host seam");
      changes.push("apply generation resultSrc locally and always clear the generating overlay");
      changes.push("clear leftover generating overlay and surface a wait toast for slow i2i");
      rewritten = replaceRequired(rewritten, "import { useQuery } from '@tanstack/react-query';\n", "", "ImageQuickEdit query import");
      rewritten = replaceRequired(
        rewritten,
        "import { generateImage, type ChatModelsResponse, type LlmModel } from '@recombyn-native/service/chat';\n",
        "type LlmModel = { id: string; kind?: string; label?: string; [key: string]: unknown };\n",
        "ImageQuickEdit job client import",
      );
      rewritten = replaceRequired(rewritten, "import { apiQuery, getHttpErrorMessage } from '@recombyn-native/service/client';\n", "", "ImageQuickEdit API import");
      rewritten = replaceRequired(rewritten, "import { readFileAsDataUrl } from '@recombyn-native/utils/uploadImage';", "import { readFileAsDataUrl } from '@/features/canvas/adapters/recombynLocalMedia';\nimport { firstReferenceAssetId, runCanvasMediaGeneration } from '@/features/canvas/adapters/recombynGeneration';", "ImageQuickEdit local media");
      rewritten = replaceRequired(
        rewritten,
        "  const canPickModel = planAllowsModelPick(planId);",
        "  const canPickModel = true;",
        "ImageQuickEdit always allow Ark model pick",
      );
      rewritten = replaceRequired(
        rewritten,
        "import {\n  listImageVariantUrls,\n  writeImageVariantsAttr,\n} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';",
        "import {\n  listImageVariantUrls,\n  writeImageVariantsAttr,\n  clearImageProcessAttrs,\n} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';",
        "ImageQuickEdit process-attr helper",
      );
      rewritten = replaceRequired(
        rewritten,
        "  pushEditorHistory,\n  startCanvasAttachPick,",
        "  pushEditorHistory,\n  setDocumentFromCanvas,\n  startCanvasAttachPick,",
        "ImageQuickEdit restore setDocumentFromCanvas",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const modelsCatalogQuery = useQuery\([\s\S]*?\n  }, \[\n    modelsCatalogQuery\.data,[\s\S]*?\n  \]\);\n\n  useEffect\(\(\) => \{\n    return \(\) => \{\n      abortRef\.current\?\.abort\(\);\n    \};\n  }, \[\]\);/,
        "  useEffect(() => {\n    const localModels = buildImageGeneratorModelList(null);\n    setModels(localModels);\n    setModelsStatus('ready');\n    const nextId = nextQuickEditImageModelId(localModels, modelId, canPickModel);\n    if (nextId) setModelId(nextId);\n    // Stage 1 never requests the Recombyn model catalog.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  useEffect(() => () => { abortRef.current?.abort(); }, []);",
        "ImageQuickEdit local model catalog",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const onGenerate = async \(\) => \{[\s\S]*?\n  \};\n\n  const subjectChip/,
        `  const onGenerate = async () => {
    const text = prompt.trim();
    if (!text || sending || !node) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'generate',
            processLabel: t('editor.tools.imageGenerating'),
            genPrompt: text,
          },
        },
      })
    );
    try {
      const job = await runCanvasMediaGeneration({
        jobType: 'image',
        genPrompt: text,
        targetNodeId: nodeId,
        node,
        aspectRatio,
        model: modelId,
        resolution,
        referenceAssetId: firstReferenceAssetId(contextsRef.current, src)
          || (typeof node.assetId === 'string' && node.assetId.trim())
          || (typeof node.attrs?.assetId === 'string' && node.attrs.assetId.trim())
          || undefined,
        signal: ac.signal,
      });
      const doc = (store.getState() as any).editor?.document;
      if (ac.signal.aborted) {
        if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
        return;
      }
      const resultSrc = String(job?.resultSrc || '').trim();
      if (resultSrc) {
        dispatch(finishImageProcess({ nodeId, src: resultSrc, attrs: { genPrompt: text } }));
        dispatch(closeImageToolPanel());
      } else if (doc) {
        dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      }
    } catch (err: any) {
      const doc = (store.getState() as any).editor?.document;
      if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      if (ac.signal.aborted || err?.name === 'AbortError') return;
      const raw = String(err?.message || '');
      message.error(raw || t('editor.tools.imageGenFail'));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  const subjectChip`,
        "ImageQuickEdit Kith generation",
      );
      rewritten = replaceRequired(
        rewritten,
        "  useEffect(() => () => { abortRef.current?.abort(); }, []);\n",
        `  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    if (sending) return;
    if (String(node?.attrs?.processStatus) !== 'running') return;
    const timer = window.setTimeout(() => {
      if (abortRef.current) return;
      const doc = (store.getState() as any).editor?.document;
      if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [dispatch, nodeId, sending, node?.attrs?.processStatus]);

  useEffect(() => {
    if (!sending) return;
    const timer = window.setTimeout(() => {
      message.info('仍在等待方舟返回。图生图会上传原图，通常比文生图慢。');
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [sending]);
`,
        "ImageQuickEdit stale overlay and wait toast",
      );
    }
    if (item.path.endsWith("/components/editor/nodes/VideoNode/VideoQuickEditComposer.tsx")) {
      changes.push("route video quick-edit generate through the Kith Canvas generation job host seam");
      rewritten = replaceRequired(rewritten, "import { useQuery } from '@tanstack/react-query';\n", "", "VideoQuickEdit query import");
      rewritten = replaceRequired(
        rewritten,
        "import { generateVideo, type ChatModelsResponse, type LlmModel } from '@recombyn-native/service/chat';\n",
        "type LlmModel = { id: string; kind?: string; label?: string; [key: string]: unknown };\n",
        "VideoQuickEdit job client import",
      );
      rewritten = replaceRequired(rewritten, "import { apiQuery, getHttpErrorMessage } from '@recombyn-native/service/client';\n", "", "VideoQuickEdit API import");
      rewritten = replaceRequired(rewritten, "import { readFileAsDataUrl } from '@recombyn-native/utils/uploadImage';", "import { readFileAsDataUrl } from '@/features/canvas/adapters/recombynLocalMedia';\nimport { firstReferenceAssetId, runCanvasMediaGeneration } from '@/features/canvas/adapters/recombynGeneration';\nimport { DEFAULT_KITH_VIDEO_MODEL_ID, clampToVideoLimits, kithVideoModels, videoLimitsForModel } from '@/features/canvas/adapters/arkModelCatalog';", "VideoQuickEdit local media");
      rewritten = replaceRequired(
        rewritten,
        "    byok: customProvidersAsModels(),",
        "    byok: [...kithVideoModels(), ...customProvidersAsModels()],",
        "VideoQuickEdit Kith model catalog",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const modelsCatalogQuery = useQuery\([\s\S]*?\n  }, \[\n    modelsCatalogQuery\.data,[\s\S]*?\n  \]\);\n\n  useEffect\(\(\) => \(\) => abortRef\.current\?\.abort\(\), \[\]\);/,
        "  useEffect(() => {\n    const localModels = buildVideoModelList(null);\n    setModels(localModels);\n    if (localModels.length && !localModels.some((model) => model.id === modelId)) setModelId(localModels[0]!.id);\n    // Stage 1 never requests the Recombyn model catalog.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  useEffect(() => () => { abortRef.current?.abort(); }, []);",
        "VideoQuickEdit local model catalog",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const onGenerate = async \(\) => \{[\s\S]*?\n  \};\n\n  if \(!node/,
        `  const onGenerate = async () => {
    const text = prompt.trim();
    if (!text || sending || !node) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'generate',
            processLabel: t('editor.tools.videoGenerating'),
            genPrompt: text,
          },
        },
      })
    );
    try {
      await runCanvasMediaGeneration({
        jobType: 'video',
        genPrompt: text,
        targetNodeId: nodeId,
        node,
        aspectRatio,
        duration,
        model: modelId,
        resolution,
        referenceAssetId: firstReferenceAssetId(contexts, src)
          || (typeof node.assetId === 'string' && node.assetId.trim())
          || (typeof node.attrs?.assetId === 'string' && node.attrs.assetId.trim())
          || undefined,
        signal: ac.signal,
      });
    } catch (err: any) {
      if (ac.signal.aborted || err?.name === 'AbortError') return;
      const doc = (store.getState() as any).editor?.document;
      if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      message.error(String(err?.message || t('editor.tools.videoGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  if (!node`,
        "VideoQuickEdit Kith generation",
      );
    }
    if (item.path.endsWith("/components/editor/nodes/ImageGeneratorNode/ImageGeneratorCard.tsx")) {
      changes.push("route image generator submit through the Kith Canvas generation job host seam");
      changes.push("always clear the generating overlay on abort or error");
      rewritten = replaceRequired(rewritten, "import { useQuery } from '@tanstack/react-query';\n", "", "ImageGeneratorCard query import");
      rewritten = replaceRequired(
        rewritten,
        "import { generateImage, type ChatModelsResponse, type LlmModel } from '@recombyn-native/service/chat';\n",
        "type LlmModel = { id: string; kind?: string; label?: string; [key: string]: unknown };\n",
        "ImageGeneratorCard job client import",
      );
      rewritten = replaceRequired(
        rewritten,
        "import { apiQuery, getHttpErrorMessage } from '@recombyn-native/service/client';\n",
        "",
        "ImageGeneratorCard API query import",
      );
      rewritten = replaceRequired(
        rewritten,
        "import { readFileAsDataUrl } from '@recombyn-native/utils/uploadImage';",
        "import { readFileAsDataUrl } from '@/features/canvas/adapters/recombynLocalMedia';\nimport { firstReferenceAssetId, runCanvasMediaGeneration } from '@/features/canvas/adapters/recombynGeneration';\nimport { DEFAULT_KITH_IMAGE_MODEL_ID, kithImageModels } from '@/features/canvas/adapters/arkModelCatalog';",
        "ImageGeneratorCard local media adapter",
      );
      rewritten = replaceRequired(
        rewritten,
        "    byok: customProvidersAsModels(),",
        "    byok: [...kithImageModels(), ...customProvidersAsModels()],",
        "ImageGeneratorCard Kith model catalog",
      );
      rewritten = replaceRequired(
        rewritten,
        "  finishImageGenerator,\n",
        "",
        "ImageGeneratorCard remove finishImageGenerator",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const modelsCatalogQuery = useQuery\([\s\S]*?\n  }, \[\n    modelsCatalogQuery\.data,[\s\S]*?\n  \]\);\n\n  useEffect\(\(\) => \{\n    return \(\) => \{\n      abortRef\.current\?\.abort\(\);\n    };\n  }, \[\]\);/,
        "  useEffect(() => {\n    const unique = buildImageGeneratorModelList(null);\n    setModels(unique);\n    setModelsStatus('ready');\n    const nextId = nextImageModelId(unique, modelId);\n    if (nextId) setModelId(nextId);\n    // Stage 1 model choices are local-only; no Recombyn catalog request.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  useEffect(() => () => { abortRef.current?.abort(); }, []);",
        "ImageGeneratorCard local model catalog",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const onGenerate = async \(\) => \{[\s\S]*?\n  };\n\n  const persistGenSettings/,
        `  const onGenerate = async () => {
    const text = prompt.trim();
    if (!text || sending || disabled) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'generate',
            processLabel: t('editor.tools.imageGenerating'),
            genPrompt: text,
          },
        },
      })
    );
    try {
      const live = (store.getState() as any).editor?.document?.deltaSetLike?.[nodeId];
      await runCanvasMediaGeneration({
        jobType: 'image',
        genPrompt: text,
        targetNodeId: nodeId,
        node: live,
        fallbackBox: sceneBox,
        aspectRatio,
        model: modelId,
        resolution,
        referenceAssetId: firstReferenceAssetId(contextsRef.current),
        signal: ac.signal,
      });
    } catch (err: any) {
      const doc = (store.getState() as any).editor?.document;
      if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      if (ac.signal.aborted || err?.name === 'AbortError') return;
      message.error(String(err?.message || t('editor.tools.imageGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  const persistGenSettings`,
        "ImageGeneratorCard Kith generation",
      );
    }
    if (item.path.endsWith("/components/editor/nodes/VideoGeneratorNode/VideoGeneratorCard.tsx")) {
      changes.push("route video generator submit through the Kith Canvas generation job host seam");
      rewritten = replaceRequired(rewritten, "import { useQuery } from '@tanstack/react-query';\n", "", "VideoGeneratorCard query import");
      rewritten = replaceRequired(
        rewritten,
        "import { generateVideo, type ChatModelsResponse, type LlmModel } from '@recombyn-native/service/chat';\n",
        "type LlmModel = { id: string; kind?: string; label?: string; [key: string]: unknown };\n",
        "VideoGeneratorCard job client import",
      );
      rewritten = replaceRequired(
        rewritten,
        "import { apiQuery, getHttpErrorMessage } from '@recombyn-native/service/client';\n",
        "",
        "VideoGeneratorCard API query import",
      );
      rewritten = replaceRequired(
        rewritten,
        "import { uploadComposerAttachment, readFileAsDataUrl } from '@recombyn-native/utils/uploadImage';",
        "import { readFileAsDataUrl } from '@/features/canvas/adapters/recombynLocalMedia';\nimport { firstReferenceAssetId, runCanvasMediaGeneration } from '@/features/canvas/adapters/recombynGeneration';\nimport { DEFAULT_KITH_VIDEO_MODEL_ID, clampToVideoLimits, kithVideoModels, videoLimitsForModel } from '@/features/canvas/adapters/arkModelCatalog';",
        "VideoGeneratorCard local media adapter",
      );
      rewritten = replaceRequired(
        rewritten,
        "    byok: customProvidersAsModels(),",
        "    byok: [...kithVideoModels(), ...customProvidersAsModels()],",
        "VideoGeneratorCard Kith model catalog",
      );
      rewritten = replaceRequired(
        rewritten,
        "  finishVideoGenerator,\n",
        "",
        "VideoGeneratorCard remove finishVideoGenerator",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const modelsCatalogQuery = useQuery\([\s\S]*?\n  }, \[\n    modelsCatalogQuery\.data,[\s\S]*?\n  \]\);\n\n  useEffect\(\(\) => \{\n    return \(\) => \{\n      abortRef\.current\?\.abort\(\);\n    };\n  }, \[\]\);/,
        "  useEffect(() => {\n    const unique = buildVideoGeneratorModelList(null);\n    setModels(unique);\n    setModelsStatus('ready');\n    const nextId = nextVideoModelId(unique, modelId);\n    if (nextId) setModelId(nextId);\n    // Stage 1 model choices are local-only; no Recombyn catalog request.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  useEffect(() => () => { abortRef.current?.abort(); }, []);",
        "VideoGeneratorCard local model catalog",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const attachRefFiles = async \(files: File\[\]\) => \{[\s\S]*?\n  };\n\n  \/\/ `@` opens the attachment mention panel/,
        `  const attachRefFiles = async (files: File[]) => {
    const media = files.filter(
      (file) => file.type.startsWith('image/') || file.type.startsWith('video/')
    );
    if (!media.length) return;
    const results = await Promise.all(
      media.map(async (file, index) => {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          let thumbUrl = dataUrl;
          if (file.type.startsWith('video/')) {
            try {
              thumbUrl = await captureVideoPosterFrame(dataUrl);
            } catch {
              thumbUrl = dataUrl;
            }
          }
          return {
            key: \`attach:\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}-\${index}\`,
            label: file.name || t('editor.tools.videoGenRef'),
            kind: 'attachment' as const,
            payload: file.type.startsWith('video/')
              ? \`[Attached video]\\nname: \${file.name}\\nmime: \${file.type}\`
              : \`[Attached image]\\nname: \${file.name}\\nmime: \${file.type}\`,
            dataUrl,
            thumbUrl,
            uploadStatus: 'ready' as const,
          } satisfies ComposerContext;
        } catch {
          message.error(t('agent.attachReadFailed', { name: file.name }));
          return null;
        }
      })
    );
    const next = results.filter(Boolean) as ComposerContext[];
    if (next.length) setContexts((previous) => [...previous, ...next]);
  };

  // \`@\` opens the attachment mention panel`,
        "VideoGeneratorCard local references",
      );
      rewritten = replaceRequired(
        rewritten,
        /  const onGenerate = async \(\) => \{[\s\S]*?\n  };\n\n  const persistGenSettings/,
        `  const onGenerate = async () => {
    const text = prompt.trim();
    if (!text || sending || disabled) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'generate',
            processLabel: t('editor.tools.videoGenerating'),
            genPrompt: text,
          },
        },
      })
    );
    try {
      const live = (store.getState() as any).editor?.document?.deltaSetLike?.[nodeId];
      await runCanvasMediaGeneration({
        jobType: 'video',
        genPrompt: text,
        targetNodeId: nodeId,
        node: live,
        fallbackBox: sceneBox,
        aspectRatio,
        duration,
        model: modelId,
        resolution,
        referenceAssetId: firstReferenceAssetId(contextsRef.current),
        signal: ac.signal,
      });
    } catch (err: any) {
      if (ac.signal.aborted || err?.name === 'AbortError') return;
      const doc = (store.getState() as any).editor?.document;
      if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      message.error(String(err?.message || t('editor.tools.videoGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  const persistGenSettings`,
        "VideoGeneratorCard Kith generation",
      );
    }
    if (item.path.endsWith("/components/rcb/selection/chrome/SelectionContextToolbar.tsx")) {
      changes.push("hide selection pill during upscale/expand/crop sessions");
      changes.push("keep image layering honestly unavailable instead of spawning a failing clone");
      rewritten = replaceRequired(
        rewritten,
        "      imageToolPanel?.kind === 'adjust' ||\n      imageToolPanel?.kind === 'mark');",
        "      imageToolPanel?.kind === 'adjust' ||\n      imageToolPanel?.kind === 'mark' ||\n      imageToolPanel?.kind === 'upscale' ||\n      imageToolPanel?.kind === 'expand' ||\n      imageToolPanel?.kind === 'crop');",
        "SelectionContextToolbar hide pill for upscale/expand/crop",
      );
      rewritten = replaceRequired(
        rewritten,
        "import { message } from '@recombyn-native/components/base';\n",
        "import { message } from '@recombyn-native/components/base';\nimport { unsupportedImageProcessKindMessage } from '@recombyn-native/service/imageTools';\n",
        "SelectionContextToolbar layering message helper",
      );
      rewritten = replaceRequired(
        rewritten,
        "            onEditElements={() =>\n              runImageProcess(\n                'editElements',\n                t('editor.imageToolbar.processingEditElements')\n              )\n            }",
        "            onEditElements={() => {\n              message.error(unsupportedImageProcessKindMessage('editElements'));\n            }}",
        "SelectionContextToolbar editElements toast",
      );
    }
    if (item.path.endsWith("/components/editor/nodes/ImageNode/ImageProcessWatcher.tsx")) {
      changes.push("keep durable canvas-asset URLs instead of re-uploading process results");
      changes.push("do not abort in-flight process jobs on watcher remount");
      changes.push("surface i2i timeout as a processing error, not a layering error");
      rewritten = rewritten.replace(
        "  const raw = String(src || '').trim();\n  if (!raw) return raw;\n  try {",
        "  const raw = String(src || '').trim();\n  if (!raw) return raw;\n  if (/^\\/api\\/canvas-assets\\//.test(raw)) return raw;\n  try {",
      );
      rewritten = replaceRequired(
        rewritten,
        "    let cancelled = false;\n    const ac = new AbortController();\n",
        "    let cancelled = false;\n",
        "ImageProcessWatcher drop abort controller",
      );
      rewritten = replaceRequired(
        rewritten,
        "        const res = await processImageTool(processBody, { signal: ac.signal });",
        "        const res = await processImageTool(processBody);",
        "ImageProcessWatcher ignore remount abort",
      );
      rewritten = replaceRequired(
        rewritten,
        "    return () => {\n      cancelled = true;\n      ac.abort();\n    };",
        "    return () => {\n      cancelled = true;\n    };",
        "ImageProcessWatcher cleanup without abort",
      );
      rewritten = replaceRequired(
        rewritten,
        "  if (/timeout/i.test(msg) || (err as { code?: string })?.code === 'ECONNABORTED')\n    return '图片分层超时，请稍后重试（大图首次加载模型会更慢）';",
        "  if (/timed out|timeout/i.test(msg) || (err as { code?: string })?.code === 'ECONNABORTED')\n    return '处理超时：图生图会把原图发给方舟，通常比文生图慢。请检查网络后重试。';",
        "ImageProcessWatcher generation timeout copy",
      );
    }
    if (item.path.endsWith("/components/editor/nodes/ImageNode/ImageRemoveBgMenu.tsx")) {
      changes.push("accept disabled state for unavailable background-removal action");
      changes.push("keep remove-bg mode menu inside the selection toolbar instead of a Floating UI portal");
      rewritten = replaceRequired(
        rewritten,
        "import { useState, type ReactNode, memo } from 'react';\nimport { useTranslation } from 'react-i18next';\nimport {\n  autoUpdate,\n  flip,\n  offset,\n  shift,\n  useClick,\n  useDismiss,\n  useFloating,\n  useInteractions,\n  FloatingPortal,\n} from '@/features/canvas/adapters/recombynFloatingUi';",
        "import { useEffect, useRef, useState, type ReactNode, memo } from 'react';\nimport { useTranslation } from 'react-i18next';",
        "ImageRemoveBgMenu drop Floating UI portal",
      );
      rewritten = replaceRequired(
        rewritten,
        "/** Remove-bg mode menu: hair/portrait (default) vs product hard edge. */\nfunction ImageRemoveBgMenu({\n  onPick,\n}: {\n  onPick: (mode: RemoveBgMode) => void;\n}): ReactNode {\n  const { t } = useTranslation();\n  const [open, setOpen] = useState(false);\n  const { refs, floatingStyles, context } = useFloating({\n    open,\n    onOpenChange: setOpen,\n    placement: 'bottom-start',\n    strategy: 'fixed',\n    whileElementsMounted: autoUpdate,\n    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12, mainAxis: false })],\n  });\n  const click = useClick(context);\n  const dismiss = useDismiss(context);\n  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);",
        "/**\n * Remove-bg mode menu: hair/portrait (default) vs product hard edge.\n * Stay inside the selection toolbar chrome — RCB activates toolbar buttons\n * with a synthetic click, and the Stage 1 Floating UI portal sits under the\n * scene overlay so portaled items never receive the pointer.\n */\nfunction ImageRemoveBgMenu({\n  onPick,\n  disabled = false,\n}: {\n  onPick: (mode: RemoveBgMode) => void;\n  disabled?: boolean;\n}): ReactNode {\n  const { t } = useTranslation();\n  const [open, setOpen] = useState(false);\n  const rootRef = useRef<HTMLDivElement | null>(null);\n\n  useEffect(() => {\n    if (!open) return undefined;\n    const onPointerDown = (event: PointerEvent) => {\n      const root = rootRef.current;\n      if (root && !root.contains(event.target as Node)) setOpen(false);\n    };\n    window.addEventListener('pointerdown', onPointerDown, true);\n    return () => window.removeEventListener('pointerdown', onPointerDown, true);\n  }, [open]);",
        "ImageRemoveBgMenu inline menu state",
      );
      rewritten = replaceRequired(
        rewritten,
        "  return (\n    <>\n      <button\n        type=\"button\"\n        ref={refs.setReference}\n        className={cn(imageToolBtn, open && 'bg-[var(--accent-soft)]')}\n        {...getReferenceProps()}\n      >",
        "  return (\n    <div ref={rootRef} className=\"relative\">\n      <button\n        type=\"button\"\n        disabled={disabled}\n        className={cn(imageToolBtn, disabled && 'cursor-not-allowed opacity-50', open && 'bg-[var(--accent-soft)]')}\n        onClick={() => {\n          if (disabled) return;\n          setOpen((value) => !value);\n        }}\n      >",
        "ImageRemoveBgMenu inline trigger",
      );
      rewritten = replaceRequired(
        rewritten,
        "      <FloatingPortal>\n        {open ? (\n          <DropdownPanel\n            ref={refs.setFloating}\n            style={floatingStyles}\n            className=\"z-[80] min-w-[11.5rem]\"\n            {...getFloatingProps()}\n          >\n            {modes.map((m) => (\n              <DropdownPanelItem\n                key={m.key}\n                className=\"h-auto min-h-8 items-start py-1.5\"\n                onClick={() => {\n                  onPick(m.key);\n                  setOpen(false);\n                }}\n              >",
        "      {open ? (\n        <DropdownPanel\n          role=\"menu\"\n          className=\"absolute left-0 top-[calc(100%+8px)] z-[80] min-w-[11.5rem]\"\n        >\n          {modes.map((m) => (\n            <DropdownPanelItem\n              key={m.key}\n              role=\"menuitem\"\n              className=\"h-auto min-h-8 items-start py-1.5\"\n              onClick={() => {\n                onPick(m.key);\n                setOpen(false);\n              }}\n            >",
        "ImageRemoveBgMenu inline dropdown",
      );
      rewritten = replaceRequired(
        rewritten,
        "            ))}\n          </DropdownPanel>\n        ) : null}\n      </FloatingPortal>\n    </>\n  );",
        "          ))}\n        </DropdownPanel>\n      ) : null}\n    </div>\n  );",
        "ImageRemoveBgMenu close inline wrapper",
      );
    }
    if (item.path.endsWith("/components/editor/nodes/ImageNode/ImageToolbarEditTools.tsx")) {
      changes.push("accept optional disabled state for image-processing actions");
      rewritten = rewritten
        .replace("type=\"button\"\n      className={cn(imageToolBtn, 'relative', active && 'bg-[var(--accent-soft)]')}", "type=\"button\"\n      disabled={!onClick}\n      className={cn(imageToolBtn, 'relative', !onClick && 'cursor-not-allowed opacity-50', active && 'bg-[var(--accent-soft)]')}")
        .replace("  downloadSlot,\n}: {", "  downloadSlot,\n  disabled = false,\n}: {")
        .replace("  downloadSlot?: ReactNode;\n})", "  downloadSlot?: ReactNode;\n  disabled?: boolean;\n})")
        .replace("onClick={onUpscale}", "onClick={disabled ? undefined : onUpscale}")
        .replace("<ImageRemoveBgMenu onPick={onRemoveBg} />", "<ImageRemoveBgMenu onPick={onRemoveBg} disabled={disabled} />")
        .replace("onClick={onEraser}", "onClick={disabled ? undefined : onEraser}")
        .replace("onClick={onMark}", "onClick={disabled ? undefined : onMark}")
        .replace("onClick={onReplaceText}", "onClick={disabled ? undefined : onReplaceText}")
        .replace("onClick={onEditElements}", "onClick={disabled ? undefined : onEditElements}")
        .replace("onClick={onMultiAngle}", "onClick={disabled ? undefined : onMultiAngle}");
    }
    if (item.path.endsWith("/components/editor/nodes/ImageNode/mark/MarkRegionOverlay.tsx")) {
      changes.push("follow the pointer with a short drag hint instead of a caption on the photo");
      changes.push("toast clicks that are too small to commit");
      rewritten = replaceRequired(
        rewritten,
        " * On-image mark overlay: crosshair cursor, drag-to-box, dashed region badges.\n */",
        " * On-image mark overlay: crosshair cursor, drag-to-box, dashed region badges.\n * Mode hint follows the pointer in the gutter next to the cursor — never a\n * static caption on the photo.\n */",
        "MarkRegionOverlay hint comment",
      );
      rewritten = replaceRequired(
        rewritten,
        "  onCommitDraft: (rect: MarkRect) => void;\n  onSelectRegion: (id: string, additive: boolean) => void;\n};",
        "  onCommitDraft: (rect: MarkRect) => void;\n  onSelectRegion: (id: string, additive: boolean) => void;\n  onClickWithoutDrag?: () => void;\n};",
        "MarkRegionOverlay click-without-drag prop",
      );
      rewritten = replaceRequired(
        rewritten,
        "  onCommitDraft,\n  onSelectRegion,\n}: Props): ReactNode {",
        "  onCommitDraft,\n  onSelectRegion,\n  onClickWithoutDrag,\n}: Props): ReactNode {",
        "MarkRegionOverlay destructure click-without-drag",
      );
      rewritten = replaceRequired(
        rewritten,
        "  const onSelectRegionRef = useRef(onSelectRegion);\n  onDraftChangeRef.current = onDraftChange;\n  onCommitDraftRef.current = onCommitDraft;\n  onSelectRegionRef.current = onSelectRegion;",
        "  const onSelectRegionRef = useRef(onSelectRegion);\n  const onClickWithoutDragRef = useRef(onClickWithoutDrag);\n  onDraftChangeRef.current = onDraftChange;\n  onCommitDraftRef.current = onCommitDraft;\n  onSelectRegionRef.current = onSelectRegion;\n  onClickWithoutDragRef.current = onClickWithoutDrag;",
        "MarkRegionOverlay click-without-drag ref",
      );
      rewritten = replaceRequired(
        rewritten,
        "      const box = normalizeDragBox(drag.x0, drag.y0, p.x, p.y, cw, ch);\n      onDraftChangeRef.current(null);\n      if (box) onCommitDraftRef.current(box);",
        "      const box = normalizeDragBox(drag.x0, drag.y0, p.x, p.y, cw, ch);\n      onDraftChangeRef.current(null);\n      if (box) onCommitDraftRef.current(box);\n      else if (!drag.moved) onClickWithoutDragRef.current?.();",
        "MarkRegionOverlay toast tiny clicks",
      );
      rewritten = replaceRequired(
        rewritten,
        "    zIndex: 34,",
        "    zIndex: 80,",
        "MarkRegionOverlay stacking",
      );
      rewritten = replaceRequired(
        rewritten,
        "  const [hoverId, setHoverId] = useState<string | null>(null);",
        "  const [hoverId, setHoverId] = useState<string | null>(null);\n  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);",
        "MarkRegionOverlay cursor hint state",
      );
      rewritten = replaceRequired(
        rewritten,
        "        {detecting ? (\n          <div className=\"pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20\">\n            <span className=\"rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] shadow-sm\">\n              识别主题中…\n            </span>\n          </div>\n        ) : null}",
        "        {detecting ? (\n          <div className=\"pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20\">\n            <span className=\"rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] shadow-sm\">\n              识别主题中…\n            </span>\n          </div>\n        ) : !draft && cursor ? (\n          <span\n            role=\"status\"\n            data-mark-cursor-hint\n            className=\"pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-[var(--ink)]/80 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm\"\n            style={{\n              // Runtime pointer offset — cannot be a static Tailwind class.\n              left: Math.min(cursor.x + 14, Math.max(8, stageW - 72)),\n              top: Math.min(cursor.y + 18, Math.max(8, stageH - 24)),\n            }}\n          >\n            按住拖选\n          </span>\n        ) : null}",
        "MarkRegionOverlay cursor drag hint",
      );
      changes.push("map mark drag from the overlay screen rect, not stage-local origin minus clientX");
      rewritten = replaceRequired(
        rewritten,
        "} from '@recombyn-native/components/rcb';",
        "} from '@recombyn-native/components/rcb';\nimport { markLocalFromClientRect } from '@/features/canvas/adapters/recombynMarkOverlay';",
        "MarkRegionOverlay host coordinate helper",
      );
      rewritten = replaceRequired(
        rewritten,
        "  const origin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);\n  const stageW = Math.max(1, imageBox.width * z);\n  const stageH = Math.max(1, imageBox.height * z);\n  const cw = imageBox.width;\n  const ch = imageBox.height;\n\n  const localFromClient = useCallback(\n    (clientX: number, clientY: number) => {\n      const lx = (clientX - origin.x) / z;\n      const ly = (clientY - origin.y) / z;\n      return {\n        x: Math.max(0, Math.min(cw, lx)),\n        y: Math.max(0, Math.min(ch, ly)),\n        inside: lx >= 0 && ly >= 0 && lx <= cw && ly <= ch,\n      };\n    },\n    [origin.x, origin.y, z, cw, ch]\n  );",
        "  const origin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);\n  const stageW = Math.max(1, imageBox.width * z);\n  const stageH = Math.max(1, imageBox.height * z);\n  const cw = imageBox.width;\n  const ch = imageBox.height;\n  const overlayRef = useRef<HTMLDivElement | null>(null);\n\n  const localFromClient = useCallback(\n    (clientX: number, clientY: number) =>\n      markLocalFromClientRect(\n        clientX,\n        clientY,\n        overlayRef.current?.getBoundingClientRect(),\n        cw,\n        ch\n      ),\n    [cw, ch]\n  );",
        "MarkRegionOverlay client coords via overlay rect",
      );
      rewritten = replaceRequired(
        rewritten,
        "      <div\n        data-image-tool-panel\n        data-mark-overlay\n        className=\"pointer-events-auto absolute\"\n        style={shellStyle}",
        "      <div\n        ref={overlayRef}\n        data-image-tool-panel\n        data-mark-overlay\n        className=\"pointer-events-auto absolute\"\n        style={shellStyle}",
        "MarkRegionOverlay overlay ref",
      );
      rewritten = replaceRequired(
        rewritten,
        "          onDraftChange(null);\n          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);",
        "          onDraftChange(null);\n          setCursor(null);\n          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);",
        "MarkRegionOverlay hide hint on drag start",
      );
      rewritten = replaceRequired(
        rewritten,
        "          if (!p.inside) {\n            setHoverId(null);\n            return;\n          }\n          const hit = [...regions].reverse().find((r) => pointInRect(p.x, p.y, r));\n          setHoverId(hit?.id ?? null);\n        }}\n        onPointerLeave={() => {\n          if (!dragRef.current) setHoverId(null);\n        }}",
        "          if (!p.inside) {\n            setHoverId(null);\n            setCursor(null);\n            return;\n          }\n          const hit = [...regions].reverse().find((r) => pointInRect(p.x, p.y, r));\n          setHoverId(hit?.id ?? null);\n          setCursor({ x: p.x * z, y: p.y * z });\n        }}\n        onPointerLeave={() => {\n          if (!dragRef.current) {\n            setHoverId(null);\n            setCursor(null);\n          }\n        }}",
        "MarkRegionOverlay track pointer for hint",
      );
    }
    if (item.path.endsWith("/components/editor/nodes/ImageNode/mark/MarkSessionHost.tsx")) {
      changes.push("skip Recombyn detectRegions auto-detect and keep manual drag-to-chat");
      changes.push("send marked crops into the left Kith Chat composer instead of AgentDock");
      changes.push("freeze marked image regions onto the Canvas snapshot instead of composer caption");
      changes.push("drop the Recombyn visible @-chip payload builder");
      rewritten = replaceRequired(
        rewritten,
        "import { resolveChatFlyTarget } from '@recombyn-native/components/editor/panels/agent/flyToChat';\nimport { getHttpErrorMessage } from '@recombyn-native/service/client';\nimport {\n  processImageTool,\n  type ImageDecomposeLayer,\n} from '@recombyn-native/service/imageTools';",
        "import { resolveChatFlyTarget } from '@recombyn-native/components/editor/panels/agent/flyToChat';\nimport { message } from '@recombyn-native/components/base';\nimport { getHttpErrorMessage } from '@recombyn-native/service/client';\nimport {\n  type ImageDecomposeLayer,\n} from '@recombyn-native/service/imageTools';",
        "MarkSessionHost skip detectRegions client",
      );
      rewritten = replaceRequired(
        rewritten,
        "import {\n  closeImageToolPanel,\n  enqueueAgentContexts,\n} from '@recombyn-native/store/modules/editor';",
        "import {\n  closeImageToolPanel,\n} from '@recombyn-native/store/modules/editor';",
        "MarkSessionHost drop AgentDock enqueue",
      );
      rewritten = replaceRequired(
        rewritten,
        "import { imageSrcToFile } from '@recombyn-native/utils/uploadImage';\nimport { cn } from '@recombyn-native/utils/classnames';",
        "import { imageSrcToFile } from '@recombyn-native/utils/uploadImage';\nimport { cn } from '@recombyn-native/utils/classnames';\nimport { kithChatFlyLandId, sendMarkedImageRegionToChat } from '@/features/canvas/adapters/recombynMarkToChat';\nimport { useCanvasSelectionSourceId } from '@/features/canvas/host/canvasSelectionSource';",
        "MarkSessionHost Kith Chat seam",
      );
      rewritten = replaceRequired(
        rewritten,
        "/** Landing point inside the right Agent composer (fallback: dock / viewport). */\nfunction resolveMarkChatFlyTarget(): { x: number; y: number } {\n  return resolveChatFlyTarget({ landId: 'agent' });\n}",
        "/** Landing point inside the left Kith Composer (fallback: left viewport). */\nfunction resolveMarkChatFlyTarget(): { x: number; y: number } {\n  return resolveChatFlyTarget({ landId: kithChatFlyLandId() });\n}",
        "MarkSessionHost left Chat fly target",
      );
      rewritten = replaceRequired(
        rewritten,
        " * Selecting a region flies an @ chip into the right AgentDock chat.\n */\nfunction MarkSessionHost({ document }: { document: SceneDocument }): ReactNode {\n  const dispatch = useDispatch();",
        " * Selecting a region flies a chip into the left Kith Chat composer.\n */\nfunction MarkSessionHost({ document }: { document: SceneDocument }): ReactNode {\n  const dispatch = useDispatch();\n  const canvasId = useCanvasSelectionSourceId();",
        "MarkSessionHost canvasId for Chat grant",
      );
      rewritten = replaceRequired(
        rewritten,
        /  useEffect\(\(\) => \{\n    if \(!active \|\| !src \|\| !box\) return;[\s\S]*?  \}, \[active, src\]\);/,
        `  useEffect(() => {
    if (!active) return;
    setRegions([]);
    setDraft(null);
    setFlies([]);
    setDetecting(false);
    abortRef.current?.abort();
    // Auto subject detection needs Recombyn's vision decompose API; keep manual drag-select.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src]);`,
        "MarkSessionHost skip auto detect",
      );
      rewritten = replaceRequired(
        rewritten,
        `    // Insert into chat as the tag arrives so it feels continuous.
    window.setTimeout(() => {
      dispatch(
        enqueueAgentContexts([
          {
            key: \`mark:\${active}:\${region.id}\`,
            label: region.label || \`区域 \${region.index}\`,
            kind: 'image',
            payload: buildMarkChipPayload(active, region, box.width, box.height),
            ...(thumb ? { dataUrl: thumb, thumbUrl: thumb } : {}),
          },
        ])
      );
    }, Math.round(FLY_MS * 0.78));`,
        `    // Insert into the left Kith Chat as the tag arrives so it feels continuous.
    window.setTimeout(() => {
      sendMarkedImageRegionToChat({
        canvasId,
        nodeId: active,
        label: region.label || \`区域 \${region.index}\`,
        region: {
          x: region.x,
          y: region.y,
          w: region.w,
          h: region.h,
          kind: region.kind,
        },
        nodeWidth: box.width,
        nodeHeight: box.height,
        dataUrl: thumb,
      });
    }, Math.round(FLY_MS * 0.78));`,
        "MarkSessionHost send crop to Kith Chat",
      );
      rewritten = replaceRequired(
        rewritten,
        `function buildMarkChipPayload(
  nodeId: string,
  region: MarkRegion,
  nodeW: number,
  nodeH: number
): string {
  const nx = (region.x / nodeW).toFixed(3);
  const ny = (region.y / nodeH).toFixed(3);
  const nw = (region.w / nodeW).toFixed(3);
  const nh = (region.h / nodeH).toFixed(3);
  const tag = region.kind === 'text' ? 'text' : 'subject';
  return [
    '[Marked image region — edit this area on the referenced image]',
    \`node_id: \${nodeId}\`,
    \`region: #\${region.index}(\${tag}@\${nx},\${ny},\${nw}x\${nh})\`,
    \`label: \${region.label || \`区域 \${region.index}\`}\`,
  ].join('\\n');
}

`,
        "",
        "MarkSessionHost drop visible chip payload",
      );
      rewritten = replaceRequired(
        rewritten,
        "        onCommitDraft={onCommitDraft}\n        onSelectRegion={onSelectRegion}",
        "        onCommitDraft={onCommitDraft}\n        onSelectRegion={onSelectRegion}\n        onClickWithoutDrag={() => message.warning('请按住拖选要标记的区域')}",
        "MarkSessionHost click-without-drag toast",
      );
    }
    if (repositoryWhitespaceNormalizedSources.has(item.path)) {
      changes.push("normalize upstream blank-line whitespace and final newline for repository diff checks");
      rewritten = rewritten.replace(/^[\t ]+$/gm, "").replace(/\n+$/, "\n");
    }
    writeFileSync(target, notice + rewritten);
  } else {
    writeFileSync(target, sourceBytes);
  }
  mapping.push({
    source: item.path,
    sourceSha256: item.sha256,
    target: path.relative(repoRoot, target).split(path.sep).join("/"),
    disposition: changes.length ? "adapted_source" : "exact_copy",
    changes,
  });
}

const serviceClientTarget = path.join(outputRoot, "apps/web/src/service/client.ts");
writeFileSync(
  serviceClientTarget,
  `/*\n * Modified by Kith-space for the Stage 1 native Canvas island.\n * Source: Recombyn ${expectedCommit} / apps/web/src/service/client.ts\n * Change: cloud/API transport is inverted to the in-memory Stage 1 host seam.\n * Apache-2.0 and upstream NOTICE apply.\n */\nexport * from "@/features/canvas/adapters/recombynStageOneServices";\n`,
);
const serviceMapping = mapping.find((item) => item.source === "apps/web/src/service/client.ts");
if (!serviceMapping) throw new Error("Missing service/client.ts source mapping");
serviceMapping.disposition = "host_adapter_seam";
serviceMapping.changes = ["replace cloud/API transport with Stage 1 unavailable/empty-query adapter"];
writeFileSync(
  path.join(outputRoot, "apps/web/src/components/editor/projectDraftStore.ts"),
  `/*\n * Modified by Kith-space for the Stage 1 native Canvas island.\n * Source: Recombyn ${expectedCommit} / apps/web/src/components/editor/projectDraftStore.ts\n * Change: IndexedDB persistence is inverted to the in-memory Stage 1 document/session seam.\n * Apache-2.0 and upstream NOTICE apply.\n */\nexport * from "@/features/canvas/adapters/recombynProjectMemory";\n`,
);
const draftMapping = mapping.find((item) => item.source === "apps/web/src/components/editor/projectDraftStore.ts");
if (!draftMapping) throw new Error("Missing projectDraftStore.ts source mapping");
draftMapping.disposition = "host_adapter_seam";
draftMapping.changes = ["replace IndexedDB draft/session persistence with process-memory adapter"];

const seamReplacements = [
  {
    source: "apps/web/src/service/wallet.ts",
    adapter: "@/features/canvas/adapters/recombynStageOneWallet",
    change: "replace wallet/billing queries and raw fetch with a local unavailable snapshot seam",
  },
  {
    source: "apps/web/src/components/editor/collab/CollabRoomProvider.tsx",
    adapter: "@/features/canvas/adapters/recombynStageOneCollaboration",
    change: "replace Yjs/WebSocket/IndexedDB collaboration runtime with a pass-through unavailable seam",
  },
];
for (const seam of seamReplacements) {
  const target = path.join(outputRoot, seam.source);
  writeFileSync(
    target,
    `/*\n * Modified by Kith-space for the Stage 1 native Canvas island.\n * Source: Recombyn ${expectedCommit} / ${seam.source}\n * Change: ${seam.change}.\n * Apache-2.0 and upstream NOTICE apply.\n */\nexport * from "${seam.adapter}";\n`,
  );
  const entry = mapping.find((item) => item.source === seam.source);
  if (!entry) throw new Error(`Missing ${seam.source} source mapping`);
  entry.disposition = "host_adapter_seam";
  entry.changes = [seam.change];
}

for (const entry of mapping) {
  if (!entry.target) continue;
  entry.targetSha256 = createHash("sha256").update(readFileSync(path.join(repoRoot, entry.target))).digest("hex");
}

writeFileSync(
  path.join(outputRoot, "source-mapping.json"),
  `${JSON.stringify({ upstreamCommit: expectedCommit, generatedFrom: path.relative(repoRoot, auditPath), files: mapping }, null, 2)}\n`,
);
const copiedCount = mapping.filter((item) => item.target).length;
const excludedCount = mapping.length - copiedCount;
process.stdout.write(`Materialized ${copiedCount} native Recombyn files (${excludedCount} excluded) in ${path.relative(repoRoot, outputRoot)}\n`);
