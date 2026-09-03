import { main } from "@earendil-works/pi-coding-agent";

// Kith-owned entry for the built-in Pi Agent runtime. This is the locked
// @earendil-works/pi-coding-agent CLI entry (the `rpc-entry` equivalent)
// invoked through process.execPath by the Local Runtime Worker, so the JSONL
// RPC protocol is byte-for-byte the one the external `pi --mode rpc` CLI
// speaks. `main` configures the HTTP dispatcher and telemetry itself.
//
// All configuration arrives through process argv/env prepared by
// PiBuiltinRuntimeConfigCompiler plus the session-level env of the adapter
// (PI_CODING_AGENT_DIR points at the per-session private root, never the
// user's real ~/.pi/agent).
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
// RPC stdout is the protocol channel; diagnostics must not leak into it.
process.emitWarning = (() => {});
void main(["--mode", "rpc", ...process.argv.slice(2)]);
