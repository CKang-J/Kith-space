const serverUrl = stringOption("--server", "http://127.0.0.1:7777")!;
const desktopToken = requiredOption("--desktop-token");
const spaceId = requiredOption("--space-id");
const channelId = requiredOption("--channel-id");
const count = integerOption("--count", 100);
const round = integerOption("--round", 1);

const latenciesMs: number[] = [];
for (let index = 0; index < count; index += 1) {
  const startedAt = performance.now();
  const sentAtEpochMs = Date.now();
  const response = await fetch(new URL("/api/messages", serverUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kith-desktop-token": desktopToken,
      "x-space-id": spaceId,
    },
    body: JSON.stringify({
      channelId,
      content: `P-A9 realtime round ${round} message ${index + 1} | sentAt=${sentAtEpochMs}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Append ${index + 1} failed (${response.status}): ${await response.text()}`);
  }
  latenciesMs.push(performance.now() - startedAt);
}

process.stdout.write(`${JSON.stringify({ count, round, latenciesMs })}\n`);

function requiredOption(name: string): string {
  const value = stringOption(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stringOption(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function integerOption(name: string, fallback: number): number {
  const value = stringOption(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
