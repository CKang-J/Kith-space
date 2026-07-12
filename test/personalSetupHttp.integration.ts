import assert from "node:assert/strict";
import { Readable } from "node:stream";

const root = process.env.KITH_SPACE_HOME;
assert.ok(root, "KITH_SPACE_HOME is required");
assert.ok(process.env.KITH_SPACE_DESKTOP_TOKEN, "KITH_SPACE_DESKTOP_TOKEN is required");
assert.ok(process.env.KITH_SPACE_WORKER_TOKEN, "KITH_SPACE_WORKER_TOKEN is required");

const { closeAppDatabase } = await import("../src/app-data/appDatabase.ts");
const { closeAllDatabases } = await import("../src/db/index.ts");
const { defaultSpaceRoot } = await import("../src/paths.ts");
const { handleApi } = await import("../src/server/routes-api/index.ts");

type Capture = {
  status: number;
  body: any;
};

async function api(input: {
  method: string;
  pathname: string;
  body?: unknown;
  headers?: Record<string, string>;
  remoteAddress?: string;
}): Promise<Capture> {
  const capture: Capture = { status: 0, body: undefined };
  const req = Readable.from(input.body === undefined ? [] : [JSON.stringify(input.body)]) as any;
  req.method = input.method;
  req.headers = {
    ...(input.body === undefined ? {} : { "content-type": "application/json" }),
    ...(input.headers ?? {}),
  };
  req.socket = { remoteAddress: input.remoteAddress ?? "127.0.0.1", encrypted: false };
  const res = {
    writeHead(status: number) { capture.status = status; },
    end(payload?: string) { capture.body = payload ? JSON.parse(payload) : undefined; },
  } as any;
  await handleApi(req, res, new URL(`http://localhost:7777${input.pathname}`), input.method);
  return capture;
}

function desktopHeaders(): Record<string, string> {
  return { "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN! };
}

try {
  for (const request of [
    {},
    { headers: { "x-kith-worker-token": process.env.KITH_SPACE_WORKER_TOKEN! } },
    { headers: { "x-kith-desktop-token": "wrong-token" } },
    { headers: desktopHeaders(), remoteAddress: "192.168.1.25" },
  ]) {
    const hidden = await api({
      method: "GET",
      pathname: "/api/setup/status",
      ...request,
    });
    assert.equal(hidden.status, 404);
  }

  const fresh = await api({
    method: "GET",
    pathname: "/api/setup/status",
    headers: desktopHeaders(),
  });
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.body, { initialized: false });

  for (const body of [
    null,
    [],
    {},
    { name: "" },
    { name: "Ada", email: "not-an-email" },
    { name: "Ada", description: 42 },
    { name: "Ada", rootPath: "D:/client-controlled" },
    { name: "Ada", extra: true },
  ]) {
    const invalid = await api({
      method: "POST",
      pathname: "/api/setup/initialize",
      headers: desktopHeaders(),
      body,
    });
    assert.equal(invalid.status, 400, `expected invalid setup body ${JSON.stringify(body)} to fail`);
  }

  const initializeRequest = () => api({
    method: "POST",
    pathname: "/api/setup/initialize",
    headers: desktopHeaders(),
    body: {
      name: "  Ada Lovelace  ",
      email: "  ada@example.com  ",
      description: "First Human",
    },
  });
  const [initialized, concurrentInitialize] = await Promise.all([
    initializeRequest(),
    initializeRequest(),
  ]);
  assert.equal(initialized.status, 200);
  assert.equal(concurrentInitialize.status, 200);
  assert.deepEqual(concurrentInitialize.body, initialized.body);
  assert.equal(initialized.body.initialized, true);
  assert.deepEqual(initialized.body.human, {
    id: initialized.body.human.id,
    name: "Ada Lovelace",
    email: "ada@example.com",
    description: "First Human",
  });
  assert.deepEqual(initialized.body.home, {
    id: initialized.body.home.id,
    name: "Home",
    slug: "home",
  });

  const spaces = await api({
    method: "GET",
    pathname: "/api/spaces",
    headers: desktopHeaders(),
  });
  assert.equal(spaces.status, 200);
  const home = spaces.body.find((space: any) => space.id === initialized.body.home.id);
  assert.ok(home);
  assert.equal(home.rootPath, defaultSpaceRoot("Home"));

  const repeated = await api({
    method: "POST",
    pathname: "/api/setup/initialize",
    headers: desktopHeaders(),
    body: {
      name: "Different Human",
      email: "different@example.com",
      description: "must not overwrite",
    },
  });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body, initialized.body);

  const clientRootStillRejected = await api({
    method: "POST",
    pathname: "/api/setup/initialize",
    headers: desktopHeaders(),
    body: { name: "Ada Lovelace", rootPath: "D:/client-controlled" },
  });
  assert.equal(clientRootStillRejected.status, 400);

  const complete = await api({
    method: "GET",
    pathname: "/api/setup/status",
    headers: desktopHeaders(),
  });
  assert.equal(complete.status, 200);
  assert.deepEqual(complete.body, initialized.body);

  const browserStillHidden = await api({
    method: "POST",
    pathname: "/api/setup/initialize",
    body: { name: "Browser Human" },
  });
  assert.equal(browserStillHidden.status, 404);
} finally {
  closeAllDatabases();
  closeAppDatabase();
}
