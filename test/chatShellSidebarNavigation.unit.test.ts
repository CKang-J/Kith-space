import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const frame = read("../web/src/shell/WorkspaceFrame.tsx");
const chatWorkspace = read("../web/src/shell/ChatWorkspace.tsx");
const moduleNavigation = read("../web/src/shell/SidebarModuleNavigation.tsx");
const quickSwitcher = read("../web/src/QuickSwitcher.tsx");
const messageSearchResultRow = read("../web/src/quick-switcher/MessageSearchResultRow.tsx");
const workspaceContext = read("../web/src/shell/WorkspaceContextRow.tsx");
const sidebar = read("../web/src/views/ChatSidebar.tsx");
const conversations = read("../web/src/views/ConversationListContent.tsx");
const archivedChannels = read("../web/src/views/ArchivedChannelGroup.tsx");
const route = read("../web/src/shell/workspaceRoute.ts");
const shellCss = read("../web/src/shell/shell.css");
const globalCss = read("../web/src/styles.css");
const messageCss = read("../web/src/views/chat-message/chatMessage.css");
const modelSettingsCss = read("../web/src/views/model-settings/modelSettings.css");
const settingsView = read("../web/src/views/misc.tsx");

test("ChatOnly uses the shared module registry as a vertical text navigation without Chat", () => {
  assert.match(moduleNavigation, /sidebarModulesForSpace\(isHome\)/);
  assert.match(moduleNavigation, /sidebar-module-navigation__label/);
  assert.doesNotMatch(moduleNavigation, /MessageCircle/);
  assert.match(frame, /<SidebarModuleNavigation/);
  assert.match(frame, /<WorkspaceContextRow[\s\S]*?<SidebarModuleNavigation/);
  assert.match(frame, /moduleNavigation=\{sidebarModuleNavigation\}/);
  assert.doesNotMatch(frame, /<WorkspaceTopBar|shell-topbar/);
  assert.match(workspaceContext, /<SpaceSwitcher/);
  assert.match(shellCss, /\.shell-workspace-canvas\s*\{[^}]*padding:\s*var\(--shell-gap\)/);
  assert.match(shellCss, /--shell-gap:\s*10px/);
  assert.match(shellCss, /--shell-radius:\s*18px/);
  assert.match(shellCss, /\.shell-chat-workspace--full\s*\{[^}]*overflow:\s*visible/, "ChatOnly layout must not clip panel edge shadows");
});

test("Ctrl+K is the categorized global search and its visible entry lives above sidebar modules", () => {
  assert.match(moduleNavigation, /sidebar-search-trigger/);
  assert.match(moduleNavigation, /<Search size=\{18\}/);
  assert.match(frame, /event\.key\.toLowerCase\(\) !== "k"/);
  assert.match(frame, /<QuickSwitcher onClose=/);
  assert.doesNotMatch(workspaceContext, /<Search\b|QuickSwitcher|onOpenSearch|shell-topbar__tools/);
  assert.match(quickSwitcher, /\/api\/messages\/search\?q=/);
  assert.match(quickSwitcher, /sectionChannelMessages/);
  assert.match(quickSwitcher, /sectionTopicMessages/);
  assert.match(quickSwitcher, /sectionDmMessages/);
  assert.match(quickSwitcher, /<MessageSearchResultRow result=\{item\.message\} query=\{query\}/);
  assert.match(messageSearchResultRow, /qs-message-result__heading/);
  assert.match(messageSearchResultRow, /qs-message-result__preview/);
  assert.match(messageSearchResultRow, /messageSearchTextSegments/);
  assert.match(messageSearchResultRow, /relativeTimeLabel/);
  assert.match(quickSwitcher, /threadMsg=\$\{message\.id\}/);
  assert.match(frame, /params\.delete\("threadMsg"\)/);
  assert.doesNotMatch(quickSwitcher, /qs-foot|<kbd/);
  assert.match(globalCss, /\.qs-bg\{[^}]*align-items:center[^}]*padding:48px 16px/);
  assert.match(globalCss, /\.qs\{[^}]*max-height:min\(640px,calc\(100dvh - 96px\)\)[^}]*border-radius:20px/);
  assert.match(globalCss, /\.qs-list\{[^}]*overflow-y:auto[^}]*scrollbar-width:none/);
  assert.match(globalCss, /\.qs-list::\-webkit-scrollbar\{display:none\}/);
  assert.match(globalCss, /\.qs-item--message\{[^}]*min-height:58px/);
  assert.match(globalCss, /\.qs-message-result__match\{[^}]*color:#0675f7/);
});

test("sidebar navigation remains mounted when a module replaces Chat", () => {
  assert.doesNotMatch(frame, /WorkspaceDock|shell-dock-zone|toggleChatPane/);
  assert.match(frame, /contentModuleId \? \([\s\S]*?<ChatSidebar[\s\S]*?moduleNavigation=\{sidebarModuleNavigation\}/);
  assert.match(frame, /contentModuleId \? \([\s\S]*?<ModuleWorkspace/);
  assert.match(moduleNavigation, /aria-current=\{active \? "page" : undefined\}/);
});

test("settings opens as a modal instead of a module workspace", () => {
  const settingsDialog = read("../web/src/shell/SettingsDialog.tsx");
  const moduleWorkspace = read("../web/src/shell/ModuleWorkspace.tsx");
  assert.match(frame, /settingsOpen \? \([\s\S]*?<SettingsDialog/);
  assert.match(settingsDialog, /role="dialog"/);
  assert.match(settingsDialog, /aria-modal="true"/);
  assert.match(settingsDialog, /<Settings sectionOverride=/);
  assert.match(settingsDialog, /querySelector\("\.settings-modal-backdrop"\)/);
  assert.match(settingsDialog, /event\.key !== "Tab"/);
  assert.match(frame, /toggleAttribute\("inert", settingsOpen\)/);
  assert.match(frame, /navigateLayout\(INITIAL_WORKSPACE_LAYOUT, \{ replace: true \}\)/);
  assert.match(settingsView, /moduleId: "settings", settings: k \}\), \{ replace: true \}/);
  assert.match(modelSettingsCss, /\.model-settings \.settings-switch\s*\{[^}]*display:\s*inline-flex;[^}]*margin:\s*0;[^}]*text-transform:\s*none/s);
  assert.match(shellCss, /@media \(max-width: 640px\)[\s\S]*?\.shell-settings-dialog__content\s*\{[^}]*flex-direction:\s*column/);
  assert.doesNotMatch(moduleWorkspace, /moduleId === "settings"|<Settings/);
});

test("persistent sidebar owns module and conversation navigation in every primary-card state", () => {
  assert.match(sidebar, /moduleNavigation/);
  assert.match(sidebar, /<ConversationListContent/);
  assert.match(sidebar, /<LiveAgentBar/);
  assert.doesNotMatch(sidebar, /ConversationDrawerSidebar|conversation-drawer-sidebar/);
  assert.doesNotMatch(chatWorkspace, /compact|drawerOpen|ConversationDrawerSidebar/);
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
  assert.match(globalCss, /--ui-canvas-bg:#eeeeee/);
  assert.match(globalCss, /--ui-muted-bg:#ececec/);
  assert.match(globalCss, /--canvas:var\(--ui-canvas-bg\)/);
  assert.match(globalCss, /--surface-strong:var\(--ui-muted-bg\)/);
  assert.match(shellCss, /--shell-bg:\s*var\(--ui-canvas-bg\)/);
  assert.match(shellCss, /\.shell-work-panel\s*\{[\s\S]*?border-radius:\s*var\(--shell-radius\)/);
  assert.doesNotMatch(shellCss, /--shell-panel-outline/);
  assert.match(shellCss, /--shell-panel-shadow:[\s\S]*?0 1px 1px rgb\(0 0 0 \/ 8%\)[\s\S]*?inset 0 1px 0 rgb\(255 255 255 \/ 72%\)/);
  assert.doesNotMatch(shellCss, /0 5px 14px/);
  assert.match(shellCss, /\.shell-work-panel\s*\{[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*var\(--shell-panel-shadow\)/);
  assert.match(shellCss, /\.shell-chat-workspace--full > \.shell-chat-conversations\s*\{[\s\S]*?margin-right:\s*var\(--shell-gap\)/);
  assert.match(shellCss, /\.shell-chat-conversations\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none/);
  assert.doesNotMatch(shellCss, /shell-chat-workspace--compact|shell-chat-drawer/);
  assert.match(shellCss, /\.shell-conversation-aggregate > \.conversation-aggregate\s*\{[\s\S]*?border-left:\s*0/);
  assert.doesNotMatch(shellCss.match(/\.sidebar-module-navigation\s*\{([^}]*)\}/)?.[1] ?? "", /border/);
  assert.doesNotMatch(shellCss.match(/\.shell-chat-conversations > \.sidebar\s*\{([^}]*)\}/)?.[1] ?? "", /border-right/);
  assert.match(shellCss, /\.shell-chat-conversations > \.sidebar\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(shellCss, /\.sidebar-module-navigation__item\s*\{[\s\S]*?padding:\s*0 10px 0 4px/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.archived-channel-group,[\s\S]*?border-top:\s*0/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.live-bar\s*\{[\s\S]*?border-top:\s*0;[\s\S]*?background:\s*transparent/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.chan-row \+ \.chan-row\s*\{[\s\S]*?margin-top:\s*4px/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.item:hover:not\(\.active\)\s*\{[\s\S]*?background:\s*var\(--ui-muted-bg\)/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.item\.active,[\s\S]*?\.chat-navigation-sidebar \.item\.active:hover\s*\{[\s\S]*?background:\s*var\(--ui-muted-bg\)/);
  assert.match(globalCss, /\.seg-pill\{[^}]*background:var\(--ui-muted-bg\)/);
  assert.match(globalCss, /\.seg\{[^}]*background:var\(--ui-muted-bg\)/);
  assert.match(globalCss, /\.seg button\.on\{background:var\(--surface\)/);
  assert.match(globalCss, /\.sb-title\{[^}]*font-family:var\(--sans\)/);
  assert.match(messageCss, /\.chat-message\{[\s\S]*?margin:0 auto 20px/);
  assert.match(globalCss, /\.composer-box\{[^}]*margin:0 auto/);
});

test("Chat keeps the approved content gutter and primary-card floor", () => {
  const fullWorkspace = shellCss.match(/\.shell-chat-workspace--full\s*\{([^}]*)\}/)?.[1] ?? "";
  const fullChatCard = shellCss.match(/\.shell-chat-workspace--full > \.shell-chat-main-card\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(fullWorkspace, /--chat-stream-gutter:\s*10px/);
  assert.match(fullChatCard, /min-width:\s*360px/);
});
