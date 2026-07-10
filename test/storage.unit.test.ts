// Unit tests for S3 config validation (fail-loud). Pure logic, no network/disk.
// Run: npx tsx --test --test-force-exit test/storage.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { s3Config } from "../src/server/storage.ts";

const S3_VARS = ["KITH_SPACE_S3_ENDPOINT", "KITH_SPACE_S3_BUCKET", "KITH_SPACE_S3_KEY", "KITH_SPACE_S3_SECRET", "KITH_SPACE_S3_REGION"];
function setAll() {
  process.env.KITH_SPACE_S3_ENDPOINT = "http://localhost:9000";
  process.env.KITH_SPACE_S3_BUCKET = "kith-space";
  process.env.KITH_SPACE_S3_KEY = "ak";
  process.env.KITH_SPACE_S3_SECRET = "sk";
  delete process.env.KITH_SPACE_S3_REGION;
}
function clearAll() { for (const v of S3_VARS) delete process.env[v]; }

test("all required set → returns config, region defaults to us-east-1", () => {
  setAll();
  assert.deepEqual(s3Config(), {
    endpoint: "http://localhost:9000", region: "us-east-1",
    bucket: "kith-space", key: "ak", secret: "sk",
  });
});

test("explicit region is honored", () => {
  setAll();
  process.env.KITH_SPACE_S3_REGION = "cn-hangzhou";
  assert.equal(s3Config().region, "cn-hangzhou");
});

test("missing endpoint throws and names the var", () => {
  setAll();
  delete process.env.KITH_SPACE_S3_ENDPOINT;
  assert.throws(() => s3Config(), /KITH_SPACE_S3_ENDPOINT/);
});

test("missing bucket throws and names the var", () => {
  setAll();
  delete process.env.KITH_SPACE_S3_BUCKET;
  assert.throws(() => s3Config(), /KITH_SPACE_S3_BUCKET/);
});

test("missing key throws and names the var", () => {
  setAll();
  delete process.env.KITH_SPACE_S3_KEY;
  assert.throws(() => s3Config(), /KITH_SPACE_S3_KEY/);
});

test("missing secret throws and names the var", () => {
  setAll();
  delete process.env.KITH_SPACE_S3_SECRET;
  assert.throws(() => s3Config(), /KITH_SPACE_S3_SECRET/);
});

test("multiple missing → message lists all of them", () => {
  clearAll();
  assert.throws(() => s3Config(), (e: Error) =>
    /KITH_SPACE_S3_ENDPOINT/.test(e.message) && /KITH_SPACE_S3_BUCKET/.test(e.message) &&
    /KITH_SPACE_S3_KEY/.test(e.message) && /KITH_SPACE_S3_SECRET/.test(e.message));
});
