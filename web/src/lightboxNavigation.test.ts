import test from "node:test";
import assert from "node:assert/strict";
import { adjacentImageId } from "./lightboxNavigation.ts";

const images = [{ id: "one" }, { id: "two" }, { id: "three" }];

test("lightbox navigation moves in both directions and stops at sequence boundaries", () => {
  assert.equal(adjacentImageId(images, "two", -1), "one");
  assert.equal(adjacentImageId(images, "two", 1), "three");
  assert.equal(adjacentImageId(images, "one", -1), null);
  assert.equal(adjacentImageId(images, "three", 1), null);
});

test("lightbox navigation keeps using the stable current image id after history is prepended", () => {
  assert.equal(adjacentImageId([{ id: "older" }, ...images], "two", -1), "one");
  assert.equal(adjacentImageId([{ id: "older" }, ...images], "two", 1), "three");
  assert.equal(adjacentImageId(images, "missing", 1), null);
});
