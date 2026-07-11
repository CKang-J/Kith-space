import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  const misc = source("./views/misc.tsx");
  const modules = source("./shell/workspaceModules.tsx");
  const dock = source("./shell/WorkspaceDock.tsx");

  assert.doesNotMatch(store, /interface Machine\b|\bmachines\b|latestDaemonVersion|machine:status|\/machines/);
  assert.doesNotMatch(main, /\bComputers\b|path="computer/);
  assert.doesNotMatch(chat, /ConnectComputerWizard/);
  assert.doesNotMatch(agents, /\bmachineId\b|\bmachines\b|\/machines\/|computerLabel|byMachine/);
  assert.doesNotMatch(misc, /export function Computers|ConnectComputerWizard|sk_machine|DaemonUpdateModal/);
  assert.doesNotMatch(modules, /computers|Monitor/);
  assert.deepEqual(
    [...modules.matchAll(/\{ id: "([^"]+)",[^\n]+dock: true \}/g)].map((match) => match[1]),
    ["inbox", "tasks", "agents", "settings"],
  );
  assert.match(dock, /<MessageCircle size=\{18\} \/>/);
  assert.match(agents, /\/api\/local-runtime\/models\/\$\{runtime\}/);
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
  assert.match(chat, /setMembers\(data\?\.agents \|\| \[\]\)/);
  assert.match(chat, /\/members`, \{ agentId \}/);
  assert.doesNotMatch(quickSwitcher, /kind:\s*"human"|channels\/dm[^\n]+userId|unknownUser/);
  assert.doesNotMatch(settings, /InvitesSettings|NotificationsSettings|notification-settings|settingsNavInvites/);
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

test("marketing copy presents the desktop-first Personal AgentOS route", () => {
  const landing = source("./views/Landing.tsx");
  const features = source("./views/Features.tsx");
  const index = source("../index.html");
  const marketing = `${landing}\n${features}\n${index}`;

  assert.match(marketing, /desktop-first Personal AgentOS/i);
  assert.match(marketing, /one Human/);
  assert.match(marketing, /same computer/);
  assert.match(marketing, /local HTTP Web/);
  assert.match(marketing, /trusted LAN desktop browsers/);
  assert.match(marketing, /Access Token[^\n]+(?:planned|路线)/i);
  assert.match(marketing, /cross-Space aggregation[^\n]+(?:roadmap|路线)/i);
  assert.doesNotMatch(marketing, /An open, self-hostable|self-hosted multi-agent|teams and AI agents collaborate|可自托管的团队工作区|humans and agents collaborate|4 agents active across 2 machines|4 个 agent 活跃在 2 台机器|Self-hosted execution|执行自托管/);
});
