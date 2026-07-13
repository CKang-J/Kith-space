import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateSync } from "node:zlib";

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");

const paeth = (left: number, up: number, upperLeft: number) => {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance
      ? up
      : upperLeft;
};

const readRgbaPng = (path: string) => {
  const png = readFileSync(new URL(path, import.meta.url));
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed: Buffer[] = [];

  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      bitDepth = png[dataStart + 8];
      colorType = png[dataStart + 9];
    } else if (type === "IDAT") {
      compressed.push(png.subarray(dataStart, dataStart + length));
    }
    offset = dataStart + length + 4;
  }

  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6);
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const source = filtered[y * (stride + 1) + x + 1];
      const target = y * stride + x;
      const left = x >= bytesPerPixel ? pixels[target - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[target - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[target - stride - bytesPerPixel] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, upperLeft);
      pixels[target] = (source + predictor) & 0xff;
    }
  }

  return {
    width,
    height,
    pixels,
    alphaAt: (x: number, y: number) => pixels[(y * width + x) * bytesPerPixel + 3],
  };
};

test("brand assets stay pinned to the approved generated design", () => {
  assert.equal(
    sha256("../../assets/brand/kith-space-design-master.png"),
    "708ddfe66adf8589799b762a2f12082e5aeb25984b9c0ccbda3f549fc25ded8b",
  );
  assert.equal(
    sha256("../../assets/brand/kith-space-icon-source.png"),
    "710baba51a47077b32b03db4e7e381d190cc012d19605fede18d860dae43ce8a",
  );
  assert.equal(
    sha256("../../assets/brand/kith-space-lockup-source.png"),
    "28c31b698945d3a3f366d79803eeeb07522ce104947c3fe0670daee68b58794a",
  );
  assert.equal(
    sha256("../public/icons/kith-space-1024.png"),
    "979ac2a3eb741ad5747d37098f5357568b6ba5f50265c91d60cb1b74ba616a74",
  );
  assert.equal(
    sha256("../public/favicon.ico"),
    "4926683236d60134aa1dae8cadcb2263c29f4005b5c3bcb961d3bd41c26af91b",
  );
  assert.equal(existsSync(new URL("../public/favicon.svg", import.meta.url)), false);
});

test("brand icon has precise antialiased transparent corners", () => {
  const icon = readRgbaPng("../../assets/brand/kith-space-icon-source.png");
  const corners = [
    icon.alphaAt(0, 0),
    icon.alphaAt(icon.width - 1, 0),
    icon.alphaAt(0, icon.height - 1),
    icon.alphaAt(icon.width - 1, icon.height - 1),
  ];
  const edgeMidpoints = [
    icon.alphaAt(Math.floor(icon.width / 2), 0),
    icon.alphaAt(0, Math.floor(icon.height / 2)),
    icon.alphaAt(icon.width - 1, Math.floor(icon.height / 2)),
    icon.alphaAt(Math.floor(icon.width / 2), icon.height - 1),
  ];
  const alphas = icon.pixels.filter((_, index) => index % 4 === 3);

  assert.deepEqual(corners, [0, 0, 0, 0]);
  assert.deepEqual(edgeMidpoints, [255, 255, 255, 255]);
  assert.ok(alphas.some((alpha) => alpha > 0 && alpha < 255));
});
