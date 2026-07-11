import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";
import { getSpaceRecordBySlug } from "../../src/app-data/appDatabase.ts";
import { closeAllDatabases } from "../../src/db/index.ts";
import { ensurePersonalApp } from "../../src/db/personalApp.ts";
import { signUser } from "../../src/server/auth.ts";
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
  assert.equal(initial.body[0].role, "owner");

  const created = await request("POST", "/api/spaces", human.id, {
    name: "Research Lab",
    rootPath: path.join(root, "research"),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.slug, "research-lab");
  assert.equal(getSpaceRecordBySlug("research-lab")?.id, created.body.id);

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
