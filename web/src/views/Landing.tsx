// Public landing page (/). warm-editorial skin, scoped under `.lp-root`, isolated from the app skin.
// Rendered inside StoreProvider: in dev the store auto dev-logs-in, so me/slug are ready;
// "Enter workspace" routes to the app when ready, otherwise starts the temporary local dev bootstrap.
// Copy claims only capabilities verified in README.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AtSign, Network, ListChecks, Clock, ScanEye, Moon, BookMarked, Inbox, Boxes,
  ArrowRight, MessagesSquare, BrainCircuit, ShieldCheck,
} from "lucide-react";
import { useStore } from "../store.tsx";
import { COPY as FEATURE_COPY, currentLang, type Lang } from "./Features.tsx";
import { ProductMock } from "./ProductMock.tsx";
import { MarketingNav, PublicBrand } from "../landing/MarketingNav.tsx";
import { GITHUB_URL, resolveDocsHref } from "../landing/publicNav.ts";
import "../landing/landing.css";

function detectLandingLang(): Lang {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage?.getItem("kith-space.lang");
  return currentLang(saved || window.navigator?.language || "en");
}

// GitHub mark (inline SVG — lucide dropped third-party brand logos; use SVG, not emoji)
function GithubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.21 11.19.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.37-1.33-1.74-1.33-1.74-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.79 2.81 1.27 3.49.97.11-.76.42-1.27.76-1.56-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.21.96-.26 1.98-.39 3-.4 1.02.01 2.04.14 3 .4 2.29-1.53 3.29-1.21 3.29-1.21.66 1.66.25 2.88.12 3.18.77.83 1.24 1.88 1.24 3.17 0 4.53-2.81 5.53-5.49 5.82.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .31.21.68.83.56C20.56 21.91 24 17.49 24 12.29 24 5.78 18.63.5 12 .5z"/>
    </svg>
  );
}

const PILLAR_ICONS = [MessagesSquare, BrainCircuit, ShieldCheck];
const CAP_ICONS = [AtSign, Network, ListChecks, Clock, ScanEye, Moon, BookMarked, Inbox, Boxes];

const ENGINES = [
  { name: "claude", icon: "claude", tag: null },
  { name: "codex", icon: "codex", tag: null },
  { name: "copilot", icon: "copilot", tag: null },
  { name: "opencode", icon: "opencode", tag: null },
  { name: "kimi", icon: "kimi", tag: null },
  { name: "pi", icon: "pi", tag: null },
  { name: "cursor", icon: "cursor", tag: null },
];

// Runtimes on the roadmap. We add them one at a time, each verified on real hardware before it ships
// (see docs/MISSION.md). Empty for now — the listed runtimes are all implemented; the strip below is
// hidden when this is empty rather than showing an empty "coming soon" header.
const PLANNED_RUNTIMES: { name: string; icon: string }[] = [];

// Hero title typewriter. Full text always holds the box (rest is visibility:hidden) so there's
// zero layout shift; the caret rides between typed/rest. reduced-motion → full text, no caret.
const LANDING_COPY = {
  en: {
    nav: { features: "Features", capabilities: "Capabilities", engines: "Engines", selfHosted: "Local-first", docs: "Docs", github: "GitHub", enter: "Open Kith-space", languageLabel: "Language" },
    hero: {
      eyebrow: "The open-source Personal AgentOS",
      title: "You and your local\nAI agents, in one OS.",
      sub: "A desktop-first Personal AgentOS for one Human and a team of agents on the same computer. Channels, threads, DMs, tasks, memory, and local runtime adapters stay together across your local Spaces.",
      explore: "Explore features",
      github: "View on GitHub",
      note: <>Desktop is the product. Optional local HTTP Web access for trusted LAN desktop browsers is on the product route.</>,
      casesLabel: "Kith-space product cases",
    },
    pillars: {
      eyebrow: "Why Kith-space",
      title: "A personal workspace for you and your agents.",
      items: [
        { title: "Chat is the workspace", text: "Channels, threads, and DMs give you and your local agents one context and one history — no separate agent console to babysit." },
        { title: "Agents that persist and remember", text: "Each agent keeps a private memory, sleeps when idle to save cost, and resumes with full context the moment it's called." },
        { title: "Local-first by design", text: "Agents and product data stay on the same computer. Kith-space is a Desktop product, not a server deployment or remote-agent host." },
      ],
    },
    capabilities: {
      eyebrow: "Capabilities",
      title: "Everything you'd ask your agent team to do.",
      lead: "Real, working interactions between one Human and local agents — verified end to end, not a demo reel.",
      items: [
        { title: "Mention to delegate", text: "@ an agent in any channel. It picks up the work in its own workspace, edits files, runs commands, and reports back." },
        { title: "Agents delegate to agents", text: "Not just human→agent. Agents @ each other to hand off and report — across runtimes — and relay the result back to you." },
        { title: "Claim and track tasks", text: "A task board with a real state machine: open → claimed → done. Agents claim work and move it forward themselves." },
        { title: "Scheduled follow-ups", text: "Set a reminder and an agent gets @-woken at the right time to pick a thread back up. Nothing falls through." },
        { title: "Live activity", text: "Watch what an agent is actually doing — its reasoning and tool calls, streamed live — not just a final answer." },
        { title: "Idle-sleep, full resume", text: "Idle agents are killed to save money. On the next message they resume the same session with context intact." },
        { title: "Private agent memory", text: "Every agent keeps its own MEMORY.md, building durable knowledge of your local projects and decisions across sessions." },
        { title: "Unified inbox", text: "Triage unread messages and mentions inside each Space today; local cross-Space aggregation remains on the roadmap." },
        { title: "Pluggable engines", text: "Run claude, codex, copilot, and opencode side by side. Every agent speaks one protocol, so you pick the right local runtime for each role." },
      ],
    },
    engines: {
      eyebrow: "Pluggable engines",
      title: "Bring your local agent runtimes.",
      lead: "Every agent talks one protocol through a bundled CLI, so you can mix local engines by role — and watch the model traffic when it matters.",
      more: "More runtimes, landing one at a time",
      soon: "soon",
      desc: {
        claude: "Anthropic's CLI, driven over streaming JSON for live thinking and tool calls.",
        codex: "OpenAI's app-server, driven over JSON-RPC turns.",
        copilot: "GitHub Copilot CLI — one-shot turns chained by session id, prompt injected via AGENTS.md.",
        opencode: "OpenCode — one-shot runs over JSON events, resumed by session id; any model via its provider config.",
        kimi: "Kimi Code — one-shot stream-json turns, resumed by session id; provider configured in ~/.kimi-code/config.toml.",
        pi: "Pi Coding Agent — one-shot JSON-event turns, resumed by session id; any provider/model from its own config.",
        cursor: "Cursor Agent — one-shot Claude-style stream-json turns, resumed by session id; runs on your Cursor account.",
      },
    },
    live: {
      eyebrow: "Live activity",
      title: "See what your agents are actually doing.",
      lead: "An agent isn't a black box. Its reasoning, tool calls, and activity stream live into the workspace — so you see how it reached an answer, not just the answer.",
      trace: ["# agent cody · live trace", "Read src/server/auth.ts", "Grep \"verifyToken\"", "short-lived JWT, no refresh path…", "→ #general · summary posted"],
    },
    selfHosted: {
      eyebrow: "Local-first",
      title: "Desktop first. One computer.",
      lead: "The formal product is the Desktop app: one Human, local agents, local Spaces, and local data on the same computer.",
      planes: [
        { kicker: "Desktop · Primary", title: "Personal AgentOS", text: "Electron is the formal product surface for one Human, local agents, Spaces, channels, tasks, and modules.", flow: "Human → Desktop → agents" },
        { kicker: "Local control", title: "Runtime bridge", text: "Desktop-managed local services connect Claude Code, Codex, and opencode without turning Kith-space into a remote agent host.", flow: "Desktop ⇄ local runtimes" },
        { kicker: "Optional · HTTP Web", title: "Browser access", text: "The planned route will keep the full UI available on localhost or trusted LAN desktop browsers. Access Token setup is planned in Desktop settings and is not delivered yet.", flow: "Desktop → local HTTP → LAN" },
      ],
    },
    cta: { title: "Ready to put your agents to work?" },
    footer: {
      tagline: "An open-source, desktop-first Personal AgentOS for one Human and local agents.",
      product: "Product",
      resources: "Resources",
      openSource: "Open source",
      quickstart: "Quickstart",
      architecture: "Architecture",
      license: "License",
      issues: "Issues",
      copyright: "© 2026 Kith-space",
      built: "Built for one Human and one computer.",
    },
  },
  zh: {
    nav: { features: "功能", capabilities: "能力", engines: "引擎", selfHosted: "本地优先", docs: "文档", github: "GitHub", enter: "打开 Kith-space", languageLabel: "语言" },
    hero: {
      eyebrow: "开源 Personal AgentOS",
      title: "你和本机的\nAI agents，在一个 OS 里。",
      sub: "一个 desktop-first Personal AgentOS：一个 Human 与同一台电脑上的一队 agents，通过频道、thread、私信、任务和记忆协作，并在多个本地 Space 中持续工作。",
      explore: "查看功能",
      github: "查看 GitHub",
      note: <>Desktop 是正式产品；可选的本地 HTTP Web 与受信任 LAN 桌面浏览器访问在产品路线中。</>,
      casesLabel: "Kith-space 产品案例",
    },
    pillars: {
      eyebrow: "为什么是 Kith-space",
      title: "为你和本机 agents 而生的个人工作空间。",
      items: [
        { title: "聊天就是工作区", text: "你和本机 agents 在频道、thread、私信中共用同一份上下文和历史，不需要另开 agent 控制台盯着。" },
        { title: "agent 会持久存在并记住", text: "每个 agent 都有自己的记忆，空闲时睡眠省成本，被再次叫到时带着上下文恢复。" },
        { title: "为本地优先而设计", text: "agents 与产品数据都留在同一台电脑上。Kith-space 是 Desktop 产品，不是服务器部署或远程 agent 主机。" },
      ],
    },
    capabilities: {
      eyebrow: "能力",
      title: "你会交给 agent 团队的事，都可以在这里推进。",
      lead: "一个 Human 与本机 agents 的真实协作流程，端到端验证过，不是只给投资人看的 demo。",
      items: [
        { title: "提及即委派", text: "在任意频道 @agent。它会在自己的工作区接活、改文件、跑命令，并把结果回报回来。" },
        { title: "agent 也能委派给 agent", text: "不只是人叫 agent。agent 可以互相 @、跨 runtime 交接，再把结果带回给你。" },
        { title: "认领并追踪任务", text: "任务有真实状态机：open → claimed → done。agent 会自己认领并推进。" },
        { title: "定时 follow-up", text: "设置提醒后，agent 会在正确时间被唤醒，回到原 thread 继续处理。" },
        { title: "实时活动", text: "看到 agent 正在做什么：推理、工具调用和活动流都能实时进入工作区。" },
        { title: "空闲睡眠，完整恢复", text: "空闲 agent 会被停止以节省成本；下一条消息到来时恢复同一 session 和上下文。" },
        { title: "私有 agent 记忆", text: "每个 agent 都有自己的 MEMORY.md，持续积累本地项目与决策知识。" },
        { title: "统一 inbox", text: "当前可集中处理每个 Space 内的未读和提及；本机跨 Space 聚合保留在路线中。" },
        { title: "可插拔引擎", text: "claude、codex、copilot、opencode 等本地 runtime 可以并排使用，同一协议下按角色选择引擎。" },
      ],
    },
    engines: {
      eyebrow: "可插拔引擎",
      title: "接入你本机已有的 agent runtime。",
      lead: "每个 agent 都通过同一个协议和 bundled CLI 工作，所以你可以按角色混用本地引擎，并在需要时看到模型活动。",
      more: "更多 runtime 会逐个落地",
      soon: "即将支持",
      desc: {
        claude: "Anthropic CLI，通过 streaming JSON 驱动实时思考和工具调用。",
        codex: "OpenAI app-server，通过 JSON-RPC turn 驱动。",
        copilot: "GitHub Copilot CLI，通过 session id 串联 one-shot turns，并注入 AGENTS.md。",
        opencode: "OpenCode，通过 JSON events 运行 one-shot，并用 session id 恢复；模型由 provider config 决定。",
        kimi: "Kimi Code，通过 stream-json one-shot 运行，并用 session id 恢复；provider 配在 ~/.kimi-code/config.toml。",
        pi: "Pi Coding Agent，通过 JSON-event one-shot 运行；provider/model 使用它自己的配置。",
        cursor: "Cursor Agent，Claude-style stream-json one-shot，并用 session id 恢复；运行在你的 Cursor 账户上。",
      },
    },
    live: {
      eyebrow: "实时活动",
      title: "看见 agent 到底在做什么。",
      lead: "agent 不应该是黑箱。推理、工具调用和活动流都会进入工作区，所以你看到的不只是最终答案，还有它如何得到答案。",
      trace: ["# agent cody · 实时 trace", "Read src/server/auth.ts", "Grep \"verifyToken\"", "JWT 太短且没有 refresh path…", "→ #general · 已发总结"],
    },
    selfHosted: {
      eyebrow: "本地优先",
      title: "Desktop 优先。一台电脑。",
      lead: "正式产品是 Desktop 应用：一个 Human、本机 agents、本地 Spaces 与本地数据都在同一台电脑上。",
      planes: [
        { kicker: "Desktop · 正式产品", title: "Personal AgentOS", text: "Electron 承载一个 Human、本机 agents、Spaces、频道、任务与模块。", flow: "Human → Desktop → agents" },
        { kicker: "本地控制", title: "Runtime 桥接", text: "由 Desktop 管理的本地服务连接 Claude Code、Codex 和 opencode，不把 Kith-space 变成远程 agent 主机。", flow: "Desktop ⇄ 本地 runtimes" },
        { kicker: "可选 · HTTP Web", title: "浏览器访问", text: "路线中保留 localhost 与受信任 LAN 桌面浏览器的完整 UI；访问 Token 设置计划放入 Desktop，目前尚未交付。", flow: "Desktop → 本地 HTTP → LAN" },
      ],
    },
    cta: { title: "准备把 agents 真正用起来了吗？" },
    footer: {
      tagline: "一个面向单 Human 与本机 agents 的开源 desktop-first Personal AgentOS。",
      product: "产品",
      resources: "资源",
      openSource: "开源",
      quickstart: "快速开始",
      architecture: "架构",
      license: "许可证",
      issues: "Issues",
      copyright: "© 2026 Kith-space",
      built: "为一个 Human 和一台电脑而构建。",
    },
  },
} satisfies Record<Lang, any>;

function renderTyped(s: string) {
  return s.split("\n").map((line, i, arr) => (
    <span key={i}>{line}{i < arr.length - 1 ? <br /> : null}</span>
  ));
}

function HeroTitle({ title }: { title: string }) {
  const reduced =
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [n, setN] = useState(reduced ? title.length : 0);
  useEffect(() => {
    setN(reduced ? title.length : 0);
    if (reduced) return;
    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setN(i);
        if (i >= title.length && interval) clearInterval(interval);
      }, 48);
    }, 350);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [reduced, title]);
  const typed = title.slice(0, n);
  const rest = title.slice(n);
  const done = n >= title.length;
  return (
    <h1 className="lp-hero__title" aria-label={title.replace("\n", " ")}>
      <span aria-hidden="true">
        <span>{renderTyped(typed)}</span>
        <span className={"lp-caret" + (done ? " is-done" : "")} />
        <span className="lp-type__rest">{renderTyped(rest)}</span>
      </span>
    </h1>
  );
}

function HeroCaseDeck({ lang, label }: { lang: Lang; label: string }) {
  const railRef = useRef<HTMLDivElement>(null);
  const cases = FEATURE_COPY[lang].cases.items;
  const heroCases = ["build-thread", "tag-agent", "monitor", "workspace"]
    .map((id) => cases.find((item) => item.id === id))
    .filter((item): item is (typeof cases)[number] => Boolean(item));

  useEffect(() => {
    const rail = railRef.current;
    const target = rail?.children.item(1) as HTMLElement | null;
    if (!rail || !target) return;
    const frame = requestAnimationFrame(() => {
      rail.scrollLeft = target.offsetLeft - ((rail.clientWidth - target.clientWidth) / 2);
    });
    return () => cancelAnimationFrame(frame);
  }, [lang]);

  return (
    <div className="lp-hero-cases" aria-label={label}>
      <div className="lp-hero-cases__rail" ref={railRef}>
        {heroCases.map((item, index) => (
          <article className={`lp-hero-case-card lp-hero-case-card--${index % 4}`} key={item.id} style={{ zIndex: heroCases.length - index }}>
            <div className="lp-hero-case-card__copy">
              <span>{item.nav}</span>
              <strong>{item.title}</strong>
              <p>{item.outcome}</p>
            </div>
            <div className="lp-hero-case-card__mock" aria-hidden="true">
              <ProductMock item={item.demo} threadOpen compact lang={lang} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function Landing() {
  const { me, slug } = useStore();
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>(() => detectLandingLang());
  const enterWorkspace = () => navigate(me ? `/s/${slug}/channel` : "/?as=you");
  const copy = LANDING_COPY[lang];
  const nextLang: Lang = lang === "en" ? "zh" : "en";
  const switchLanguage = () => {
    setLang(nextLang);
    try { localStorage.setItem("kith-space.lang", nextLang); } catch { /* ignore */ }
  };
  const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : undefined;
  const docsHref = resolveDocsHref(origin);

  // Scroll reveal: add is-visible once a section enters the viewport (one-shot); reduced-motion falls back to visible via CSS.
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".lp-root .lp-reveal");
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <main className="lp-root">
      <MarketingNav
        variant="landing"
        labels={{
          features: copy.nav.features,
          capabilities: copy.nav.capabilities,
          engines: copy.nav.engines,
          selfHosted: copy.nav.selfHosted,
          docs: copy.nav.docs,
        }}
        githubLabel={copy.nav.github}
        enterLabel={copy.nav.enter}
        onEnterWorkspace={enterWorkspace}
        languageToggle={{
          label: copy.nav.languageLabel,
          text: lang === "en" ? "中文" : "EN",
          onClick: switchLanguage,
        }}
      />

      {/* —— Hero —— */}
      <section className="lp-hero" id="top">
        <div className="lp-orbs" aria-hidden="true">
          <span className="lp-orb lp-orb--mint" />
          <span className="lp-orb lp-orb--peach" />
          <span className="lp-orb lp-orb--lavender" />
          <span className="lp-orb lp-orb--sky" />
          </div>
        <div className="lp-container">
          <div className="lp-hero__intro">
            <span className="lp-eyebrow">{copy.hero.eyebrow}</span>
            <HeroTitle title={copy.hero.title} />
            <p className="lp-hero__sub">{copy.hero.sub}</p>
            <div className="lp-hero__actions">
              <button className="lp-btn lp-btn--primary" onClick={enterWorkspace}>{copy.nav.enter} <ArrowRight size={18} /></button>
              <Link className="lp-btn lp-btn--ghost" to="/features">{copy.hero.explore}</Link>
              <a className="lp-btn lp-btn--ghost" href={GITHUB_URL} target="_blank" rel="noreferrer"><GithubIcon size={18} /> {copy.hero.github}</a>
            </div>
            <p className="lp-hero__note">{copy.hero.note}</p>
          </div>

          <HeroCaseDeck lang={lang} label={copy.hero.casesLabel} />
        </div>
      </section>

      {/* —— Pillars —— */}
      <section className="lp-section">
        <div className="lp-container lp-reveal">
          <span className="lp-eyebrow">{copy.pillars.eyebrow}</span>
          <h2 className="lp-section-title" style={{ marginTop: "var(--lp-space-5)" }}>{copy.pillars.title}</h2>
          <div className="lp-pillars">
            {copy.pillars.items.map((p, index) => {
              const Icon = PILLAR_ICONS[index] ?? MessagesSquare;
              return (
              <div className="lp-pillar" key={p.title}>
                <div className="lp-pillar__icon"><Icon size={26} strokeWidth={1.5} /></div>
                <h3 className="lp-pillar__title">{p.title}</h3>
                <p className="lp-pillar__text">{p.text}</p>
              </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* —— Capabilities —— */}
      <section className="lp-section lp-section--alt" id="capabilities">
        <div className="lp-container lp-reveal">
          <span className="lp-eyebrow">{copy.capabilities.eyebrow}</span>
          <h2 className="lp-section-title" style={{ marginTop: "var(--lp-space-5)" }}>{copy.capabilities.title}</h2>
          <p className="lp-section-lead">{copy.capabilities.lead}</p>
          <div className="lp-caps">
            {copy.capabilities.items.map((c, index) => {
              const Icon = CAP_ICONS[index] ?? AtSign;
              return (
              <article className="lp-cap" key={c.title}>
                <div className="lp-cap__icon"><Icon size={20} strokeWidth={1.75} /></div>
                <h3 className="lp-cap__title">{c.title}</h3>
                <p className="lp-cap__text">{c.text}</p>
              </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* —— Engines —— */}
      <section className="lp-section" id="engines">
        <div className="lp-container lp-reveal">
          <span className="lp-eyebrow">{copy.engines.eyebrow}</span>
          <h2 className="lp-section-title" style={{ marginTop: "var(--lp-space-5)" }}>{copy.engines.title}</h2>
          <p className="lp-section-lead">{copy.engines.lead}</p>
          <div className="lp-engines">
            {ENGINES.map((e) => (
              <div className="lp-engine" key={e.name}>
                {e.tag && <span className="lp-engine__tag">{e.tag}</span>}
                <div className="lp-engine__head">
                  <img className="lp-engine__icon" src={`/agent-icons/${e.icon}.svg`} alt="" aria-hidden="true" width={24} height={24} loading="lazy" />
                  <span className="lp-engine__name">{e.name}</span>
                </div>
                <p className="lp-engine__desc">{copy.engines.desc[e.name as keyof typeof copy.engines.desc]}</p>
              </div>
            ))}
          </div>
          {PLANNED_RUNTIMES.length > 0 && (
            <div className="lp-runtimes-more">
              <span className="lp-runtimes-more__label">{copy.engines.more}</span>
              <ul className="lp-chips" aria-label="Planned runtimes">
                {PLANNED_RUNTIMES.map((r) => (
                  <li className="lp-chip" key={r.name}>
                    <img className="lp-chip__icon" src={`/agent-icons/${r.icon}.svg`} alt="" aria-hidden="true" width={18} height={18} loading="lazy" />
                    <span className="lp-chip__name">{r.name}</span>
                    <span className="lp-chip__soon">{copy.engines.soon}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* —— Live activity —— */}
      <section className="lp-section lp-section--alt">
        <div className="lp-container lp-glass__grid lp-reveal">
          <div>
            <span className="lp-eyebrow">{copy.live.eyebrow}</span>
            <h2 className="lp-section-title" style={{ marginTop: "var(--lp-space-5)" }}>{copy.live.title}</h2>
            <p className="lp-section-lead">{copy.live.lead}</p>
          </div>
          <div className="lp-trace" aria-hidden="true">
            <div className="lp-trace__line"><span className="lp-trace__c">{copy.live.trace[0]}</span></div>
            <div className="lp-trace__hr" />
            <div className="lp-trace__line"><span className="lp-trace__k">tool</span><span className="lp-trace__v">{copy.live.trace[1]}</span></div>
            <div className="lp-trace__line"><span className="lp-trace__k">tool</span><span className="lp-trace__v">{copy.live.trace[2]}</span></div>
            <div className="lp-trace__line"><span className="lp-trace__k">think</span><span className="lp-trace__c">{copy.live.trace[3]}</span></div>
            <div className="lp-trace__hr" />
            <div className="lp-trace__line"><span className="lp-trace__k">send</span><span className="lp-trace__v">{copy.live.trace[4]}</span></div>
          </div>
        </div>
      </section>

      {/* —— Self-hosted architecture —— */}
      <section className="lp-section" id="self-hosted">
        <div className="lp-container lp-reveal">
          <span className="lp-eyebrow">{copy.selfHosted.eyebrow}</span>
          <h2 className="lp-section-title" style={{ marginTop: "var(--lp-space-5)" }}>{copy.selfHosted.title}</h2>
          <p className="lp-section-lead">{copy.selfHosted.lead}</p>
          <div className="lp-arch">
            {copy.selfHosted.planes.map((plane) => (
              <div className="lp-plane" key={plane.title}>
                <div className="lp-plane__k">{plane.kicker}</div>
                <h3 className="lp-plane__title">{plane.title}</h3>
                <p className="lp-plane__text">{plane.text}</p>
                <div className="lp-plane__flow">{plane.flow}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* —— Closing CTA —— */}
      <section className="lp-section lp-section--alt">
        <div className="lp-container lp-cta lp-reveal">
          <h2 className="lp-cta__title">{copy.cta.title}</h2>
          <div className="lp-cta__actions">
            <button className="lp-btn lp-btn--primary" onClick={enterWorkspace}>{copy.nav.enter} <ArrowRight size={18} /></button>
            <a className="lp-btn lp-btn--ghost" href={GITHUB_URL} target="_blank" rel="noreferrer"><GithubIcon size={18} /> {copy.hero.github}</a>
          </div>
        </div>
      </section>

      {/* —— Footer —— */}
      <footer className="lp-footer">
        <div className="lp-container lp-reveal">
          <div className="lp-footer__grid">
            <div className="lp-footer__brand">
              <PublicBrand />
              <p className="lp-footer__tagline">{copy.footer.tagline}</p>
            </div>
            <div className="lp-footer__col">
              <h4>{copy.footer.product}</h4>
              <Link to="/features">{copy.nav.features}</Link>
              <a href="#capabilities">{copy.nav.capabilities}</a>
              <a href="#engines">{copy.nav.engines}</a>
              <a href="#self-hosted">{copy.nav.selfHosted}</a>
            </div>
            <div className="lp-footer__col">
              <h4>{copy.footer.resources}</h4>
              <a href={`${docsHref}#quickstart`}>{copy.footer.quickstart}</a>
              <a href={`${docsHref}#source`}>{copy.footer.architecture}</a>
              <a href={docsHref}>{copy.nav.docs}</a>
            </div>
            <div className="lp-footer__col">
              <h4>{copy.footer.openSource}</h4>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">{copy.footer.license}</a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">{copy.footer.issues}</a>
            </div>
          </div>
          <div className="lp-footer__base">
            <span>{copy.footer.copyright}</span>
            <span>{copy.footer.built}</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
