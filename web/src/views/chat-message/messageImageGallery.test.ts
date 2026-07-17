import test from "node:test";
import assert from "node:assert/strict";
import { buildMessageImageGallery, isSingleImageMessage } from "./messageImageGallery.ts";
import type { Msg } from "../../store.tsx";

const message = (id: string, attachments: NonNullable<Msg["attachments"]>): Msg => ({
  id,
  seq: 1,
  channelId: "channel-1",
  senderType: "human",
  senderName: "jwaitq",
  content: "",
  attachments,
});

test("message image gallery keeps message and attachment order while excluding files", () => {
  const messages = [
    message("m1", [
      { id: "image-1", filename: "one.png", mimeType: "image/png" },
      { id: "file-1", filename: "notes.md", mimeType: "text/markdown" },
    ]),
    message("m2", [
      { id: "image-2", filename: "two.webp", mimeType: "image/webp" },
    ]),
  ];

  assert.deepEqual(buildMessageImageGallery(messages, (id) => `/attachment/${id}`), [
    { id: "image-1", src: "/attachment/image-1", alt: "one.png" },
    { id: "image-2", src: "/attachment/image-2", alt: "two.webp" },
  ]);
});

test("large message preview is reserved for exactly one image attachment", () => {
  assert.equal(isSingleImageMessage([{ id: "image-1", filename: "one.png", mimeType: "image/png" }]), true);
  assert.equal(isSingleImageMessage([
    { id: "image-1", filename: "one.png", mimeType: "image/png" },
    { id: "image-2", filename: "two.png", mimeType: "image/png" },
  ]), false);
  assert.equal(isSingleImageMessage([
    { id: "image-1", filename: "one.png", mimeType: "image/png" },
    { id: "file-1", filename: "notes.md", mimeType: "text/markdown" },
  ]), false);
});
