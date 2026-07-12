import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { KithDesktopBridge } from "./desktopBridge.ts";
import {
  desktopRequiresPersonalSetupCheck,
  initializePersonalSetup,
  loadPersonalSetupStatus,
  validatePersonalSetup,
} from "./personalSetup.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("personal setup validates and normalizes the one Human profile", () => {
  assert.deepEqual(validatePersonalSetup({
    name: "  Ada Lovelace  ",
    email: " ada@example.com ",
    description: "  Coordinates the local agent team.  ",
  }), {
    input: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      description: "Coordinates the local agent team.",
    },
    errors: {},
  });

  assert.deepEqual(validatePersonalSetup({ name: " ", email: "not-an-email", description: "x".repeat(3001) }), {
    input: null,
    errors: { name: "required", email: "invalid", description: "tooLong" },
  });
  assert.deepEqual(validatePersonalSetup({ name: "Ada", email: "", description: "" }).input, { name: "Ada" });
});

test("personal setup client uses only same-origin Desktop setup endpoints", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json(String(input).endsWith("/status")
      ? { initialized: false, human: null, home: null }
      : { initialized: true, human: { id: "human-local", name: "Ada" }, home: { id: "home", name: "Home", slug: "home" } });
  };

  assert.equal((await loadPersonalSetupStatus(fetcher)).initialized, false);
  assert.equal((await initializePersonalSetup({ name: "Ada" }, fetcher)).initialized, true);
  assert.deepEqual(calls.map(({ url }) => url), ["/api/setup/status", "/api/setup/initialize"]);
  assert.equal(calls.every(({ init }) => init?.credentials === "same-origin"), true);
  assert.equal(calls[0]!.init?.method, "GET");
  assert.equal(calls[1]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { name: "Ada" });
  assert.equal(new Headers(calls[1]!.init?.headers).has("authorization"), false);
});

test("server setup errors remain visible and invalid responses fail closed", async () => {
  await assert.rejects(
    () => loadPersonalSetupStatus(async () => Response.json({ error: "Desktop setup is unavailable." }, { status: 503 })),
    /Desktop setup is unavailable/,
  );
  await assert.rejects(
    () => loadPersonalSetupStatus(async () => Response.json({ ready: true })),
    /response is invalid/,
  );
  await assert.rejects(
    () => loadPersonalSetupStatus(async () => Response.json({ initialized: true })),
    /response is invalid/,
  );
});

test("only a complete Desktop preload bridge enables setup probing", () => {
  const settings = {
    lifecycle: { closeBehavior: "tray" as const, launchAtLogin: false, launchAtLoginSupported: true },
    browser: { mode: "off" as const, port: 7777, hasAccessToken: false, tokenRevision: 0, activeSessions: 0, lanWarning: "" },
  };
  const bridge: KithDesktopBridge = {
    pickSpaceDirectory: async () => null,
    getSettings: async () => settings,
    updateLifecycle: async () => settings,
    updateBrowserAccess: async () => settings,
    revokeBrowserSessions: async () => settings,
    completeBrowserAccessUpdate: async () => {},
  };

  assert.equal(desktopRequiresPersonalSetupCheck(null), false);
  assert.equal(desktopRequiresPersonalSetupCheck(bridge), true);

  const main = source("./main.tsx");
  const boundary = source("./personalSetupBoundary.tsx");
  const view = source("./views/FirstRunSetup.tsx");
  assert.match(main, /<DesktopSetupBoundary>\s*<ProductRoot \/>\s*<\/DesktopSetupBoundary>/);
  assert.match(main, /function ProductRoot\(\)[\s\S]+<StoreProvider>/);
  assert.doesNotMatch(main, /api\/setup/);
  assert.match(boundary, /if \(!desktopRequiresPersonalSetupCheck\(bridge\)\) return/);
  assert.match(boundary, /human: status\.human/);
  assert.match(view, /initialHuman\.name/);
  assert.doesNotMatch(`${boundary}\n${view}`, /access.?token|credential|authorization/i);
});

test("legacy login, registration, and invitation locale namespace is removed", () => {
  const en = JSON.parse(source("./locales/en.json"));
  const zh = JSON.parse(source("./locales/zh.json"));
  assert.equal("auth" in en, false);
  assert.equal("auth" in zh, false);
  assert.equal(typeof en.personalSetup.title, "string");
  assert.equal(typeof zh.personalSetup.title, "string");
});
