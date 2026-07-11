# 开发命令文档 — Kith-space

本文件是 Kith-space **开发命令的权威来源**：环境准备、服务启动、测试、数据库、常用运维。命令若有变更，必须同步更新本文件（见 `AGENTS.md` 的文档更新规则）。

包管理器是 **pnpm**（不是 npm）。pnpm 传参不加 `--`：用 `pnpm test --unit`，不要写 `pnpm test -- --integration`。

> A6 已完成 Desktop 生产 bundle 与 Windows 安装器链。完整开发优先使用 `pnpm run desktop:dev`；全新数据目录无需 seed，它会自行生成并隔离 Desktop/Worker 内部凭据，并在窗口中收集 Human 资料、创建 `Home`。可选本地 `.env` 中的内部凭据只服务手动分进程调试，不是普通用户配置，也不随仓库提供样例。

## 1. 首次准备

```bash
pnpm install                      # 安装依赖（workspace 仅根目录 + web/）
```

仓库已删除 `.env.example`、`.env.docker.example` 等服务器部署样例。需要手动分进程调试时，可自行创建不提交的本地 `.env`，或在各进程环境中设置：

- `KITH_SPACE_DESKTOP_TOKEN` — Desktop/开发管理请求到 Core Service 的私有信任凭据（必填）。
- `KITH_SPACE_WORKER_TOKEN` — Local Runtime Worker 控制 WS 的独立凭据（必填）。
- `PORT` — 手动分进程开发用监听端口覆盖，默认 `7777`；Desktop 管理的 Core 不读取该覆盖，端口以 app.db 为准。
- `KITH_SPACE_HOME` — app 数据、日志和 agent 工作目录的根目录，默认 `~/.kith-space`（`app.db` 在此；各 Space 的数据库与附件分别在 `<rootPath>/.kith/workspace.db`、`<rootPath>/.kith/uploads`）

手动分进程时，两个凭据必须分别用密码学安全随机源生成（例如各执行一次 `openssl rand -hex 32`），不得相同，也不得复用浏览器访问 Token。Core Service 缺任一内部凭据时会 fail-fast。Desktop 管理的进程组不读取这些值，而是在每次启动/重启时自动轮换。

## 2. 数据库

**不需要单独 `db:push`**：每个 Space db 在连接时自动迁移（`src/db/index.ts` 的 `migrate()`）。正式 Desktop 流程不执行 seed：首次初始化界面会幂等创建唯一 Human 与默认 `Home`，并建好 schema。`pnpm run seed` 只保留给手动分进程调试、测试 fixture 或需要预置数据的脚本；普通浏览器不能调用 Desktop-only setup API，因此用全新 `KITH_SPACE_HOME` 手动分起时，可先运行一次 seed。

```bash
pnpm run seed                     # 可选调试 fixture：预建唯一 Human + Home Space 并自动迁移 schema（幂等）
pnpm run seed:dev                 # 追加开发用 dev-bot agent
pnpm run db:push                  # 可选/遗留：仅把 schema 推到一个 scratch db（./.kith-space-dev.db），供 drizzle-kit 迭代/studio 用，非应用运行所需
pnpm run db:studio                # 可选：Drizzle Studio 查那个 scratch db
```

数据层是 SQLite：中央 `app.db` + 每 Space 独立 workspace.db，无需 Postgres/Redis。附件固定使用 `<spaceRoot>/.kith/uploads`，不支持 S3 或 app 级上传目录覆盖。详见 `docs/kith-space/architecture-proposal.md §4.6/§5`。

A2.2b 使用破坏性单一 baseline，不迁移旧开发库。若启动时报 legacy workspace database，先备份报错路径指向的 `<space>/.kith/workspace.db`，再由开发者显式删除并重新 seed；应用不会自动迁移或删除旧库。

## 3. 配置开发用浏览器入口

Web 模式和端口保存在 `$KITH_SPACE_HOME/app.db`。默认模式是 `off`：Core Service 仍保留 Desktop/Worker 需要的 `127.0.0.1` 私有传输，但普通浏览器无法取得产品壳。Desktop 运行时应在 Desktop Settings 中管理模式、端口、Token 和会话；以下命令只供手动分进程开发：

```bash
pnpm run browser-access:dev off
pnpm run browser-access:dev local --port 7777 --rotate-token
pnpm run browser-access:dev lan --port 7777 --token "a-custom-token-at-least-16-chars"
```

- `local` 绑定 `127.0.0.1`；`lan` 绑定 `0.0.0.0`。模式或端口改变后需重启 Core Service。
- `--token <VALUE>` 设置 16-256 字符的自定义访问 Token；为避免意外回显，命令不再把自定义值打印到 stdout。
- `--rotate-token` 或空的 `--token ""` 自动生成 32 字节 Token，只在本次命令 stdout 显示一次。轮换会立即使全部旧浏览器会话失效。
- 省略 `--token`/`--rotate-token` 时，已有 Token 不变且不回显；首次开启且尚无 Token 时会自动生成并显示一次。
- LAN v1 是未加密 HTTP，仅用于受信任私有局域网；不得做端口转发、反向代理公开或暴露到互联网。

浏览器首次访问输入访问 Token，成功后取得持久 HttpOnly Cookie 会话。会话持续到浏览器数据清除、用户撤销当前浏览器访问授权、Desktop 全量撤销或 Token 轮换；URL 不携 Token，也不支持 `?as=`。这里的“撤销访问”只清除浏览器授权会话，不是账户 logout。

## 4. 手动起各服务（三个进程，分别开终端）

手动调试由三部分组成：server/Core Service（API + 提供已构建 web）、唯一 Local Runtime Worker（代码/命令名暂为 daemon，承载所有本机 Space 的 agent）、web（开发时的 Vite 热更；不开发前端时可省）。这些命令是内部调试入口，不代表正式宿主。先用 §3 配置 Web 模式/Token，再启 Core Service。

```bash
# 终端 A — server（API + WS），热更监听
pnpm run server                   # = tsx watch src/server/index.ts，监听 $PORT

# 终端 B — Local Runtime Worker（承载所有本机 Space 的 agent；命令名暂为 daemon）
pnpm run daemon                   # 从 KITH_SPACE_WORKER_TOKEN 读取内部握手凭据

# 终端 C — web 前端热更（仅在改前端时需要）
pnpm --dir web run dev            # Vite dev server
```

Local Runtime Worker 固定连接 `http://127.0.0.1:$PORT`，不接受 `--server-url`；它不是可连接远程服务的独立 daemon 产品。

不带热更起 server：`pnpm start`（= `tsx src/server/index.ts`）。
停掉本地全部进程：`pnpm run stop`。

> agent 要真正运行，本机需安装并登录对应 runtime CLI（如 `claude`、`codex`、`opencode`）。缺失时 agent 无法启动。

## 5. 一键起本地全栈（推荐）

`dev:e2e:up` 会幂等地建 schema/种子，把 Web 模式设为 `local`、端口同步为 `.env` 的 `PORT`，每次轮换一个随机访问 Token，再构建前端并后台起 Core Service + 唯一 Local Runtime Worker + dev-bot。Token 只在该次启动终端显示一次，日志不记录它。脚本先等 `/health` 可用，再等 `/health` 返回 `"workerConnected": true`，不会在 Worker 尚未 ready 时继续：

```bash
pnpm run dev:e2e:up               # 起：local Web + Core Service + Worker + dev-bot
pnpm run dev:e2e:down             # 停整套
```

前置：`.env` 需含 `PORT`、`KITH_SPACE_DESKTOP_TOKEN`、`KITH_SPACE_WORKER_TOKEN`；本机需有已登录的 `claude` CLI。起来后浏览器开 `http://127.0.0.1:$PORT`，在 Token Gate 输入启动终端中打印的 Token。

## 6. 测试与类型检查

```bash
pnpm run typecheck                # tsc 检查 server + web 两个 tsconfig
pnpm test --unit                  # 单元测试（node:test）
pnpm test --integration           # 集成测试（跑在 SQLite 上，零 PG/Redis）
pnpm test                         # 全量（单测 + 集成）
```

跑测试时把数据落到临时目录，避免污染真实 home：`KITH_SPACE_HOME=$(mktemp -d) pnpm test --unit`。
A6 当前完整单测基线是 449/449。旧 `test/publicNavContract.unit.test.ts` 随 public landing/PWA 路线删除，不再是可忽略的既有失败；当前全量检查应为全绿。生产依赖审计可运行 `pnpm audit --prod --audit-level=high`。

## 7. 构建与打包

```bash
pnpm run web:build                # 构建前端到 web/dist（server 会提供它）
pnpm run desktop:build            # 用 esbuild 构建 Electron main/preload 到 desktop/dist
pnpm run desktop:bundle           # web build + main/preload + Core CJS + Worker/agent CLI ESM
pnpm run desktop:pack             # 先 production bundle，再生成 dist/desktop/win-unpacked
pnpm run desktop:dist             # 先 production bundle，再生成 x64、per-user、assisted NSIS 安装器
pnpm run cli role-template list   # 源码调试时直接运行 CLI；pnpm 脚本传参不加额外 --
```

`desktop:build` 只生成 Electron main/preload，不包含 Web/Core/Worker，也不是安装器。`desktop:bundle` 生成打包所需的完整生产资产：`web/dist`、`desktop/dist/main.cjs`、`preload.cjs`、`runtime/core.cjs`、`runtime/worker.mjs` 与 `runtime/agent-cli.mjs`。打包态用 Electron 自身可执行文件配合 `ELECTRON_RUN_AS_NODE=1` 启动 Core/Worker，并从 `resources` 读取 Web 与 Drizzle migration。

`desktop:pack` 和 `desktop:dist` 都通过 `scripts/package-desktop.mjs` 调用 electron-builder 26.15.3。由于 pnpm 的物理 store 不能依赖 electron-builder 自动扫描正确重建，`package.json` 固定 `npmRebuild=false`，包装器使用 `@electron/rebuild` 4.2.0 对 `better-sqlite3` 执行 `--force --arch x64` 的 Electron rebuild，再调用 electron-builder；无论成功或失败，`finally` 都执行 `pnpm rebuild better-sqlite3` 恢复后续开发/测试的 Node ABI。最终核对：本地 Node ABI 137，packaged Electron ABI 148。

## 8. 编排护栏相关环境变量（P1）

- `KITH_SPACE_MAX_DISPATCH_DEPTH` — agent→agent 分派链最大深度，默认 4
- `KITH_SPACE_MAX_DISPATCH_WAKES` — 每链最大成功唤醒次数，默认 16

急停等运行时控制走 `/api/tasks/:id/dispatch/*` 与 `/api/spaces/:id/dispatch/*`，详见 `docs/kith-space/architecture-proposal.md §6`。

## 9. 已退役的继承发行路径

`start:prod`、`daemon:prod`、`seed:prod`、`prod:up`、`prod:down`、公共 daemon package、Docker/compose/Railway、npm/OIDC 与 docs-site 发布 workflow 已在 A6 删除，不再是可运行命令或发行入口。源码调试用 `start`/`server`/`daemon` 不等于恢复公共 server/daemon 产品；正式发行物只有 Desktop 安装包。

## 10. Electron Desktop 开发与 Windows 发行

```bash
pnpm run desktop:build            # 仅构建 Electron main/preload，不启动进程、不生成安装器
pnpm run desktop:dev              # desktop:build 后启动 Electron 管理的完整开发进程组
pnpm run desktop:bundle           # 构建完整 production assets，不运行 electron-builder
pnpm run desktop:pack             # 生成 Windows unpacked 目录，便于 packaged smoke
pnpm run desktop:dist             # 生成 Windows NSIS 安装器
```

`desktop:dev` 使用 Electron 43.1.0。Desktop 先启动 Core Service；Core 从 app.db 读取稳定端口并以 IPC 报告 ready 后，监督器才把实际端口注入唯一 Worker 和可选 Vite。端口占用会作为明确启动错误返回，不静默换端口。进程组每次启动或因 Web 设置变更而重启时，都会重新生成相互独立的 Desktop/Worker 凭据；受管子进程带 `KITH_SPACE_DESKTOP_MANAGED=1`，不会从仓库 `.env` 重新载入凭据，Vite 子进程环境不包含任一内部 Token。

全新 `KITH_SPACE_HOME` 无需先运行 seed。Electron 渲染器通过 preload 私有信任探测 Desktop-only setup API；未初始化时显示 Human 名称（必填）、邮箱和描述（选填）表单，完成后再挂载正式 Store 并进入 `Home`。普通浏览器没有该 preload bridge，不会探测 setup API，只按 Web 模式与 Access Token Gate 进入产品。

开发窗口默认关闭到托盘；可在 Desktop Settings 改为关闭即退出。显式 Quit 会等待 agent runtime 退出，再结束整个进程组；Windows 使用 process-tree 兜底，终止失败时应用保持运行并允许重试。Desktop Settings 还管理 off/local/lan、端口、访问 Token 轮换、浏览器会话撤销与系统自启动。LAN 在改变监听前要求确认 HTTP 风险，自动生成的 Token 会保持显示到用户确认已保存。自启动只在 Windows 正式打包形态启用，开发态会明确显示不支持。

Windows 配置固定为 Electron 43.1.0、electron-builder 26.15.3、x64、per-user、assisted NSIS；输出目录是 `dist/desktop/`。手动 GitHub Actions workflow `Build Windows Desktop` 只运行 `desktop:dist` 并上传保留 14 天的未签名 `.exe` artifact，不创建 Release，也不自动发布。

A6 本地验证生成的安装器是 `dist/desktop/Kith-space-Setup-0.1.0-x64.exe`，大小 113625983 bytes，SHA-256 为 `D314DAE15A8E9AB598901D2E3DF8B90DE1C7B46E79824CC8575BD4C742B89646`，Authenticode 状态为 `NotSigned`。最终 unpacked Desktop smoke Exit 0，成功创建 `app.db`，退出后残留受管进程 0、端口监听 0。这证明构建链可复现，不代表产品已签名或已发布；公开分发前必须配置 Windows 代码签名证书。本阶段只验证了 unpacked/packaged Desktop 与 Core smoke，没有实际执行 NSIS 安装和卸载，正式发布验收仍必须补做该流程。
