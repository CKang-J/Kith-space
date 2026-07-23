import assert from "node:assert/strict";
import test from "node:test";
import { preflightEgress } from "./egressPreflight.js";

test("egress preflight rejects public origins resolving to private, loopback, link-local, or metadata addresses", async () => {
  for (const address of ["127.0.0.1", "10.0.0.2", "169.254.169.254", "192.0.2.1", "::1", "fe80::1",
    "::ffff:7f00:1", "fe90::1", "ff02::1", "2001:db8::1"]) {
    await assert.rejects(() => preflightEgress({
      canonicalOrigin: "https://api.example.com",
      networkClass: "public_cloud",
      allowedEgress: ["https://api.example.com"],
    }, async () => [address]), /provider_preflight_destination_mismatch/);
  }
});

test("egress preflight pins all resolved addresses and rejects undeclared proxy", async () => {
  const plan = await preflightEgress({
    canonicalOrigin: "https://api.example.com",
    networkClass: "public_cloud",
    allowedEgress: ["https://api.example.com"],
  }, async () => ["8.8.8.8", "2606:4700:4700::1111"]);
  assert.equal(plan.proxy, "none");
  assert.equal(plan.redirectPolicy, "reject");
  assert.match(plan.resolvedAddressDigest, /^[0-9a-f]{64}$/);
  await assert.rejects(() => preflightEgress({
    canonicalOrigin: "https://api.example.com",
    networkClass: "public_cloud",
    allowedEgress: ["https://api.example.com"],
    proxyUrl: "http://proxy.example.com",
  }, async () => ["8.8.8.8"]), /provider_preflight_destination_mismatch/);
});

test("egress preflight supports RFC 2544 transparent-proxy DNS only behind an HTTPS hostname", async () => {
  const plan = await preflightEgress({
    canonicalOrigin: "https://api.example.com",
    networkClass: "public_cloud",
    allowedEgress: ["https://api.example.com"],
  }, async () => ["198.18.0.89"]);
  assert.match(plan.resolvedAddressDigest, /^[0-9a-f]{64}$/);

  await assert.rejects(() => preflightEgress({
    canonicalOrigin: "https://198.18.0.89",
    networkClass: "public_cloud",
    allowedEgress: ["https://198.18.0.89"],
  }), /provider_preflight_destination_mismatch/);
});
