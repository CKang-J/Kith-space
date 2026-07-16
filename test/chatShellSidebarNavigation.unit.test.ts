import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const frame = read("../web/src/shell/WorkspaceFrame.tsx");
const chatWorkspace = read("../web/src/shell/ChatWorkspace.tsx");
const moduleNavigation = read("../web/src/shell/SidebarModuleNavigation.tsx");
const quickSwitcher = read("../web/src/QuickSwitcher.tsx");
const topBar = read("../web/src/shell/WorkspaceTopBar.tsx");
const sidebar = read("../web/src/views/ChatSidebar.tsx");
const conversations = read("../web/src/views/ConversationListContent.tsx");
const archivedChannels = read("../web/src/views/ArchivedChannelGroup.tsx");
const route = read("../web/src/shell/workspaceRoute.ts");
const shellCss = read("../web/src/shell/shell.css");
const globalCss = read("../web/src/styles.css");
const messageCss = read("../web/src/views/chat-message/chatMessage.css");

test("ChatOnly uses the shared module registry as a vertical text navigation without Chat", () => {
  assert.match(moduleNavigation, /dockModulesForSpace\(isHome\)/);
  assert.match(moduleNavigation, /sidebar-module-navigation__label/);
  assert.doesNotMatch(moduleNavigation, /MessageCircle/);
  assert.match(frame, /<SidebarModuleNavigation/);
  assert.match(frame, /moduleNavigation=\{sidebarModuleNavigation\}/);
});

test("Ctrl+K is the categorized global search and its visible entry lives above sidebar modules", () => {
  assert.match(moduleNavigation, /sidebar-search-trigger/);
  assert.match(moduleNavigation, /<Search size=\{18\}/);
  assert.match(frame, /event\.key\.toLowerCase\(\) !== "k"/);
  assert.match(frame, /<QuickSwitcher onClose=/);
  assert.doesNotMatch(topBar, /<Search\b|QuickSwitcher|onOpenSearch|shell-topbar__tools/);
  assert.match(quickSwitcher, /\/api\/messages\/search\?q=/);
  assert.match(quickSwitcher, /sectionChannelMessages/);
  assert.match(quickSwitcher, /sectionTopicMessages/);
  assert.match(quickSwitcher, /sectionDmMessages/);
  assert.match(quickSwitcher, /threadMsg=\$\{message\.id\}/);
  assert.match(frame, /params\.delete\("threadMsg"\)/);
  assert.doesNotMatch(quickSwitcher, /qs-foot|<kbd/);
  assert.match(globalCss, /\.qs-bg\{[^}]*align-items:center[^}]*padding:48px 16px/);
  assert.match(globalCss, /\.qs\{[^}]*max-height:min\(640px,calc\(100dvh - 96px\)\)[^}]*border-radius:20px/);
  assert.match(globalCss, /\.qs-list\{[^}]*overflow-y:auto[^}]*scrollbar-width:none/);
  assert.match(globalCss, /\.qs-list::\-webkit-scrollbar\{display:none\}/);
});

test("the horizontal Dock only mounts in ModuleWorkspace", () => {
  const chatWorkspaceUsage = frame.match(/<ChatWorkspace[\s\S]*?\/>/)?.[0] ?? "";
  assert.doesNotMatch(chatWorkspace, /dock\?: ReactNode|shell-dock-zone/);
  assert.doesNotMatch(chatWorkspaceUsage, /\bdock=/);
  assert.match(frame, /<ModuleWorkspace[\s\S]*?dock=\{animatedLayout\.activeModule !== null \? dock : undefined\}/);
});

test("persistent sidebar and Split drawer compose the correct navigation layers", () => {
  assert.match(sidebar, /moduleNavigation/);
  assert.match(sidebar, /<ConversationListContent/);
  assert.match(sidebar, /<LiveAgentBar/);
  const persistentSidebar = sidebar.match(/export function ChatSidebar[\s\S]*?export function ConversationDrawerSidebar/)?.[0] ?? "";
  assert.doesNotMatch(persistentSidebar, /sb-title|nav\.channel/);
  assert.match(sidebar, /export function ConversationDrawerSidebar/);
  assert.match(sidebar, /conversation-drawer-sidebar[\s\S]*?sb-title/);
  assert.match(chatWorkspace, /<ConversationDrawerSidebar/);
  assert.doesNotMatch(conversations, /showcase|Showcase|LiveAgentBar|SidebarModuleNavigation/);
});

test("Showcase is not a product chat route", () => {
  assert.doesNotMatch(route, /\| "showcase"|section === "showcase"/);
  assert.doesNotMatch(chatWorkspace, /Showcase|\/showcase/);
  assert.match(frame, /if \(retiredShowcaseRoute && !fallbackConversationId\) return/);
  assert.match(frame, /retiredShowcaseRoute \? fallbackChatPathname : rememberedChatPathname/);
  assert.match(frame, /workspaceSearchForShellState\(location\.search, normalizationLayout\)/);
});

test("conversation selection exposes aria-current instead of relying only on color", () => {
  assert.match(conversations, /aria-current=\{channel\.id === channelId \? "page" : undefined\}/);
  assert.match(conversations, /aria-current=\{onSaved \? "page" : undefined\}/);
  assert.match(conversations, /aria-current=\{conversation\.id === channelId \? "page" : undefined\}/);
});

test("channel rows use an icon instead of a text hash", () => {
  assert.match(conversations, /import \{[^}]*Hash[^}]*\} from "lucide-react"/);
  assert.match(conversations, /<Hash size=\{14\} className="channel-row-icon" aria-hidden="true" \/>/);
  assert.doesNotMatch(conversations, /<span className="grow"># \{channel\.name\}<\/span>/);
  assert.match(archivedChannels, /<Hash size=\{14\} className="channel-row-icon" aria-hidden="true" \/>/);
  assert.doesNotMatch(archivedChannels, /# \{channel\.name\}/);
});

test("the shell preserves the Chat card while the conversation navigation sits directly on the canvas", () => {
  assert.match(shellCss, /\.shell-work-panel\s*\{[\s\S]*?border-radius:\s*var\(--shell-radius\)/);
  assert.match(shellCss, /\.shell-chat-workspace--full > \.shell-chat-conversations\s*\{[\s\S]*?margin-right:\s*var\(--shell-gap\)/);
  assert.match(shellCss, /\.shell-chat-conversations\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent/);
  assert.doesNotMatch(shellCss.match(/\.sidebar-module-navigation\s*\{([^}]*)\}/)?.[1] ?? "", /border/);
  assert.doesNotMatch(shellCss.match(/\.shell-chat-conversations > \.sidebar\s*\{([^}]*)\}/)?.[1] ?? "", /border-right/);
  assert.match(shellCss, /\.shell-chat-conversations > \.sidebar\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(shellCss, /\.sidebar-module-navigation__item\s*\{[\s\S]*?padding:\s*0 10px 0 4px/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.archived-channel-group,[\s\S]*?border-top:\s*0/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.live-bar\s*\{[\s\S]*?border-top:\s*0;[\s\S]*?background:\s*transparent/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.chan-row \+ \.chan-row\s*\{[\s\S]*?margin-top:\s*4px/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.item:hover:not\(\.active\)\s*\{[\s\S]*?background:\s*#ececeb/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.item\.active,[\s\S]*?\.chat-navigation-sidebar \.item\.active:hover\s*\{[\s\S]*?background:\s*#ffffff/);
  assert.match(shellCss, /\.shell-chat-drawer > \.sidebar\s*\{[\s\S]*?border:\s*0/);
  assert.match(globalCss, /\.sb-title\{[^}]*font-family:var\(--sans\)/);
  assert.match(messageCss, /\.chat-message\{[\s\S]*?margin:0 auto 20px/);
  assert.match(globalCss, /\.composer-box\{[^}]*margin:0 auto/);
});

test("ChatOnly and Split share the same content gutter and Chat pane floor", () => {
  const fullWorkspace = shellCss.match(/\.shell-chat-workspace--full\s*\{([^}]*)\}/)?.[1] ?? "";
  const compactWorkspace = shellCss.match(/\.shell-chat-workspace--compact\s*\{([^}]*)\}/)?.[1] ?? "";
  const fullChatCard = shellCss.match(/\.shell-chat-workspace--full > \.shell-chat-main-card\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(fullWorkspace, /--chat-stream-gutter:\s*10px/);
  assert.match(compactWorkspace, /--chat-stream-gutter:\s*10px/);
  assert.match(fullChatCard, /min-width:\s*360px/);
});
