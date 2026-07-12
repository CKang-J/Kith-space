import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getSpaceRecordBySlug } from "../../src/app-data/appDatabase.ts";
import { closeAllDatabases, dbForSpace, schema } from "../../src/db/index.ts";
import { ensurePersonalApp } from "../../src/db/personalApp.ts";
import { handleApi } from "../../src/server/routes-api/index.ts";
import { handleSpacesHumanScope } from "../../src/server/routes-api/spaces.ts";

type CapturedResponse = { status: number; body: any };

function responseCapture(): { response: CapturedResponse; res: any } {
  const response: CapturedResponse = { status: 0, body: undefined };
  return {
    response,
    res: {
      writeHead(status: number) { response.status = status; },
      end(body?: string) { response.body = body ? JSON.parse(body) : undefined; },
    },
  };
}

function jsonRequest(body?: unknown): any {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.headers = {};
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

async function request(method: string, pathname: string, humanId: string, body?: unknown) {
  const capture = responseCapture();
  const handled = await handleSpacesHumanScope({
    req: jsonRequest(body),
    res: capture.res,
    url: new URL(`http://localhost${pathname}`),
    method,
    p: pathname,
    humanId,
  });
  return { handled, ...capture.response };
}

const root = process.env.KITH_SPACE_ROUTE_CASE_ROOT;
assert.ok(root, "KITH_SPACE_ROUTE_CASE_ROOT is required");

try {
  const { human, home } = await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });

  const initial = await request("GET", "/api/spaces", human.id);
  assert.equal(initial.handled, true);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.map((space: any) => space.slug), ["home"]);
  assert.equal(initial.body[0].id, home.id);
  assert.equal("role" in initial.body[0], false);
  assert.equal("capabilities" in initial.body[0], false);
  assert.equal("plan" in initial.body[0], false);

  const researchRoot = path.join(root, "research");
  mkdirSync(researchRoot, { recursive: true });
  const created = await request("POST", "/api/spaces", human.id, {
    name: "Research Lab",
    rootPath: researchRoot,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.slug, "research-lab");
  assert.equal(getSpaceRecordBySlug("research-lab")?.id, created.body.id);
  assert.deepEqual(
    (await dbForSpace(created.body.id).select().from(schema.spaces)).map((space) => space.id),
    [created.body.id],
  );

  const updated = await request("PATCH", `/api/spaces/${created.body.id}`, human.id, {
    name: "Writing Lab",
    slug: "writing",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, "Writing Lab");
  assert.equal(updated.body.slug, "writing");
  assert.equal(getSpaceRecordBySlug("writing")?.id, created.body.id);

  const unread = await request("GET", "/api/spaces/unread-summary", human.id);
  assert.equal(unread.status, 200);
  assert.deepEqual(
    new Set(unread.body.map((item: any) => item.spaceId)),
    new Set([home.id, created.body.id]),
  );
  assert.ok(unread.body.every((item: any) => item.unreadCount === 0));

  const scopedRequest = jsonRequest();
  scopedRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-space-id": home.id,
  };
  const scopedCapture = responseCapture();
  await handleApi(scopedRequest, scopedCapture.res, new URL("http://localhost/api/channels"), "GET");
  assert.equal(scopedCapture.response.status, 200);

  for (const path of ["/api/agents"]) {
    const scopedRequest = jsonRequest();
    scopedRequest.headers = {
      "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
      "x-space-id": home.id,
    };
    const scopedCapture = responseCapture();
    await handleApi(scopedRequest, scopedCapture.res, new URL(`http://localhost${path}`), "GET");
    assert.equal(scopedCapture.response.status, 200, path);
  }

  const modelsRequest = jsonRequest();
  modelsRequest.headers = { "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN! };
  const modelsCapture = responseCapture();
  await handleApi(modelsRequest, modelsCapture.res, new URL("http://localhost/api/local-runtime/models/claude"), "GET");
  assert.equal(modelsCapture.response.status, 200);

  const retiredMachinesRequest = jsonRequest();
  retiredMachinesRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-space-id": home.id,
  };
  const retiredMachinesCapture = responseCapture();
  const retiredMachinesPath = `/api/spaces/${home.id}/machines`;
  await handleApi(retiredMachinesRequest, retiredMachinesCapture.res, new URL(`http://localhost${retiredMachinesPath}`), "GET");
  assert.equal(retiredMachinesCapture.response.status, 404);

  const channelRequest = jsonRequest({ name: "human-authority" });
  channelRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-space-id": home.id,
  };
  const channelCapture = responseCapture();
  await handleApi(channelRequest, channelCapture.res, new URL("http://localhost/api/channels"), "POST");
  assert.equal(channelCapture.response.status, 200);

  const sidebarPutRequest = jsonRequest({ pinnedChannelIds: [channelCapture.response.body.id] });
  sidebarPutRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-space-id": home.id,
  };
  const sidebarPutCapture = responseCapture();
  const sidebarPath = `/api/spaces/${home.id}/sidebar-order`;
  await handleApi(sidebarPutRequest, sidebarPutCapture.res, new URL(`http://localhost${sidebarPath}`), "PUT");
  assert.equal(sidebarPutCapture.response.status, 200);
  assert.deepEqual(sidebarPutCapture.response.body.pinnedChannelIds, [channelCapture.response.body.id]);

  const sidebarGetRequest = jsonRequest();
  sidebarGetRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-space-id": home.id,
  };
  const sidebarGetCapture = responseCapture();
  await handleApi(sidebarGetRequest, sidebarGetCapture.res, new URL(`http://localhost${sidebarPath}`), "GET");
  assert.equal(sidebarGetCapture.response.status, 200);
  assert.deepEqual(sidebarGetCapture.response.body.pinnedChannelIds, [channelCapture.response.body.id]);

  const foreignTokenRequest = jsonRequest();
  foreignTokenRequest.headers = {
    "x-kith-desktop-token": "incorrect-desktop-token",
    "x-space-id": home.id,
  };
  const foreignTokenCapture = responseCapture();
  await handleApi(foreignTokenRequest, foreignTokenCapture.res, new URL("http://localhost/api/channels"), "GET");
  assert.equal(foreignTokenCapture.response.status, 401);

  const devLoginRequest = jsonRequest({ name: "another-person" });
  devLoginRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-space-id": home.id,
  };
  const devLoginCapture = responseCapture();
  await handleApi(devLoginRequest, devLoginCapture.res, new URL("http://localhost/api/auth/dev-login"), "POST");
  assert.equal(devLoginCapture.response.status, 404);

  for (const retired of [
    ["POST", "/api/auth/register"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/setup"],
    ["GET", "/api/auth/invite-info?token=retired"],
    ["POST", "/api/auth/accept-invite"],
    ["GET", `/api/spaces/${home.id}/members`],
    ["GET", `/api/spaces/${home.id}/join-links`],
    ["GET", `/api/spaces/${home.id}/notification-settings`],
  ] as const) {
    const retiredRequest = jsonRequest({});
    retiredRequest.headers = {
      "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
      "x-space-id": home.id,
    };
    const retiredCapture = responseCapture();
    const url = new URL(`http://localhost${retired[1]}`);
    await handleApi(retiredRequest, retiredCapture.res, url, retired[0]);
    assert.equal(retiredCapture.response.status, 404, retired[1]);
  }

  const legacyPatchRequest = jsonRequest({ name: "Renamed Home", slug: "renamed-home" });
  legacyPatchRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-space-id": home.id,
  };
  const legacyPatchCapture = responseCapture();
  const legacyPatchPath = `/api/servers/${home.id}`;
  await handleApi(legacyPatchRequest, legacyPatchCapture.res, new URL(`http://localhost${legacyPatchPath}`), "PATCH");
  assert.equal(legacyPatchCapture.response.status, 404);
  assert.equal(getSpaceRecordBySlug("renamed-home"), undefined);

  const legacyHeaderRequest = jsonRequest();
  legacyHeaderRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-server-id": home.id,
  };
  const legacyHeaderCapture = responseCapture();
  await handleApi(legacyHeaderRequest, legacyHeaderCapture.res, new URL("http://localhost/api/channels"), "GET");
  assert.equal(legacyHeaderCapture.response.status, 400);
  assert.match(legacyHeaderCapture.response.body.error, /x-space-id header required/);

  const pathMismatchRequest = jsonRequest();
  pathMismatchRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-space-id": home.id,
  };
  const pathMismatchCapture = responseCapture();
  const mismatchPath = `/api/spaces/${created.body.id}/machines`;
  await handleApi(pathMismatchRequest, pathMismatchCapture.res, new URL(`http://localhost${mismatchPath}`), "GET");
  assert.equal(pathMismatchCapture.response.status, 400);
  assert.match(pathMismatchCapture.response.body.error, /path Space/);

  const unknownSpaceRequest = jsonRequest();
  unknownSpaceRequest.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "x-space-id": "missing-space",
  };
  const unknownSpaceCapture = responseCapture();
  await handleApi(unknownSpaceRequest, unknownSpaceCapture.res, new URL("http://localhost/api/channels"), "GET");
  assert.equal(unknownSpaceCapture.response.status, 404);
} finally {
  closeAllDatabases();
}
