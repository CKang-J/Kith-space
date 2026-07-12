import assert from "node:assert/strict";
import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  getSpaceRecord,
  registerSpace as persistSpaceRecord,
} from "../../src/app-data/appDatabase.ts";
import { closeAllDatabases, closeSpaceDb } from "../../src/db/index.ts";
import { ensurePersonalApp } from "../../src/db/personalApp.ts";
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

const root = process.env.KITH_SPACE_OPEN_ROUTE_CASE_ROOT;
assert.ok(root, "KITH_SPACE_OPEN_ROUTE_CASE_ROOT is required");

try {
  const { human, home } = await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });
  const projectRoot = path.join(root, "project");
  mkdirSync(projectRoot, { recursive: true });
  const created = await request("POST", "/api/spaces", human.id, {
    name: "Project",
    rootPath: projectRoot,
  });
  assert.equal(created.status, 201);

  const list = await request("GET", "/api/spaces", human.id);
  assert.equal(list.status, 200);
  assert.equal(list.body.find((space: any) => space.id === home.id)?.isHome, true);
  assert.equal(list.body.find((space: any) => space.id === created.body.id)?.isHome, false);

  const homeItem = await request("GET", `/api/spaces/${home.id}`, human.id);
  const projectItem = await request("GET", `/api/spaces/${created.body.id}`, human.id);
  assert.equal(homeItem.body.isHome, true);
  assert.equal(projectItem.body.isHome, false);

  const oldOpenedAt = new Date(1_000);
  persistSpaceRecord({ ...getSpaceRecord(created.body.id)!, lastOpenedAt: oldOpenedAt });
  const opened = await request("POST", `/api/spaces/${created.body.id}/open`, human.id);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.isHome, false);
  assert.equal(opened.body.status, "ready");
  assert.ok(new Date(opened.body.lastOpenedAt).getTime() > oldOpenedAt.getTime());
  assert.equal(
    getSpaceRecord(created.body.id)?.lastOpenedAt.toISOString(),
    opened.body.lastOpenedAt,
  );

  closeSpaceDb(created.body.id);
  const movedRoot = path.join(root, "project-moved");
  renameSync(projectRoot, movedRoot);
  const preservedOpenedAt = new Date(2_000);
  persistSpaceRecord({ ...getSpaceRecord(created.body.id)!, lastOpenedAt: preservedOpenedAt });
  const unavailable = await request("POST", `/api/spaces/${created.body.id}/open`, human.id);
  assert.notEqual(unavailable.status, 200);
  assert.equal(unavailable.body.code, "SPACE_ROOT_MISSING");
  assert.equal(getSpaceRecord(created.body.id)?.lastOpenedAt.getTime(), preservedOpenedAt.getTime());
} finally {
  closeAllDatabases();
}
