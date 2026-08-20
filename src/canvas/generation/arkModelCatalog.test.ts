import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DOUBAO_IMAGE_MODEL,
  DEFAULT_SEEDREAM_VIDEO_MODEL,
  arkImageSizeForModel,
  clampImageResolution,
  clampVideoDuration,
  clampVideoResolution,
  resolveArkImageModel,
  resolveArkVideoModel,
} from "./arkModelCatalog.js";
import { arkImageSize } from "./arkClient.js";

describe("arkModelCatalog", () => {
  it("sends K-label size for smart aspect and WxH for named ratios", () => {
    assert.equal(arkImageSizeForModel(DEFAULT_DOUBAO_IMAGE_MODEL, "smart", "2K"), "2K");
    assert.equal(arkImageSizeForModel(DEFAULT_DOUBAO_IMAGE_MODEL, "16:9", "2K"), "2560x1440");
    assert.equal(arkImageSize({ aspectRatio: "smart", resolution: "2K" }), "2K");
  });

  it("clamps unsupported image resolutions to the model default", () => {
    const lite = resolveArkImageModel("doubao-seedream-5-0-260128");
    assert.equal(clampImageResolution("1K", lite), "2K");
    const fourFive = resolveArkImageModel("doubao-seedream-4-5-251128");
    assert.deepEqual(fourFive.resolutions, ["2K", "4K"]);
    assert.equal(arkImageSizeForModel(fourFive.id, "1:1", "1K"), "2048x2048");
  });

  it("disables 1080p and 15s for Seedance 1.0 Lite while Pro keeps 1080p", () => {
    const lite = resolveArkVideoModel("doubao-seedance-1-0-lite-t2v-250428");
    const pro = resolveArkVideoModel(DEFAULT_SEEDREAM_VIDEO_MODEL);
    assert.equal(clampVideoResolution("1080p", lite), "720p");
    assert.equal(clampVideoResolution("1080p", pro), "1080p");
    assert.equal(clampVideoDuration(15, pro), 12);
    assert.equal(clampVideoDuration(15, lite), 12);
    assert.ok(!lite.resolutions.includes("1080p"));
    assert.ok(pro.resolutions.includes("1080p"));
  });
});
