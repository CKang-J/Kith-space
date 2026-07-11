#!/usr/bin/env node
import "../env.js";
import { Command, InvalidArgumentError } from "commander";
import type { BrowserAccessMode } from "../browser-access/index.js";
import { configureDevelopmentBrowserAccess } from "./browserAccessConfiguration.js";

function browserAccessMode(value: string): BrowserAccessMode {
  if (value === "off" || value === "local" || value === "lan") return value;
  throw new InvalidArgumentError("mode must be off, local, or lan");
}

function browserAccessPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError("port must be an integer between 1 and 65535");
  }
  return port;
}

const program = new Command()
  .name("kith-space-browser-access")
  .description("Configure the app.db browser access policy for local development")
  .argument("<mode>", "off, local, or lan", browserAccessMode)
  .option("--port <port>", "browser listener port", browserAccessPort)
  .option("--token <token>", "replace the Access Token; pass an empty value to auto-generate")
  .option("--rotate-token", "generate and install a fresh Access Token")
  .action(async (mode: BrowserAccessMode, options: {
    port?: number;
    token?: string;
    rotateToken?: boolean;
  }) => {
    if (options.rotateToken && options.token !== undefined) {
      throw new Error("--token and --rotate-token cannot be used together");
    }
    const result = await configureDevelopmentBrowserAccess({
      mode,
      port: options.port,
      accessToken: options.token,
      rotateToken: options.rotateToken,
    });
    const host = result.settings.mode === "lan" ? "0.0.0.0" : "127.0.0.1";
    console.error(
      `Browser access configured: mode=${result.settings.mode} listener=${host}:${result.settings.port}`,
    );
    if (result.settings.mode === "lan") {
      console.error("Warning: LAN access is HTTP-only; use it only on a trusted private network.");
    }
    const generatedToken = options.token === undefined || options.token.trim() === "";
    if (result.accessToken && generatedToken) process.stdout.write(`${result.accessToken}\n`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
