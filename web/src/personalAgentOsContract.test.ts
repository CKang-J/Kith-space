import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the frontend Store exposes one Human and agent-only collaboration", () => {
  const store = source("./store.tsx");

  assert.doesNotMatch(store, /export interface Human\b|\bhumans\b|\bmyRole\b|\bcapabilities\b/);
  assert.doesNotMatch(store, /\buploadUserAvatar\b|\bjoinChannel\b|\bleaveChannel\b|\buserIds\b|\bjoined\??:/);
  assert.match(store, /openAgentDM:\s*\(agentId: string\)/);
  assert.match(store, /const openAgentDM = async \(agentId: string\)/);
  assert.match(store, /\{ agentId \}/);
});

test("Machine and Computers are absent from the frontend product surface", () => {
  const store = source("./store.tsx");
  const main = source("./main.tsx");
  const chat = source("./views/Chat.tsx");
  const agents = source("./views/Members.tsx");
  const runtimeDiscovery = source("./useRuntimeDiscovery.ts");
  const misc = source("./views/misc.tsx");
  const modules = source("./shell/workspaceModules.tsx");

  assert.doesNotMatch(store, /interface Machine\b|\bmachines\b|latestDaemonVersion|machine:status|\/machines/);
  assert.doesNotMatch(main, /\bComputers\b|path="computer/);
  assert.doesNotMatch(chat, /ConnectComputerWizard/);
  assert.doesNotMatch(agents, /\bmachineId\b|\bmachines\b|\/machines\/|computerLabel|byMachine/);
  assert.doesNotMatch(misc, /export function Computers|ConnectComputerWizard|sk_machine|DaemonUpdateModal/);
  assert.doesNotMatch(modules, /computers|Monitor/);
  assert.deepEqual(
    [...modules.matchAll(/\{ id: "([^"]+)",[^\n]+sidebar: true \}/g)].map((match) => match[1]),
    ["spaces", "inbox", "tasks", "agents", "canvas", "settings"],
  );
  assert.match(modules, /\{ id: "search",[^\n]+sidebar: false \}/);
  assert.match(runtimeDiscovery, /\/api\/local-runtime\/models\/\$\{runtime\}/);
  assert.match(agents, /api\("POST", "\/api\/agents", \{ name:/);
});

test("Human membership, invite, and profile surfaces are absent", () => {
  const main = source("./main.tsx");
  const agents = source("./views/Members.tsx");
  const chatSidebar = source("./views/ChatSidebar.tsx");
  const chat = source("./views/Chat.tsx");
  const quickSwitcher = source("./QuickSwitcher.tsx");
  const settings = source("./views/misc.tsx");

  assert.doesNotMatch(main, /AuthPage|JoinPage|path="\/(?:login|register)"|path="human\/:userId"/);
  assert.doesNotMatch(agents, /HumanProfile|InviteHumanModal|manageMembers/);
  assert.doesNotMatch(chatSidebar, /\bhumans\b|\buserIds\b|\bjoinChannel\b/);
  assert.doesNotMatch(chat, /data\?\.humans|\{\s*userId\s*\}|\/members\/(?:join|leave)|chat\.memberKind|chat\.join/);
  assert.doesNotMatch(chat, /ChannelMembersModal|chat\.channelMembers|UsersRound/);
  assert.doesNotMatch(quickSwitcher, /kind:\s*"human"|channels\/dm[^\n]+userId|unknownUser/);
  assert.doesNotMatch(settings, /InvitesSettings|NotificationsSettings|notification-settings|settingsNavInvites/);
  assert.match(settings, /\/api\/human\/profile/);
  assert.doesNotMatch(settings, /\/api\/auth\/me/);
});

test("channel copy describes Human authority separately from agent membership", () => {
  const en = source("./locales/en.json");
  const zh = source("./locales/zh.json");

  for (const locale of [en, zh]) {
    assert.doesNotMatch(locale, /other humans|其他人类|invited members|被加入的成员|members will need to rejoin|成员需重新加入/);
  }
  assert.match(en, /Human always has access/);
  assert.match(zh, /Human 始终可访问/);
});

test("the frontend exposes only the local product shell", () => {
  const app = source("./App.tsx");
  const frame = source("./shell/WorkspaceFrame.tsx");
  const navigationRail = source("./shell/WorkspaceNavigationRail.tsx");
  const index = source("../index.html");
  const webPackage = JSON.parse(source("../package.json")) as { scripts: { build: string } };
  const removedPaths = [
    "./Layout.tsx",
    "./entry-server.tsx",
    "./views/Landing.tsx",
    "./views/Features.tsx",
    "./views/ProductMock.tsx",
    "./landing/landing.css",
    "./landing/MarketingNav.tsx",
    "./landing/publicNav.css",
    "./landing/publicNav.ts",
    "../scripts/prerender.js",
  ];

  assert.match(app, /return <WorkspaceFrame \/>/);
  assert.doesNotMatch(app, /Layout|legacy|useLocation|useState/);
  assert.doesNotMatch(frame, /legacyHref/);
  assert.doesNotMatch(navigationRail, /legacyHref|MoreHorizontal|<a\b/);
  assert.doesNotMatch(navigationRail, /QuickSwitcher|shell-topbar__tools/);
  assert.match(navigationRail, /<Sidebar collapsible="offcanvas"[\s\S]*?<SpaceSwitcher/);
  assert.match(navigationRail, /<ConversationListContent/);
  assert.match(frame, /<SidebarProvider/);
  assert.match(frame, /<WorkspaceNavigationRail/);
  assert.match(frame, /<WorkspaceTabs/);
  assert.doesNotMatch(frame, /<WorkspaceTopBar|shell-topbar/);
  assert.match(frame, /<QuickSwitcher onClose=/);
  assert.equal(webPackage.scripts.build, "vite build");
  assert.match(index, /<title>Kith-space<\/title>/);
  assert.match(index, /<meta name="description"/);
  assert.match(index, /<link rel="icon" href="\/icons\/kith-space-256\.png"/);
  assert.doesNotMatch(index, /favicon\.svg/);
  assert.doesNotMatch(index, /canonical|og:|twitter:|application\/ld\+json|apple-touch|fonts\.googleapis|fonts\.gstatic/);
  for (const path of removedPaths) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, `${path} must stay removed`);
  }
});
