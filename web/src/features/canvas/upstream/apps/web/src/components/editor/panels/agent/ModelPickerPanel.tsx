/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/agent/ModelPickerPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
﻿import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineBookOpen } from 'react-icons/hi2';
import type { LlmModel } from '@recombyn-native/service/chat';
import {
  dedupeModelsById,
  isImageKind,
  isVideoKind,
  modelIsImageGenerator,
  modelSupportsVisionInput,
} from '@recombyn-native/components/editor/panels/agent/llmModelMeta';
import { isCustomModelId } from '@recombyn-native/components/editor/panels/agent/customLlmProviders';
import { cn } from '@recombyn-native/utils/classnames';
import { BrandWordmarkLoader } from '@recombyn-native/components/base/AppLogo';
import { FREE_IMAGE_MODEL_ID } from '@recombyn-native/utils/wallet';
// Lobe Icons — https://icons.lobehub.com (static SVG, no antd peers)
const deepseek = syncLipsync;
const qwen = syncLipsync;
const gemini = syncLipsync;
const claude = syncLipsync;
const doubao = syncLipsync;
const glm = syncLipsync;
const gptImage = syncLipsync;
const kimi = syncLipsync;
const flux = syncLipsync;
const ideogram = syncLipsync;
const kling = syncLipsync;
const sora = syncLipsync;
const minimax = syncLipsync;
const elevenlabs = syncLipsync;
const haiper = syncLipsync;
const luma = syncLipsync;
const runway = syncLipsync;
const pika = syncLipsync;
const mistral = syncLipsync;
const meta = syncLipsync;
const groq = syncLipsync;
const grok = syncLipsync;
const perplexity = syncLipsync;
const huggingface = syncLipsync;
const cohere = syncLipsync;
const midjourney = syncLipsync;
const stability = syncLipsync;
const dalle = syncLipsync;
const openrouter = syncLipsync;
const fireworks = syncLipsync;
const together = syncLipsync;
const fal = syncLipsync;
const replicate = syncLipsync;
const ollama = syncLipsync;
const wenxin = syncLipsync;
const yi = syncLipsync;
const spark = syncLipsync;
const hunyuan = syncLipsync;
const stepfun = syncLipsync;
const baichuan = syncLipsync;
const siliconcloud = syncLipsync;
const novita = syncLipsync;
const volcengine = syncLipsync;
const vidu = syncLipsync;
const hailuo = syncLipsync;
const jimeng = syncLipsync;
const cogview = syncLipsync;
const cogvideo = syncLipsync;
const bfl = syncLipsync;
const nvidia = syncLipsync;
const azure = syncLipsync;
const bedrock = syncLipsync;
const recraft = syncLipsync;
const ai21 = syncLipsync;
const cerebras = syncLipsync;
const sambanova = syncLipsync;
const hyperbolic = syncLipsync;
const deepinfra = syncLipsync;
const poe = syncLipsync;
const coze = syncLipsync;
const internlm = syncLipsync;
const zeroone = syncLipsync;
const ai360 = syncLipsync;
const sensenova = syncLipsync;
const baidu = syncLipsync;
const alibaba = syncLipsync;
const bytedance = syncLipsync;
const huawei = syncLipsync;
const tencentcloud = syncLipsync;
const adobe = syncLipsync;
const fishaudio = syncLipsync;
const suno = syncLipsync;
const udio = syncLipsync;
const hedra = syncLipsync;
const aws = syncLipsync;
const googlecloud = syncLipsync;
const cloudflare = syncLipsync;
const workersai = syncLipsync;
const dify = syncLipsync;
const n8n = syncLipsync;
const cursor = syncLipsync;
const lmstudio = syncLipsync;
const openwebui = syncLipsync;
const vllm = syncLipsync;
const voyage = syncLipsync;
const jina = syncLipsync;
const upstage = syncLipsync;
import { neutralModelAsset as syncLipsync } from '@/features/canvas/adapters/recombynBrandAssets';
const dreamina = syncLipsync;

export { isImageKind, isVideoKind };
type ModelIconRef = {
  id?: string | null;
  provider?: string | null;
  kind?: string | null;
  label?: string | null;
  iconUrl?: string | null;
  icon_url?: string | null;
  iconKey?: string | null;
  icon_key?: string | null;
};

const MODEL_ICON_RULES: Array<{ test: (s: string) => boolean; src: string }> = [
  { test: (s) => s.includes('deepseek'), src: deepseek },
  { test: (s) => s.includes('seedream'), src: doubao },
  { test: (s) => s.includes('dreamina') || s.includes('jimeng'), src: dreamina },
  { test: (s) => s.includes('haiper'), src: haiper },
  { test: (s) => s.includes('glm') || s.includes('zhipu') || s.includes('chatglm'), src: glm },
  { test: (s) => s.includes('doubao') || s.includes('seed-2'), src: doubao },
  { test: (s) => s.includes('qwen') || s.includes('dashscope') || s.includes('tongyi'), src: qwen },
  { test: (s) => s.includes('googlecloud') || s.includes('gcp'), src: googlecloud },
  { test: (s) => s.includes('banana') || s.includes('gemini') || (s.includes('google') && !s.includes('cloud')), src: gemini },
  { test: (s) => s.includes('claude') || s.includes('anthropic'), src: claude },
  { test: (s) => s.includes('dall') || s.includes('dalle'), src: dalle },
  { test: (s) => s.includes('gpt') || s.includes('openai'), src: gptImage },
  { test: (s) => s.includes('mistral'), src: mistral },
  { test: (s) => s.includes('llama') || s.includes('meta'), src: meta },
  { test: (s) => s.includes('groq'), src: groq },
  { test: (s) => s.includes('grok') || s.includes('xai'), src: grok },
  { test: (s) => s.includes('perplexity'), src: perplexity },
  { test: (s) => s.includes('hugging'), src: huggingface },
  { test: (s) => s.includes('cohere'), src: cohere },
  { test: (s) => s.includes('midjourney'), src: midjourney },
  { test: (s) => s.includes('stability') || s.includes('stable-diffusion'), src: stability },
  { test: (s) => s.includes('flux') || s.includes('blackforest') || s.includes('bfl'), src: flux },
  { test: (s) => s.includes('ideogram'), src: ideogram },
  { test: (s) => s.includes('kling'), src: kling },
  { test: (s) => s.includes('sora'), src: sora },
  { test: (s) => s.includes('minimax') || s.includes('hailuo'), src: minimax },
  { test: (s) => s.includes('eleven'), src: elevenlabs },
  { test: (s) => s.includes('luma'), src: luma },
  { test: (s) => s.includes('runway'), src: runway },
  { test: (s) => s.includes('pika'), src: pika },
  { test: (s) => s.includes('vidu'), src: vidu },
  { test: (s) => s.includes('cogview'), src: cogview },
  { test: (s) => s.includes('cogvideo'), src: cogvideo },
  { test: (s) => s.includes('wenxin') || s.includes('ernie'), src: wenxin },
  { test: (s) => s.includes('spark'), src: spark },
  { test: (s) => s.includes('hunyuan'), src: hunyuan },
  { test: (s) => s.includes('stepfun') || s.includes('step-'), src: stepfun },
  { test: (s) => s.includes('baichuan'), src: baichuan },
  { test: (s) => s.includes('01.ai') || s.includes('zeroone') || s.includes('01-ai') || s.includes('01ai') || s.includes('零一'), src: zeroone },
  { test: (s) => /\byi\b/.test(s), src: yi },
  { test: (s) => s.includes('openrouter'), src: openrouter },
  { test: (s) => s.includes('fireworks'), src: fireworks },
  { test: (s) => s.includes('together'), src: together },
  { test: (s) => s.includes('fal.ai') || s.includes('fal-'), src: fal },
  { test: (s) => s.includes('replicate'), src: replicate },
  { test: (s) => s.includes('ollama'), src: ollama },
  { test: (s) => s.includes('silicon'), src: siliconcloud },
  { test: (s) => s.includes('novita'), src: novita },
  { test: (s) => s.includes('volc') || s.includes('ark'), src: volcengine },
  { test: (s) => s.includes('azure'), src: azure },
  { test: (s) => s.includes('bedrock') || s.includes('amazon'), src: bedrock },
  { test: (s) => s.includes('nvidia') || s.includes('nim'), src: nvidia },
  { test: (s) => s.includes('lipsync') || s.includes('sync.so'), src: syncLipsync },
  { test: (s) => s.includes('moonshot') || s.includes('kimi'), src: kimi },
  { test: (s) => s.includes('recraft'), src: recraft },
  { test: (s) => s.includes('ai21'), src: ai21 },
  { test: (s) => s.includes('cerebras'), src: cerebras },
  { test: (s) => s.includes('samba'), src: sambanova },
  { test: (s) => s.includes('hyperbolic'), src: hyperbolic },
  { test: (s) => s.includes('deepinfra'), src: deepinfra },
  { test: (s) => /\bpoe\b/.test(s), src: poe },
  { test: (s) => s.includes('coze'), src: coze },
  { test: (s) => s.includes('internlm') || s.includes('书生'), src: internlm },
  { test: (s) => s.includes('ai360') || s.includes('360智') || s.includes('zhinao'), src: ai360 },
  { test: (s) => s.includes('sensenova') || s.includes('商汤'), src: sensenova },
  { test: (s) => s.includes('baidu') || s.includes('百度'), src: baidu },
  { test: (s) => s.includes('alibaba') || s.includes('阿里'), src: alibaba },
  { test: (s) => s.includes('bytedance') || s.includes('字节'), src: bytedance },
  { test: (s) => s.includes('huawei') || s.includes('华为'), src: huawei },
  { test: (s) => s.includes('tencent') || s.includes('腾讯'), src: tencentcloud },
  { test: (s) => s.includes('adobe') || s.includes('firefly'), src: adobe },
  { test: (s) => s.includes('fishaudio') || s.includes('fish-audio'), src: fishaudio },
  { test: (s) => s.includes('suno'), src: suno },
  { test: (s) => /\budio\b/.test(s), src: udio },
  { test: (s) => s.includes('hedra'), src: hedra },
  { test: (s) => s.includes('aws'), src: aws },
  { test: (s) => s.includes('cloudflare'), src: cloudflare },
  { test: (s) => s.includes('workersai') || s.includes('workers-ai'), src: workersai },
  { test: (s) => s.includes('dify'), src: dify },
  { test: (s) => s.includes('n8n'), src: n8n },
  { test: (s) => s.includes('cursor'), src: cursor },
  { test: (s) => s.includes('lmstudio') || s.includes('lm-studio'), src: lmstudio },
  { test: (s) => s.includes('openwebui') || s.includes('open-webui'), src: openwebui },
  { test: (s) => s.includes('vllm'), src: vllm },
  { test: (s) => s.includes('voyage'), src: voyage },
  { test: (s) => s.includes('jina'), src: jina },
  { test: (s) => s.includes('upstage'), src: upstage },
];

const MODEL_ICON_BY_KEY: Record<string, string> = {
  openai: gptImage,
  gpt: gptImage,
  gpt_image: gptImage,
  dalle,
  claude,
  anthropic: claude,
  gemini,
  google: gemini,
  deepseek,
  doubao,
  seedream: doubao,
  qwen,
  kimi,
  moonshot: kimi,
  glm,
  zhipu: glm,
  chatglm: glm,
  mistral,
  meta,
  llama: meta,
  groq,
  grok,
  xai: grok,
  perplexity,
  huggingface,
  cohere,
  midjourney,
  stability,
  flux,
  bfl,
  ideogram,
  kling,
  sora,
  haiper,
  luma,
  runway,
  pika,
  vidu,
  hailuo,
  minimax,
  jimeng,
  dreamina,
  cogview,
  cogvideo,
  elevenlabs,
  lipsync: syncLipsync,
  openrouter,
  fireworks,
  together,
  fal,
  replicate,
  ollama,
  wenxin,
  yi,
  spark,
  hunyuan,
  stepfun,
  baichuan,
  siliconcloud,
  novita,
  volcengine,
  azure,
  bedrock,
  nvidia,
  recraft,
  ai21,
  cerebras,
  sambanova,
  hyperbolic,
  deepinfra,
  poe,
  coze,
  internlm,
  zeroone,
  ai360,
  sensenova,
  baidu,
  alibaba,
  bytedance,
  huawei,
  tencentcloud,
  adobe,
  fishaudio,
  suno,
  udio,
  hedra,
  aws,
  googlecloud,
  cloudflare,
  workersai,
  dify,
  n8n,
  cursor,
  lmstudio,
  openwebui,
  vllm,
  voyage,
  jina,
  upstage,
};

const MODEL_ICON_BY_PROVIDER: Record<string, string> = {
  ...MODEL_ICON_BY_KEY,
  dashscope: qwen,
};

export type ModelIconThemeId = 'chat' | 'image' | 'video' | 'audio' | 'china' | 'platform';

export type ModelIconOption = { key: string; label: string };

/** Themed preset icons for BYOK / custom model forms. */
export const CUSTOM_MODEL_ICON_GROUPS: {
  id: ModelIconThemeId;
  labelKey: string;
  options: ModelIconOption[];
}[] = [
  {
    id: 'chat',
    labelKey: 'providerModelIconThemeChat',
    options: [
      { key: 'openai', label: 'OpenAI' },
      { key: 'claude', label: 'Claude' },
      { key: 'gemini', label: 'Gemini' },
      { key: 'deepseek', label: 'DeepSeek' },
      { key: 'mistral', label: 'Mistral' },
      { key: 'meta', label: 'Meta / Llama' },
      { key: 'groq', label: 'Groq' },
      { key: 'grok', label: 'Grok' },
      { key: 'perplexity', label: 'Perplexity' },
      { key: 'cohere', label: 'Cohere' },
      { key: 'huggingface', label: 'Hugging Face' },
      { key: 'ai21', label: 'AI21' },
      { key: 'cerebras', label: 'Cerebras' },
      { key: 'sambanova', label: 'SambaNova' },
      { key: 'hyperbolic', label: 'Hyperbolic' },
      { key: 'deepinfra', label: 'DeepInfra' },
      { key: 'poe', label: 'Poe' },
      { key: 'coze', label: 'Coze' },
      { key: 'internlm', label: 'InternLM' },
      { key: 'voyage', label: 'Voyage' },
      { key: 'jina', label: 'Jina' },
      { key: 'upstage', label: 'Upstage' },
    ],
  },
  {
    id: 'china',
    labelKey: 'providerModelIconThemeChina',
    options: [
      { key: 'doubao', label: 'Doubao' },
      { key: 'qwen', label: 'Qwen' },
      { key: 'kimi', label: 'Kimi' },
      { key: 'glm', label: 'GLM' },
      { key: 'wenxin', label: 'Wenxin' },
      { key: 'yi', label: 'Yi' },
      { key: 'zeroone', label: '01.AI' },
      { key: 'spark', label: 'Spark' },
      { key: 'hunyuan', label: 'Hunyuan' },
      { key: 'stepfun', label: 'StepFun' },
      { key: 'baichuan', label: 'Baichuan' },
      { key: 'minimax', label: 'MiniMax' },
      { key: 'jimeng', label: 'Jimeng' },
      { key: 'ai360', label: '360 Zhinao' },
      { key: 'sensenova', label: 'SenseNova' },
      { key: 'baidu', label: 'Baidu' },
      { key: 'alibaba', label: 'Alibaba' },
      { key: 'bytedance', label: 'ByteDance' },
      { key: 'huawei', label: 'Huawei' },
      { key: 'tencentcloud', label: 'Tencent Cloud' },
    ],
  },
  {
    id: 'image',
    labelKey: 'providerModelIconThemeImage',
    options: [
      { key: 'dalle', label: 'DALL·E' },
      { key: 'flux', label: 'Flux' },
      { key: 'ideogram', label: 'Ideogram' },
      { key: 'midjourney', label: 'Midjourney' },
      { key: 'stability', label: 'Stability' },
      { key: 'seedream', label: 'Seedream' },
      { key: 'dreamina', label: 'Dreamina' },
      { key: 'cogview', label: 'CogView' },
      { key: 'recraft', label: 'Recraft' },
      { key: 'bfl', label: 'BFL' },
      { key: 'adobe', label: 'Adobe Firefly' },
    ],
  },
  {
    id: 'video',
    labelKey: 'providerModelIconThemeVideo',
    options: [
      { key: 'kling', label: 'Kling' },
      { key: 'sora', label: 'Sora' },
      { key: 'haiper', label: 'Haiper' },
      { key: 'luma', label: 'Luma' },
      { key: 'runway', label: 'Runway' },
      { key: 'pika', label: 'Pika' },
      { key: 'vidu', label: 'Vidu' },
      { key: 'hailuo', label: 'Hailuo' },
      { key: 'cogvideo', label: 'CogVideo' },
      { key: 'hedra', label: 'Hedra' },
    ],
  },
  {
    id: 'audio',
    labelKey: 'providerModelIconThemeAudio',
    options: [
      { key: 'elevenlabs', label: 'ElevenLabs' },
      { key: 'minimax', label: 'MiniMax Audio' },
      { key: 'lipsync', label: 'Lipsync' },
      { key: 'fishaudio', label: 'Fish Audio' },
      { key: 'suno', label: 'Suno' },
      { key: 'udio', label: 'Udio' },
    ],
  },
  {
    id: 'platform',
    labelKey: 'providerModelIconThemePlatform',
    options: [
      { key: 'openrouter', label: 'OpenRouter' },
      { key: 'ollama', label: 'Ollama' },
      { key: 'siliconcloud', label: 'SiliconCloud' },
      { key: 'novita', label: 'Novita' },
      { key: 'volcengine', label: 'Volcengine' },
      { key: 'fireworks', label: 'Fireworks' },
      { key: 'together', label: 'Together' },
      { key: 'fal', label: 'fal' },
      { key: 'replicate', label: 'Replicate' },
      { key: 'azure', label: 'Azure AI' },
      { key: 'bedrock', label: 'Bedrock' },
      { key: 'nvidia', label: 'NVIDIA' },
      { key: 'aws', label: 'AWS' },
      { key: 'googlecloud', label: 'Google Cloud' },
      { key: 'cloudflare', label: 'Cloudflare' },
      { key: 'workersai', label: 'Workers AI' },
      { key: 'dify', label: 'Dify' },
      { key: 'n8n', label: 'n8n' },
      { key: 'cursor', label: 'Cursor' },
      { key: 'lmstudio', label: 'LM Studio' },
      { key: 'openwebui', label: 'Open WebUI' },
      { key: 'vllm', label: 'vLLM' },
    ],
  },
];

/** Flat preset list for the icon picker (deduped by key, theme order preserved). */
export const CUSTOM_MODEL_ICON_OPTIONS: ModelIconOption[] = (() => {
  const seen = new Set<string>();
  const out: ModelIconOption[] = [];
  for (const g of CUSTOM_MODEL_ICON_GROUPS) {
    for (const opt of g.options) {
      if (seen.has(opt.key)) continue;
      seen.add(opt.key);
      out.push(opt);
    }
  }
  return out;
})();

/** Synthetic Auto row — same shape as API models. */
export const AUTO_MODEL: LlmModel = {
  id: 'auto',
  label: 'Auto',
  provider: 'system',
  kind: 'text',
};

function resolveModelIconKey(model?: ModelIconRef | null): string {
  return String(model?.iconKey || model?.icon_key || '').toLowerCase().trim();
}

function resolveModelIconSrc(model?: ModelIconRef | null): string | null {
  const remote = String(model?.iconUrl || model?.icon_url || '').trim();
  if (remote) return remote;
  const key = resolveModelIconKey(model);
  if (key && MODEL_ICON_BY_KEY[key]) return MODEL_ICON_BY_KEY[key];
  const id = String(model?.id || '').toLowerCase().trim();
  const provider = String(model?.provider || '').toLowerCase().trim();
  const label = String(model?.label || '').toLowerCase().trim();
  if (!id && !provider && !label) return null;
  if (id === 'auto' || provider === 'system' || label === 'auto') return null;
  const blob = `${id} ${provider} ${label}`;
  for (const rule of MODEL_ICON_RULES) {
    if (rule.test(blob)) return rule.src;
  }
  if (provider && MODEL_ICON_BY_PROVIDER[provider]) return MODEL_ICON_BY_PROVIDER[provider];
  return null;
}

function ModelBrandIcon({
  model,
  className,
  size = 16,
}: {
  model?: ModelIconRef | null;
  className?: string;
  size?: number;
}) {
  const src = resolveModelIconSrc(model);
  if (!src) {
    return (
      <HiOutlineBookOpen
        size={size}
        className={cn('shrink-0 text-[var(--muted)]', className)}
        aria-hidden
      />
    );
  }
  // Mono SVGs use currentColor → render black via <img>; keep light chip (no dark tile).
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={cn('shrink-0 object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}

export type ModelPickerTab = 'design' | 'image' | 'video';

/** Shared surface chrome for model / route popovers. */
const PANEL_SHELL =
  'box-border min-w-0 max-w-[calc(100vw-24px)] rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_12px_40px_rgba(0,0,0,0.18)]';

/** Model popovers (editor + home) — icon + name rows; hug content. */
export const AGENT_POPOVER_PANEL = cn(
  PANEL_SHELL,
  'w-[min(220px,calc(100vw-24px))] overflow-hidden'
);

/** Route-prefs primary panel — compact; fits 模型 + 设计强度 rows. */
export const AGENT_ROUTE_POPOVER_PANEL = cn(
  PANEL_SHELL,
  'w-[min(220px,calc(100vw-24px))] max-h-[min(480px,calc(100vh-24px))] overflow-x-hidden overflow-y-auto'
);

/** Route field / preset side flyout 鈥?300px. */
export const AGENT_ROUTE_SUBMENU_PANEL = cn(
  PANEL_SHELL,
  'w-[min(300px,calc(100vw-24px))] max-h-[min(520px,calc(100vh-24px))] overflow-y-auto'
);

/** 1 = 渚垮疁 路 2 = 閫備腑 路 3 = 杈冭吹 (matches catalog price bands). */
export type ModelPriceLevel = 1 | 2 | 3;

export function parseModelPriceAmount(raw?: string | null): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(String(raw).trim().split(/\s+/)[0] || '');
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Map catalog `price` 鈫?relative cost level for the orange dots. */
export function modelPriceLevel(
  m: Pick<LlmModel, 'id' | 'kind' | 'price' | 'provider'> | null | undefined
): ModelPriceLevel | null {
  if (!m || m.id === 'auto' || m.provider === 'system' || isCustomModelId(m.id)) return null;
  const n = parseModelPriceAmount(m.price);
  if (n == null) return null;
  if (isImageKind(m)) {
    if (n <= 0.25) return 1;
    if (n <= 0.4) return 2;
    return 3;
  }
  // Text: display 鍏?鐧句竾 tokens
  if (n < 1) return 1;
  if (n < 8) return 2;
  return 3;
}

/** Orange-dot cost tag (title row, top-right) 鈥?same pattern as video model picker. */
function ModelPriceTag({
  level,
  label,
}: {
  level: ModelPriceLevel;
  label: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={label}>
      <span className="inline-flex items-center gap-[3px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'h-[5px] w-[5px] rounded-full',
              i <= level ? 'bg-[#f07818]' : 'bg-[#f07818]/30'
            )}
          />
        ))}
      </span>
      <span className="text-[11px] leading-none text-[var(--muted)]">{label}</span>
    </span>
  );
}

/** Soft pill for meta labels (鑷畾涔?/ 澶氭ā鎬? 鈥?matches saved-provider kind tags. */
function ModelMetaBadge({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-lg bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] leading-none text-[var(--muted)]">
      {label}
    </span>
  );
}

export function isUserCustomModel(
  m: Pick<LlmModel, 'id' | 'provider'> | null | undefined
): boolean {
  if (!m) return false;
  return isCustomModelId(m.id) || m.provider === 'custom';
}

/** Dots + relative cost label (渚垮疁 / 閫備腑 / 杈冭吹) 鈥?no raw 楼 amounts. */
export function modelPriceTagInfo(
  m: Pick<LlmModel, 'id' | 'kind' | 'price' | 'provider'> | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string
): { level: ModelPriceLevel; label: string } | null {
  const level = modelPriceLevel(m);
  if (!level) return null;
  if (level === 1) return { level, label: t('agent.priceCheap') };
  if (level === 2) return { level, label: t('agent.priceFair') };
  return { level, label: t('agent.priceCostly') };
}

export function modelTabOf(m: Pick<LlmModel, 'kind' | 'id'> | null | undefined): ModelPickerTab {
  if (isVideoKind(m)) return 'video';
  return isImageKind(m) ? 'image' : 'design';
}

export function modelDescription(
  m: LlmModel,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (m.id === 'auto') return t('agent.modelDescAuto');
  if (isUserCustomModel(m)) return t('agent.modelDescCustom');
  // Prefer per-model catalog copy from the API (admin / seed), not a kind-wide fallback.
  const fromCatalog = String(m.description || '').trim();
  if (fromCatalog) return fromCatalog;
  if (modelIsImageGenerator(m) || m.kind === 'image') return t('agent.modelDescImage');
  if (m.thinking || m.id.includes('reasoner')) return t('agent.modelDescReasonerDesign');
  const vision = modelSupportsVisionInput(m);
  if (m.id.includes('deepseek')) {
    return vision ? t('agent.modelDescDeepseekVision') : t('agent.modelDescDeepseekDesign');
  }
  return vision ? t('agent.modelDescChatVision') : t('agent.modelDescChatDesign');
}

type Props = {
  /** Filters the list: design (=agent/ask) vs image models. */
  tab: ModelPickerTab;
  /** Optional 鈥?kept for callers; mode switch lives in the composer toolbar. */
  onTabChange?: (tab: ModelPickerTab) => void;
  models: LlmModel[];
  selectedId: string;
  onPick: (id: string) => void;
  /** idle | loading | ready | error 鈥?drives empty / loading / error copy. */
  status?: 'idle' | 'loading' | 'ready' | 'error';
  /** Free plan: show all models; only Auto + fixed free image model are selectable. */
  autoOnly?: boolean;
  /** Optional header (e.g. route-prefs field submenu title). */
  title?: string;
  /** Skip injecting the Auto row for design tab (route lane pickers). */
  hideAuto?: boolean;
  /** Use `models` as-is (route field opts already filtered). */
  useModelsAsIs?: boolean;
  /**
   * popover 鈥?standalone card (image/video mode).
   * submenu 鈥?narrower card beside AgentRoutePrefsEditor rows.
   * plain 鈥?list only (parent supplies chrome / Back).
   */
  chrome?: 'popover' | 'submenu' | 'plain';
  /** Called with pointerdown on a row 鈥?keep parent floating menus focused. */
  onRowPointerDown?: (e: { preventDefault: () => void }) => void;
  className?: string;
};

function filterPickerModels(opts: {
  pool: LlmModel[];
  tab: ModelPickerTab;
  useModelsAsIs: boolean;
  hideAuto: boolean;
  autoLabel: string;
}): LlmModel[] {
  const { pool, tab, useModelsAsIs, hideAuto, autoLabel } = opts;
  if (useModelsAsIs) return dedupeModelsById(pool);

  if (tab === 'image') {
    return dedupeModelsById(pool.filter((m) => isImageKind(m)));
  }
  if (tab === 'video') {
    return dedupeModelsById(pool.filter((m) => isVideoKind(m)));
  }

  const design = pool.filter(
    (m) => !isImageKind(m) && !isVideoKind(m) && m.id !== 'auto'
  );
  if (hideAuto) {
    return dedupeModelsById(design);
  }
  const autoRow = pool.find((m) => m.id === 'auto') || {
    ...AUTO_MODEL,
    label: autoLabel,
  };
  return dedupeModelsById([autoRow, ...design]);
}

function shellClassForChrome(chrome: NonNullable<Props['chrome']>): string {
  switch (chrome) {
    case 'submenu':
      return AGENT_ROUTE_SUBMENU_PANEL;
    case 'plain':
      return 'w-full min-w-0';
    default:
      return AGENT_POPOVER_PANEL;
  }
}

function listClassForChrome(
  chrome: NonNullable<Props['chrome']>,
  title?: string
): string {
  switch (chrome) {
    case 'plain':
      return 'pt-0.5';
    case 'submenu':
      return 'overflow-y-auto px-1.5 pb-1.5 pt-0.5';
    default:
      return cn(
        'max-h-[min(360px,calc(100vh-160px))] overflow-y-auto px-1.5 pb-1.5',
        title ? 'pt-0.5' : 'pt-1.5'
      );
  }
}

/**
 * Shared model picker 鈥?one list UI for home, editor, and route-prefs field submenus.
 */
function ModelPickerPanel({
  tab,
  models,
  selectedId,
  onPick,
  status = 'ready',
  autoOnly = false,
  title,
  hideAuto = false,
  useModelsAsIs = false,
  chrome = 'popover',
  onRowPointerDown,
  className,
}: Props): ReactNode {
  const { t } = useTranslation();

  const catalogLoading =
    models.length === 0 && (status === 'loading' || status === 'idle');

  const filtered = filterPickerModels({
    pool: models,
    tab,
    useModelsAsIs,
    hideAuto,
    autoLabel: t('agent.autoToggle'),
  });

  const shell = shellClassForChrome(chrome);

  const list = (
    <div className={cn('min-w-0', listClassForChrome(chrome, title))}>
      {status === 'error' && models.length === 0 ? (
        <div className="px-2 py-4 text-center text-[12px] text-[var(--muted)]">
          <p>{t('agent.apiDown')}</p>
          <p className="mt-1">{t('agent.apiDownHint')}</p>
        </div>
      ) : catalogLoading ? (
        <BrandWordmarkLoader
          label={t('home.composerModelsLoading')}
          className="px-2 py-8"
        />
      ) : !filtered.length ? (
        <div className="px-2 py-6 text-center text-[12px] text-[var(--muted)]">
          {t('agent.emptyModels')}
        </div>
      ) : (
        filtered.map((m) => {
          const selected = m.id === selectedId;
          const freePick = m.id === 'auto' || m.id === FREE_IMAGE_MODEL_ID;
          const locked = autoOnly && !freePick;
          const tip = locked
            ? t('agent.freeModelLocked')
            : autoOnly && freePick
              ? t('agent.freeModelItemHint')
              : undefined;
          return (
            <button
              key={m.id}
              type="button"
              disabled={locked}
              title={tip}
              className={cn(
                'flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg px-2 py-2 text-left text-[var(--ink)] transition-colors',
                selected && !locked ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]',
                locked && 'cursor-not-allowed opacity-45 hover:bg-transparent'
              )}
              onPointerDown={onRowPointerDown}
              onClick={() => {
                if (locked) return;
                onPick(m.id);
              }}
            >
              <ModelBrandIcon model={m} size={18} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                {m.label || m.id}
              </span>
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <div className={cn(shell, 'flex flex-col', className)}>
      {title ? (
        <div className="px-3 pt-2.5 pb-1">
          <p className="truncate text-[12px] font-medium text-[var(--muted)]">{title}</p>
        </div>
      ) : null}
      {list}
    </div>
  );
}

export default memo(ModelPickerPanel);

const MemoizedModelBrandIcon = memo(ModelBrandIcon);
export { MemoizedModelBrandIcon as ModelBrandIcon };
const MemoizedModelPriceTag = memo(ModelPriceTag);
export { MemoizedModelPriceTag as ModelPriceTag };
const MemoizedModelMetaBadge = memo(ModelMetaBadge);
export { MemoizedModelMetaBadge as ModelMetaBadge };
