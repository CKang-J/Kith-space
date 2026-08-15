import assert from "node:assert/strict";
import test from "node:test";
import { apiQuery, configureRecombynCanvasAssetBridge } from "./recombynStageOneServices.ts";

test("native AssetPanel query and delete use the active Canvas-local bridge", async () => {
  const deleted: string[] = [];
  const detach = configureRecombynCanvasAssetBridge({
    queryKey: ["canvas-local-assets", "space:canvas"],
    list: async () => [{ id: "asset-1", kind: "image", url: "/api/canvases/c/assets/asset-1" }],
    delete: async (id) => { deleted.push(id); },
  });
  try {
    const options = apiQuery.assetsListMyAssets.infiniteOptions({ initialPageParam: 1 });
    const page = await options.queryFn({ pageParam: 1 });
    assert.equal(page.items[0].id, "asset-1");
    assert.deepEqual(apiQuery.assetsListMyAssets.key(), ["canvas-local-assets", "space:canvas"]);
    await apiQuery.assetsDeleteMyAsset.mutationOptions().mutationFn({ params: { asset_id: "asset-1" } });
    assert.deepEqual(deleted, ["asset-1"]);
  } finally { detach(); }
});
