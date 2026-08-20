import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KITH_IMAGE_MODEL_ID,
  DEFAULT_KITH_VIDEO_MODEL_ID,
  clampToVideoLimits,
  kithImageModels,
  kithVideoModels,
  videoLimitsForModel,
} from "./arkModelCatalog.ts";

test("Kith image catalog matches Ark Seedream families and limit presets", () => {
  const ids = kithImageModels().map((model) => model.id);
  assert.deepEqual(ids, [
    "doubao-seedream-5-0-pro-260628",
    "doubao-seedream-5-0-260128",
    "doubao-seedream-4-5-251128",
    DEFAULT_KITH_IMAGE_MODEL_ID,
  ]);
  const fourFive = kithImageModels().find((model) => model.id.includes("4-5"));
  assert.deepEqual(fourFive?.imageLimits?.resolutions, ["2K", "4K"]);
  const pro = kithImageModels().find((model) => model.id.includes("pro"));
  assert.deepEqual(pro?.imageLimits?.resolutions, ["1K", "2K"]);
  assert.ok(kithImageModels().every((model) => model.iconKey === "doubao"));
});

test("Kith video catalog disables 1080p and 15s on Seedance Lite", () => {
  const lite = kithVideoModels().find((model) => model.id.includes("lite"));
  const limits = videoLimitsForModel(lite);
  assert.deepEqual(limits.resolutions, ["480p", "720p"]);
  const clamped = clampToVideoLimits(limits, { resolution: "1080p", duration: 15, aspectRatio: "16:9" });
  assert.equal(clamped.resolution, "720p");
  assert.equal(clamped.duration, 12);
  assert.ok(kithVideoModels().some((model) => model.id === DEFAULT_KITH_VIDEO_MODEL_ID));
  assert.ok(kithVideoModels().every((model) => model.iconKey === "doubao"));
});
