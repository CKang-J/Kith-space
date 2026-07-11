import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";
import { getSpaceRecordBySlug, listSpaceRecords } from "../../src/app-data/appDatabase.ts";
import { closeAllDatabases, dbForSpace, schema } from "../../src/db/index.ts";
import { ensurePersonalApp } from "../../src/db/personalApp.ts";
import { signUser, verifyUser } from "../../src/server/auth.ts";
import { handleApi } from "../../src/server/routes-api/index.ts";
import { handleSpacesUserScope } from "../../src/server/routes-api/spaces.ts";

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
  return req;
}

async function request(method: string, pathname: string, userId: string, body?: unknown) {
  const capture = responseCapture();
  const handled = await handleSpacesUserScope({
    req: jsonRequest(body),
    res: capture.res,
    url: new URL(`http://localhost${pathname}`),
    method,
    p: pathname,
    userId,
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

  const created = await request("POST", "/api/spaces", human.id, {
    name: "Research Lab",
    rootPath: path.join(root, "research"),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.slug, "research-lab");
  assert.equal(getSpaceRecordBySlug("research-lab")?.id, created.body.id);
  assert.deepEqual(await dbForSpace(created.body.id).select().from(schema.serverMembers), []);

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

  const token = signUser(human.id);
  await dbForSpace(home.id).delete(schema.serverMembers);
  for (const scopeHeaders of [
    { "x-space-id": home.id },
    { "x-server-id": home.id },
  ]) {
    const scopedRequest = jsonRequest();
    scopedRequest.headers = { authorization: `Bearer ${token}`, ...scopeHeaders };
    const scopedCapture = responseCapture();
    await handleApi(scopedRequest, scopedCapture.res, new URL("http://localhost/api/channels"), "GET");
    assert.equal(scopedCapture.response.status, 200);
  }

  for (const path of [
    "/api/agents",
    "/api/local-runtime/models/claude",
  ]) {
    const scopedRequest = jsonRequest();
    scopedRequest.headers = { authorization: `Bearer ${token}`, "x-space-id": home.id };
    const scopedCapture = responseCapture();
    await handleApi(scopedRequest, scopedCapture.res, new URL(`http://localhost${path}`), "GET");
    assert.equal(scopedCapture.response.status, 200, path);
  }

  const retiredMachinesRequest = jsonRequest();
  retiredMachinesRequest.headers = { authorization: `Bearer ${token}`, "x-space-id": home.id };
  const retiredMachinesCapture = responseCapture();
  const retiredMachinesPath = `/api/spaces/${home.id}/machines`;
  await handleApi(retiredMachinesRequest, retiredMachinesCapture.res, new URL(`http://localhost${retiredMachinesPath}`), "GET");
  assert.equal(retiredMachinesCapture.response.status, 404);

  const channelRequest = jsonRequest({ name: "human-authority" });
  channelRequest.headers = { authorization: `Bearer ${token}`, "x-space-id": home.id };
  const channelCapture = responseCapture();
  await handleApi(channelRequest, channelCapture.res, new URL("http://localhost/api/channels"), "POST");
  assert.equal(channelCapture.response.status, 200);

  const sidebarPutRequest = jsonRequest({ pinnedChannelIds: [channelCapture.response.body.id] });
  sidebarPutRequest.headers = { authorization: `Bearer ${token}`, "x-space-id": home.id };
  const sidebarPutCapture = responseCapture();
  const sidebarPath = `/api/spaces/${home.id}/sidebar-order`;
  await handleApi(sidebarPutRequest, sidebarPutCapture.res, new URL(`http://localhost${sidebarPath}`), "PUT");
  assert.equal(sidebarPutCapture.response.status, 200);
  assert.deepEqual(sidebarPutCapture.response.body.pinnedChannelIds, [channelCapture.response.body.id]);

  const sidebarGetRequest = jsonRequest();
  sidebarGetRequest.headers = { authorization: `Bearer ${token}`, "x-space-id": home.id };
  const sidebarGetCapture = responseCapture();
  await handleApi(sidebarGetRequest, sidebarGetCapture.res, new URL(`http://localhost${sidebarPath}`), "GET");
  assert.equal(sidebarGetCapture.response.status, 200);
  assert.deepEqual(sidebarGetCapture.response.body.pinnedChannelIds, [channelCapture.response.body.id]);

  const foreignTokenRequest = jsonRequest();
  foreignTokenRequest.headers = { authorization: `Bearer ${signUser("not-the-local-human")}`, "x-space-id": home.id };
  const foreignTokenCapture = responseCapture();
  await handleApi(foreignTokenRequest, foreignTokenCapture.res, new URL("http://localhost/api/channels"), "GET");
  assert.equal(foreignTokenCapture.response.status, 403);

  const previousDevLogin = process.env.ALLOW_DEV_LOGIN;
  process.env.ALLOW_DEV_LOGIN = "true";
  try {
    const spacesBeforeDevLogin = listSpaceRecords().length;
    const devLoginRequest = jsonRequest({ name: "another-person" });
    const devLoginCapture = responseCapture();
    await handleApi(devLoginRequest, devLoginCapture.res, new URL("http://localhost/api/auth/dev-login"), "POST");
    assert.equal(devLoginCapture.response.status, 200);
    assert.equal(verifyUser(devLoginCapture.response.body.token), human.id);
    assert.equal(listSpaceRecords().length, spacesBeforeDevLogin);
  } finally {
    if (previousDevLogin === undefined) delete process.env.ALLOW_DEV_LOGIN;
    else process.env.ALLOW_DEV_LOGIN = previousDevLogin;
  }

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
    retiredRequest.headers = { authorization: `Bearer ${token}`, "x-space-id": home.id };
    const retiredCapture = responseCapture();
    const url = new URL(`http://localhost${retired[1]}`);
    await handleApi(retiredRequest, retiredCapture.res, url, retired[0]);
    assert.equal(retiredCapture.response.status, 404, retired[1]);
  }

  const legacyPatchRequest = jsonRequest({ name: "Renamed Home", slug: "renamed-home" });
  legacyPatchRequest.headers = { authorization: `Bearer ${token}`, "x-server-id": home.id };
  const legacyPatchCapture = responseCapture();
  const legacyPatchPath = `/api/servers/${home.id}`;
  await handleApi(legacyPatchRequest, legacyPatchCapture.res, new URL(`http://localhost${legacyPatchPath}`), "PATCH");
  assert.equal(legacyPatchCapture.response.status, 200);
  assert.equal(getSpaceRecordBySlug("renamed-home")?.id, home.id);

  const conflictingRequest = jsonRequest();
  conflictingRequest.headers = {
    authorization: `Bearer ${token}`,
    "x-space-id": home.id,
    "x-server-id": created.body.id,
  };
  const conflictingCapture = responseCapture();
  await handleApi(conflictingRequest, conflictingCapture.res, new URL("http://localhost/api/channels"), "GET");
  assert.equal(conflictingCapture.response.status, 400);
  assert.match(conflictingCapture.response.body.error, /headers disagree/);

  const pathMismatchRequest = jsonRequest();
  pathMismatchRequest.headers = { authorization: `Bearer ${token}`, "x-space-id": home.id };
  const pathMismatchCapture = responseCapture();
  const mismatchPath = `/api/spaces/${created.body.id}/machines`;
  await handleApi(pathMismatchRequest, pathMismatchCapture.res, new URL(`http://localhost${mismatchPath}`), "GET");
  assert.equal(pathMismatchCapture.response.status, 400);
  assert.match(pathMismatchCapture.response.body.error, /path Space/);

  const unknownSpaceRequest = jsonRequest();
  unknownSpaceRequest.headers = { authorization: `Bearer ${token}`, "x-space-id": "missing-space" };
  const unknownSpaceCapture = responseCapture();
  await handleApi(unknownSpaceRequest, unknownSpaceCapture.res, new URL("http://localhost/api/channels"), "GET");
  assert.equal(unknownSpaceCapture.response.status, 404);
} finally {
  closeAllDatabases();
}
