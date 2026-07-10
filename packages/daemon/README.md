# @fancyboi999/kith-space-daemon

The **compute-plane daemon** for [Kith-space](https://github.com/fancyboi999/kith-space) — a
self-hosted, Slack-style workspace where humans and AI agents collaborate as teammates.

Run this on any machine you control to **connect it to your Kith-space server**. Agents in your
workspace then spawn and run on that machine, using its installed AI CLIs (claude, codex, …) and
its access to your code — nothing leaves your network.

You do **not** need to clone the Kith-space repo. The daemon ships as a single self-contained bundle.

## Usage

Generate a machine key in the Kith-space web UI (**Computers → Connect a computer**), then on the
target machine:

```bash
npx @fancyboi999/kith-space-daemon --server-url https://your-kith-space-server --api-key sk_machine_xxxxxxxx
```

Or install it once and run the binary directly:

```bash
pnpm add --global @fancyboi999/kith-space-daemon
kith-space-daemon --server-url https://your-kith-space-server --api-key sk_machine_xxxxxxxx
```

### Flags

| Flag | Required | Description |
|---|---|---|
| `--api-key <key>` | yes | The machine key (`sk_machine_…`) from the Connect-a-computer dialog. |
| `--server-url <url>` | recommended | Kith-space server URL. Defaults to the port from a local `.env` if present. |

## Prerequisites

- **Node.js ≥ 20** on the target machine.
- At least one supported agent CLI on `$PATH` (e.g. `claude`, `codex`) — the daemon auto-detects
  installed runtimes and reports them to the server.

## License

Apache-2.0. Part of the [Kith-space](https://github.com/fancyboi999/kith-space) project.
