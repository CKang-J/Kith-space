import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const frame = read("../web/src/shell/WorkspaceFrame.tsx");
const chatWorkspace = read("../web/src/shell/ChatWorkspace.tsx");
const moduleNavigation = read("../web/src/shell/SidebarModuleNavigation.tsx");
const navigationRail = read("../web/src/shell/WorkspaceNavigationRail.tsx");
const workspaceTabs = read("../web/src/shell/WorkspaceTabs.tsx");
const sidebarComponent = read("../web/src/components/ui/sidebar.tsx");
const spaceSwitcher = read("../web/src/SpaceSwitcher.tsx");
const quickSwitcher = read("../web/src/QuickSwitcher.tsx");
const messageSearchResultRow = read("../web/src/quick-switcher/MessageSearchResultRow.tsx");
const sidebar = read("../web/src/views/ChatSidebar.tsx");
const composer = read("../web/src/views/Composer.tsx");
const conversations = read("../web/src/views/ConversationListContent.tsx");
const archivedChannels = read("../web/src/views/ArchivedChannelGroup.tsx");
const route = read("../web/src/shell/workspaceRoute.ts");
const shellCss = read("../web/src/shell/shell.css");
const globalCss = read("../web/src/styles.css");
const messageCss = read("../web/src/views/chat-message/chatMessage.css");
const modelSettingsCss = read("../web/src/views/model-settings/modelSettings.css");
const settingsView = read("../web/src/views/misc.tsx");
const sidebarPreview = read("../web/src/shell/useSidebarEdgePreview.ts");

test("ChatOnly uses the persistent shadcn Sidebar with modules and conversations", () => {
  assert.match(navigationRail, /<Sidebar[\s\S]*?collapsible="offcanvas"/);
  assert.match(navigationRail, /<SidebarHeader/);
  assert.match(navigationRail, /<SidebarContent>/);
  assert.match(navigationRail, /<SidebarFooter>/);
  assert.match(navigationRail, /<SidebarRail \/>/);
  assert.match(navigationRail, /<ConversationListContent/);
  assert.doesNotMatch(navigationRail, /tooltip=/);
  assert.match(sidebarComponent, /return <SidebarMenuButtonWithTooltip button=\{button\} tooltip=\{tooltip\} \/>/);
  assert.match(navigationRail, /activeModule === module\.id/);
  assert.match(frame, /<WorkspaceNavigationRail/);
  assert.match(navigationRail, /<SpaceSwitcher/);
  assert.match(frame, /<SidebarProvider/);
  assert.match(frame, /<SidebarInset/);
  assert.doesNotMatch(frame, /<WorkspaceTopBar|shell-topbar/);
  assert.match(shellCss, /\.shell-workspace-canvas\s*\{[^}]*padding:\s*0/);
  assert.match(shellCss, /--shell-gap:\s*0/);
  assert.match(shellCss, /\.shell-sidebar-provider\s*\{[^}]*--sidebar-width:\s*260px/);
  assert.match(shellCss, /\.workspace-sidebar__header\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--sidebar-border\)/);
  assert.match(shellCss, /\.workspace-sidebar__conversations\s*\{[^}]*min-height:\s*0/);
});

test("aggregate panel touches Chat with one divider and becomes a drawer below its inline width", () => {
  assert.match(frame, /const aggregateInlineAvailable = aggregateAvailable && aggregateConstraints\.canShow/);
  assert.match(frame, /const aggregateDrawerOpen = aggregateAvailable && !aggregateInlineAvailable && aggregateOpen && !settingsDrawerOpen/);
  assert.match(frame, /aggregateDrawer=\{aggregateAvailable && !aggregateInlineAvailable \? aggregatePanel : undefined\}/);
  assert.match(frame, /\{aggregateInlineAvailable \? \(\s*<aside[\s\S]*?shell-conversation-aggregate/);
  assert.match(frame, /aria-hidden=\{!aggregateVisible\}/);
  assert.doesNotMatch(frame, /shell-aggregate-gap/);
  assert.doesNotMatch(shellCss, /shell-aggregate-gap/);
  assert.match(shellCss, /\.shell-conversation-aggregate\s*\{[^}]*border-left:\s*1px solid var\(--shell-border\)/);
  assert.match(chatWorkspace, /className="shell-chat-aggregate-layer"/);
  assert.match(chatWorkspace, /aria-label="聚合面板"/);
  assert.match(chatWorkspace, /aggregateLayerRef\.current\?\.toggleAttribute\("inert", !aggregateDrawerOpen\)/);
  assert.match(shellCss, /\.shell-chat-aggregate-layer\s*\{\s*z-index:\s*33/);
  assert.match(shellCss, /\.shell-chat-aggregate-layer\[data-open="true"\] \.shell-chat-aggregate-drawer\s*\{[^}]*width:\s*min\(340px,\s*92%\)/);
});

test("Space switcher uses a shadcn menu with themed layering and locks an edge preview while open", () => {
  assert.match(spaceSwitcher, /<DropdownMenu open=\{open\} onOpenChange=\{handleOpenChange\}>/);
  assert.match(spaceSwitcher, /<DropdownMenuTrigger asChild>/);
  assert.match(spaceSwitcher, /<DropdownMenuContent[\s\S]*?side="right"[\s\S]*?className="w-80 min-w-80 max-w-\[calc\(100vw-1rem\)\] p-1.5"/);
  assert.match(spaceSwitcher, /<DropdownMenuLabel>/);
  assert.match(spaceSwitcher, /<DropdownMenuGroup>/);
  assert.match(spaceSwitcher, /<DropdownMenuSeparator \/>/);
  assert.match(spaceSwitcher, /bg-accent font-medium text-accent-foreground focus:bg-accent/);
  assert.match(spaceSwitcher, /onMenuOpenChange\?\.\(true\)/);
  assert.match(spaceSwitcher, /onMenuOpenChange\?\.\(false\)/);
  assert.doesNotMatch(spaceSwitcher, /className="brand"[^>]*title=/);
  assert.doesNotMatch(spaceSwitcher, /sw-pop|sw-backdrop|sw-item/);
  assert.match(navigationRail, /const spaceMenuOpenRef = useRef\(false\)/);
  assert.match(navigationRail, /const handlePreviewLeave[\s\S]*?!spaceMenuOpenRef\.current\) onPreviewLeave\(\)/);
  assert.match(navigationRail, /const handleSpaceMenuOpenChange[\s\S]*?spaceMenuOpenRef\.current = open[\s\S]*?if \(open\) \{[\s\S]*?onPreviewEnter\(\)/);
  assert.match(navigationRail, /onMenuOpenChange=\{handleSpaceMenuOpenChange\}/);
  assert.match(shellCss, /\.workspace-navigation-rail__space:has\(\[data-slot="dropdown-menu-trigger"\]\[data-state="open"\]\)::after\s*\{[^}]*opacity:\s*0/s);
  assert.match(shellCss, /html\[data-kith-desktop-platform="darwin"\] \.shell-sidebar-provider:is\([\s\S]*?\[data-sidebar-preview="opening"\],[\s\S]*?\[data-sidebar-preview="open"\],[\s\S]*?\[data-sidebar-preview="closing"\][\s\S]*?\) \.workspace-sidebar__header\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/);
});

test("Ctrl+K and the rail Search icon open the categorized global search", () => {
  assert.match(moduleNavigation, /sidebar-search-trigger/);
  assert.match(moduleNavigation, /<Search size=\{21\}/);
  assert.match(frame, /event\.key\.toLowerCase\(\) !== "k"/);
  assert.match(frame, /<QuickSwitcher onClose=/);
  assert.match(frame, /const openQuickSwitcher = useCallback\(\(\) => setQuickSwitcherOpen\(true\), \[\]\)/);
  assert.match(frame, /onSearch=\{openQuickSwitcher\}/);
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

test("Cmd/Ctrl+B toggles the Sidebar without taking over editable controls", () => {
  const shortcut = fs.readFileSync(new URL("../web/src/shell/sidebarKeyboardShortcut.ts", import.meta.url), "utf8");
  assert.match(frame, /import \{ isSidebarToggleShortcut \} from "\.\/sidebarKeyboardShortcut\.ts"/);
  assert.match(frame, /const toggleSidebarFromShortcut = \(event: KeyboardEvent\) => \{[\s\S]*?isSidebarToggleShortcut\(event\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?updateSidebarOpen\(!sidebarOpen\)/);
  assert.match(frame, /window\.addEventListener\("keydown", toggleSidebarFromShortcut\)/);
  assert.match(shortcut, /event\.key\.toLowerCase\(\) === "b"/);
  assert.match(shortcut, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(shortcut, /!event\.isComposing[\s\S]*?!event\.repeat[\s\S]*?!event\.altKey[\s\S]*?!event\.shiftKey/);
  assert.match(shortcut, /input, textarea, select, \[contenteditable\], \[role=/);
});

test("the Sidebar remains mounted while Chat and a module share the workspace", () => {
  assert.doesNotMatch(frame, /WorkspaceDock|shell-dock-zone|toggleChatPane/);
  assert.match(frame, /const chatVisible = true/);
  assert.match(frame, /<WorkspaceNavigationRail/);
  assert.match(frame, /<ChatWorkspace/);
  assert.match(frame, /activeTab && contentModuleId \? \([\s\S]*?<WorkspaceTabs[\s\S]*?<ModuleWorkspace/);
  assert.match(workspaceTabs, /<Tabs[\s\S]*?<TabsList[\s\S]*?<TabsTrigger/);
  assert.match(workspaceTabs, /<Popover[\s\S]*?<Plus \/>/);
  assert.doesNotMatch(frame, /contentModuleId \? \([\s\S]*?<ChatSidebar/);
});

test("collapsed Sidebar previews from the window edge and workspaces auto-collapse it once", () => {
  assert.match(frame, /useSidebarEdgePreview\(\{[\s\S]*?collapsed: !sidebarOpen,[\s\S]*?disabled: sidebarTransitioning/);
  assert.match(frame, /retainPreview: retainSidebarPreview/);
  assert.match(frame, /data-sidebar-preview=\{sidebarPreviewState\}/);
  assert.match(frame, /!sidebarOpen && !sidebarTransitioning/);
  assert.match(frame, /className="shell-sidebar-edge-trigger fixed inset-y-0 left-0 z-40"/);
  assert.match(shellCss, /\.shell-sidebar-provider[\s\S]*?\[data-slot="sidebar"\]\[data-collapsible="offcanvas"\][\s\S]*?\[data-slot="sidebar-rail"\]\s*\{[\s\S]*?display:\s*none;[\s\S]*?pointer-events:\s*none;[\s\S]*?cursor:\s*default/);
  assert.match(frame, /activeWorkspaceKey = activeTab \? `\$\{workspaceStorageId\}:\$\{activeTab\.id\}` : null/);
  assert.match(frame, /const collapseSidebar = useCallback\(\(\) => updateSidebarOpen\(false\)/);
  assert.match(frame, /useAutoCollapseSidebarForWorkspace\([\s\S]*?activeWorkspaceKey,[\s\S]*?collapseSidebar/);
  assert.match(navigationRail, /onPointerEnter=\{handlePreviewEnter\}/);
  assert.match(navigationRail, /onPointerLeave=\{handlePreviewLeave\}/);
  assert.match(navigationRail, /onTransitionEnd=\{onPreviewTransitionEnd\}/);
  assert.match(sidebarPreview, /SIDEBAR_PREVIEW_INTENT_DELAY_MS = 85/);
  assert.match(sidebarPreview, /SIDEBAR_PREVIEW_CLOSE_DELAY_MS = 260/);
  assert.match(sidebarPreview, /SIDEBAR_PREVIEW_CLOSE_FALLBACK_MS = 240/);
  assert.match(sidebarPreview, /"closed" \| "intent" \| "opening" \| "open" \| "closing"/);
  assert.match(sidebarPreview, /const retainPreview[\s\S]*?previewStateRef\.current === "closed"[\s\S]*?if \(previewStateRef\.current === "closing"\) updatePreviewState\("open"\)/);
  assert.match(sidebarPreview, /if \(current === "closing"\) \{[\s\S]*?updatePreviewState\("open"\);[\s\S]*?return/);
  assert.match(sidebarPreview, /completePreviewOpenAfterPaint[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) =>/);
  assert.match(sidebarPreview, /updatePreviewState\("closing"\)/);
  assert.match(sidebarPreview, /event\.key !== "Escape"/);
  assert.match(sidebarPreview, /event\.propertyName !== "transform"/);
  assert.match(shellCss, /width:\s*calc\(var\(--sidebar-width\) \+ 24px\)/);
  assert.match(shellCss, /\.shell-sidebar-provider:is\([\s\S]*?\[data-sidebar-preview="opening"\],[\s\S]*?\[data-sidebar-preview="open"\],[\s\S]*?\[data-sidebar-preview="closing"\][\s\S]*?\)[\s\S]*?> \.shell-sidebar-edge-trigger/);
  assert.match(shellCss, /@media \(min-width: 48rem\) and \(hover: hover\) and \(pointer: fine\)/);
  assert.match(frame, /SIDEBAR_LAYOUT_MOTION_MS = 420/);
  assert.match(frame, /data-sidebar-transitioning=\{sidebarTransitioning \? "true" : undefined\}/);
  assert.match(frame, /const CHAT_ONLY_PANE_STYLE: CSSProperties = \{[\s\S]*?width: "auto"[\s\S]*?flexBasis: 0[\s\S]*?flexGrow: 1[\s\S]*?flexShrink: 1/);
  assert.match(frame, /const chatPaneStyle = activeTab \? undefined : CHAT_ONLY_PANE_STYLE/);
  assert.match(frame, /style=\{chatPaneStyle\}/);
  assert.match(frame, /WORKSPACE_WIDTH_SETTLE_MS = 80/);
  assert.match(frame, /const observer = new ResizeObserver\(scheduleWidthUpdate\)/);
  assert.match(chatWorkspace, /export const ChatWorkspace = memo\(function ChatWorkspace/);
  assert.match(navigationRail, /export const WorkspaceNavigationRail = memo\(function WorkspaceNavigationRail/);
  assert.match(frame, /onNavigateConversation=\{navigateConversation\}/);
  assert.match(frame, /onModuleSelect=\{selectSidebarModule\}/);
  assert.match(shellCss, /--shell-sidebar-motion-duration:\s*420ms;[\s\S]*?--shell-sidebar-motion-easing:\s*cubic-bezier\(\.25, \.8, \.25, 1\)/);
  assert.match(shellCss, /> \[data-slot="sidebar"\]\[data-side="left"\]\s*\{[^}]*width:\s*var\(--sidebar-width\);[^}]*flex:\s*0 0 var\(--sidebar-width\);[^}]*overflow:\s*visible;[^}]*transition:\s*width var\(--shell-sidebar-motion-duration\) var\(--shell-sidebar-motion-easing\),[\s\S]*?flex-basis var\(--shell-sidebar-motion-duration\) var\(--shell-sidebar-motion-easing\)/);
  assert.match(shellCss, /> \[data-slot="sidebar"\]\[data-side="left"\]\[data-collapsible="offcanvas"\]\s*\{[^}]*width:\s*0;[^}]*flex-basis:\s*0/);
  assert.match(shellCss, /\[data-slot="sidebar-gap"\]\s*\{[^}]*display:\s*none/);
  assert.match(shellCss, /\[data-slot="sidebar-container"\]\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*left:\s*auto;[^}]*transform:\s*none;[^}]*transition:\s*none/);
  assert.match(shellCss, /\.shell-sidebar-provider:not\(\[data-sidebar-transitioning="true"\]\):is\([\s\S]*?\[data-sidebar-preview="opening"\],[\s\S]*?\[data-sidebar-preview="open"\],[\s\S]*?\[data-sidebar-preview="closing"\][\s\S]*?\)[\s\S]*?\[data-slot="sidebar-container"\]\s*\{[\s\S]*?z-index:\s*50;[\s\S]*?border-radius:\s*0 16px 16px 0;[\s\S]*?box-shadow:[\s\S]*?opacity:\s*1;[\s\S]*?transition-property:\s*transform, opacity;[\s\S]*?transition-duration:\s*230ms;[\s\S]*?cubic-bezier\(\.16, 1, \.3, 1\);[\s\S]*?will-change:\s*transform, opacity/);
  assert.match(shellCss, /\.shell-sidebar-provider:not\(\[data-sidebar-transitioning="true"\]\)\[data-sidebar-preview="open"\][\s\S]*?\[data-slot="sidebar-container"\]\s*\{[^}]*transform:\s*translate3d\(0, 0, 0\)/);
  assert.match(shellCss, /\.shell-sidebar-provider:not\(\[data-sidebar-transitioning="true"\]\)\[data-sidebar-preview="closing"\][\s\S]*?\[data-slot="sidebar-container"\]\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?pointer-events:\s*none;[\s\S]*?transition-duration:\s*120ms;[\s\S]*?cubic-bezier\(\.2, \.8, \.2, 1\)/);
  assert.doesNotMatch(shellCss, /\[data-sidebar-preview="closing"\][\s\S]*?\[data-slot="sidebar-inner"\]\s*\{[^}]*opacity:\s*0/);
  assert.match(shellCss, /\.shell-sidebar-provider\[data-sidebar-transitioning="true"\][\s\S]*?:is\([\s\S]*?\.shell-chat-workspace,[\s\S]*?\.shell-module-workspace[\s\S]*?\)\s*\{[^}]*transition:\s*none/);
  assert.match(shellCss, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.shell-sidebar-provider > \[data-slot="sidebar"\]\[data-side="left"\],[\s\S]*?transition:\s*none/);
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
  assert.match(settingsDialog, /max-w-\[960px\]/);
  assert.doesNotMatch(settingsDialog, /max-w-\[1180px\]/);
  assert.match(frame, /toggleAttribute\("inert", settingsOpen\)/);
  assert.match(frame, /navigateLayout\(INITIAL_WORKSPACE_LAYOUT, \{ replace: true \}\)/);
  assert.match(settingsView, /moduleId: "settings", settings: key/);
  assert.match(settingsView, /aria-current=\{cur === key \? "page" : undefined\}/);
  assert.match(settingsView, /data-slot="settings-content"/);
  assert.match(settingsView, /data-slot="settings-page-header"/);
  assert.match(settingsView, /data-slot="settings-page-content"/);
  assert.match(settingsView, /cur === "human" \|\| cur === "space"[\s\S]*?"max-w-\[520px\]"/);
  assert.match(settingsView, /cur === "appearance"[\s\S]*?"max-w-3xl"/);
  assert.equal((settingsView.match(/className=\{cn\("mx-auto w-full", pageColumnClass\)\}/g) ?? []).length, 2);
  assert.match(modelSettingsCss, /\.model-settings \.settings-switch\s*\{[^}]*display:\s*inline-flex;[^}]*margin:\s*0;[^}]*text-transform:\s*none/s);
  assert.match(settingsDialog, /flex-col sm:flex-row/);
  assert.doesNotMatch(moduleWorkspace, /moduleId === "settings"|<Settings/);
});

test("the middle message pane owns only grouped conversation navigation", () => {
  assert.doesNotMatch(sidebar, /moduleNavigation|SidebarModuleNavigation|SpaceSwitcher/);
  assert.match(sidebar, /chat-navigation-sidebar__header/);
  assert.match(sidebar, /t\("nav\.messages"\)/);
  assert.match(sidebar, /<ConversationListContent/);
  assert.doesNotMatch(sidebar, /LiveAgentBar|live-agent-bar|live-bar/);
  assert.match(composer, /<ConversationActivityStatus channelId=\{channelId\} \/>/);
  assert.doesNotMatch(sidebar, /ConversationDrawerSidebar|conversation-drawer-sidebar/);
  assert.doesNotMatch(chatWorkspace, /compact|drawerOpen|ConversationDrawerSidebar/);
  assert.match(shellCss, /\.chat-navigation-sidebar \.sec\s*\{[^}]*font-size:\s*var\(--font-size-meta\)\s*!important/s);
  assert.match(shellCss, /\.chat-navigation-sidebar \.chat-navigation-sidebar__scroll\s*\{[^}]*padding:\s*8px 12px 18px/s);
  assert.match(shellCss, /\.chat-navigation-sidebar \.conversation-saved-row \+ \.sec\s*\{[^}]*margin-top:\s*10px/s);
  assert.doesNotMatch(conversations, /showcase|Showcase|LiveAgentBar|SidebarModuleNavigation/);
  assert.match(conversations, /t\("common\.channels"\)/);
  assert.match(conversations, /t\("common\.directMessages"\)/);
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
  assert.match(conversations, /className="conversation-row__target"/);
  assert.match(conversations, /className="conversation-row__target"[\s\S]*?<span className="badge">\{unread\[channel\.id\]\}<\/span>[\s\S]*?<\/button>/);
  assert.match(conversations, /<button[\s\S]*?conversation-saved-row/);
  assert.match(moduleNavigation, /t\("nav\.inboxUnread", \{ count: unreadCount \}\)/);
});

test("channel rows use an icon instead of a text hash", () => {
  assert.match(conversations, /import \{[^}]*Hash[^}]*\} from "lucide-react"/);
  assert.match(
    conversations,
    /<button[\s\S]*?className="conversation-row__target"[\s\S]*?<span className="conversation-row__avatar conversation-row__avatar--channel">[\s\S]*?<Hash size=\{16\} className="channel-row-icon" aria-hidden="true" \/>/,
  );
  assert.doesNotMatch(conversations, /<span className="grow"># \{channel\.name\}<\/span>/);
  assert.match(archivedChannels, /<Hash size=\{14\} className="channel-row-icon" aria-hidden="true" \/>/);
  assert.doesNotMatch(archivedChannels, /# \{channel\.name\}/);
});

test("the shell uses semantic theme tokens, a full Sidebar, and tabbed workspace", () => {
  assert.match(globalCss, /--ui-canvas-bg:var\(--background\)/);
  assert.match(globalCss, /--ui-muted-bg:var\(--muted\)/);
  assert.match(globalCss, /--secondary:#f2f3f3/);
  assert.match(globalCss, /--canvas:var\(--background\)/);
  assert.match(globalCss, /--surface-strong:var\(--muted\)/);
  assert.match(globalCss, /--sidebar:#fafafa/);
  assert.match(globalCss, /--sidebar-accent:#f5f5f5/);
  assert.match(
    globalCss,
    /\.dark\s*\{[\s\S]*?--background:#0a0a0a[\s\S]*?--card:#181818[\s\S]*?--sidebar:#171717[\s\S]*?--sidebar-accent:#343434/,
  );
  assert.match(shellCss, /--shell-bg:\s*var\(--background\)/);
  assert.match(shellCss, /\.shell-work-panel\s*\{[\s\S]*?border-radius:\s*var\(--shell-radius\)/);
  assert.match(shellCss, /--shell-panel-shadow:\s*none/);
  assert.match(shellCss, /\.shell-work-panel\s*\{[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*var\(--shell-panel-shadow\)/);
  assert.match(shellCss, /\.workspace-sidebar__conversations \.item:hover:not\(\.active\)\s*\{[^}]*background:\s*var\(--sidebar-accent\)/);
  assert.match(shellCss, /\.shell-chat-workspace\s*\{[\s\S]*?border-right:\s*1px solid var\(--shell-border\)/);
  assert.match(shellCss, /\.shell-tab-workspace\s*\{[^}]*background:\s*var\(--card\)/);
  assert.match(shellCss, /\.shell-workspace-tabs\s*\{[^}]*background:\s*var\(--card\)/);
  assert.doesNotMatch(shellCss, /\.shell-workspace-tabs\s*\{[^}]*border-bottom:/);
  assert.match(shellCss, /\.shell-workspace-tab\s*\{[^}]*height:\s*28px/);
  assert.match(shellCss, /\.shell-workspace-tab:hover,\s*\.shell-workspace-tab:has\(\[data-state="active"\]\)\s*\{[^}]*background:\s*var\(--muted\)/);
  assert.match(shellCss, /\.shell-workspace-tab__trigger\s*\{[^}]*padding-right:\s*0;[^}]*padding-left:\s*8px/);
  assert.match(shellCss, /\.shell-workspace-tab__close\s*\{[^}]*margin-right:\s*2px;[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none/);
  assert.match(shellCss, /\.shell-workspace-tab:hover \.shell-workspace-tab__close,[\s\S]*?\.shell-workspace-tab:has\(\[data-state="active"\]\) \.shell-workspace-tab__close\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;[^}]*pointer-events:\s*auto/);
  assert.match(shellCss, /\.shell-workspace-tab \.shell-workspace-tab__close:hover\s*\{[^}]*background:\s*color-mix\(in oklch,\s*var\(--muted\) 92%,\s*var\(--foreground\)\)/);
  assert.match(shellCss, /\.shell-workspace-tab__content\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?background:\s*var\(--card\)/);
  assert.match(frame, /<ConversationAggregatePanel[\s\S]*?onClose=\{toggleAggregate\}/);
  assert.match(frame, /<WorkspaceTabs[\s\S]*?<ModuleWorkspace/);
  assert.match(globalCss, /\.seg-pill\{[^}]*background:var\(--ui-muted-bg\)/);
  assert.match(globalCss, /\.seg\{[^}]*background:var\(--ui-muted-bg\)/);
  assert.match(globalCss, /\.seg button\.on\{background:var\(--surface\)/);
  assert.match(globalCss, /\.sb-title\{[^}]*font-family:var\(--sans\)/);
  assert.match(messageCss, /\.chat-message\{[\s\S]*?margin:0 auto 26px/);
  assert.match(globalCss, /\.composer-box\{[^}]*margin:0 auto/);
});

test("macOS integrates the native drag region into the interactive workspace headers", () => {
  assert.doesNotMatch(shellCss, /body::before\s*\{[^}]*-webkit-app-region:\s*drag/);
  assert.match(
    shellCss,
    /html\[data-kith-desktop-platform="darwin"\]\s*:is\([\s\S]*?\.workspace-sidebar__header,[\s\S]*?\.chat-head,[\s\S]*?\.conversation-aggregate__topbar,[\s\S]*?\.shell-workspace-tabs[\s\S]*?\)\s*\{[^}]*-webkit-app-region:\s*drag/,
  );
  assert.match(shellCss, /\[role="tablist"\][\s\S]*?\{\s*-webkit-app-region:\s*no-drag/);
  assert.match(
    shellCss,
    /html\[data-kith-desktop-platform="darwin"\]\s+\.shell-sidebar-trigger\s*\{[^}]*position:\s*fixed;[^}]*left:\s*88px;[^}]*z-index:\s*60;[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*pointer-events:\s*auto;[^}]*-webkit-app-region:\s*no-drag/,
  );
  assert.doesNotMatch(shellCss, /\.peer\[data-state="collapsed"\][^{]*\.shell-sidebar-trigger\s*\{/);
  assert.match(
    shellCss,
    /\.shell-chat-main-card\s+\.chat-head__rail\s*\{[^}]*padding-left:\s*38px/,
  );
  assert.match(
    shellCss,
    /\.shell-conversation-aggregate \.conversation-aggregate__topbar,[\s\S]*?\.shell-chat-settings-drawer \.channel-settings__header\s*\{[^}]*padding-right:\s*38px/,
  );
  assert.match(
    shellCss,
    /html\[data-kith-desktop-platform="darwin"\]\s+\.shell-chat-main-card\s+\.chat-head__rail\s*\{[^}]*padding-left:\s*0;[^}]*transition:\s*padding-left var\(--shell-sidebar-motion-duration\) var\(--shell-sidebar-motion-easing\)/,
  );
  assert.match(
    shellCss,
    /\.peer\[data-state="collapsed"\]\s*~\s*\.shell-workspace-inset\s+\.shell-chat-main-card\s+\.chat-head__rail\s*\{[^}]*padding-left:\s*112px/,
  );
  assert.match(
    shellCss,
    /html\[data-kith-desktop-platform="darwin"\]\s+\.shell-workspace-tabs--expanded\s*\{[^}]*padding-left:\s*112px/,
  );
  assert.match(
    shellCss,
    /html\[data-kith-desktop-platform="darwin"\]\s+\.shell-workspace-tabs__list\s*\{[^}]*height:\s*28px;[^}]*padding:\s*0/,
  );
  assert.match(
    shellCss,
    /\.peer\[data-state="collapsed"\]\s*~\s*\.shell-workspace-inset\s+\.shell-chat-main-card\s+\.chat-head::before\s*\{[^}]*width:\s*120px;[^}]*pointer-events:\s*none;[^}]*-webkit-app-region:\s*no-drag/,
  );
  assert.match(sidebarComponent, /state === "expanded" \? PanelLeftCloseIcon : PanelLeftOpenIcon/);
  assert.match(shellCss, /\.shell-workspace-tabs\s+:is\(button,\s*\[role="tab"\]\)\s*>\s*svg\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px/);
  assert.match(globalCss, /\.chat-head-icon-btn>svg\{width:14px;height:14px\}/);
  assert.match(globalCss, /\.chat-head__channel-title \.channel-row-icon\{width:14px;height:14px/);
});

test("Chat keeps the approved content gutter and primary-card floor", () => {
  const fullWorkspace = shellCss.match(/\.shell-chat-workspace--full\s*\{([^}]*)\}/)?.[1] ?? "";
  const fullChatCard = shellCss.match(/\.shell-chat-workspace--full > \.shell-chat-main-card\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(fullWorkspace, /--chat-stream-gutter:\s*16px/);
  assert.match(fullChatCard, /min-width:\s*340px/);
  assert.match(shellCss, /\.chat-thread-divider\s*\{[\s\S]*?width:\s*10px;[\s\S]*?flex:\s*0 0 10px/);
});
