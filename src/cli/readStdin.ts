import type { Readable } from "node:stream";

type StdinLike = Readable & { isTTY?: boolean };

export function readUtf8Stdin(input: StdinLike = process.stdin): Promise<string> {
  return new Promise((resolve) => {
    if (input.isTTY) return resolve("");
    input.setEncoding("utf8");
    let data = "";
    input.on("data", (chunk) => { data += chunk; });
    input.on("end", () => resolve(data));
  });
}
