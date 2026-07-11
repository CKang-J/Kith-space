# 开发命令文档 — Kith-space

本文件是 Kith-space **开发命令的权威来源**：环境准备、服务启动、测试、数据库、常用运维。命令若有变更，必须同步更新本文件（见 `AGENTS.md` 的文档更新规则）。

包管理器是 **pnpm**（不是 npm）。pnpm 传参不加 `--`：用 `pnpm test --unit`，不要写 `pnpm test -- --integration`。

> 过渡说明：以下命令准确描述 2026-07-11 的当前代码，因此仍包含 `.env`、JWT 和 daemon bootstrap key。个人 AgentOS 目标态由 Electron Desktop 管理 app.db 设置与内部临时凭据，普通用户不维护 `.env`；A4 将新增 `pnpm run desktop:dev`。在对应代码落地前，不得把计划中的命令写成已经可用。

## 1. 首次准备

```bash
pnpm install                      # 安装依赖（workspace：根 + web/ + packages/*）
cp .env.example .env              # 创建本地环境配置
```

当前过渡实现的必填环境变量（`.env`，缺了 Core Service 起不来）：

- `JWT_SECRET` — 人类会话 token 签名密钥。生成：`openssl rand -hex 32`
- `DAEMON_BOOTSTRAP_KEY` — Local Runtime Worker↔Core Service 过渡握手预共享密钥。生成：`openssl rand -hex 32`
- `PORT` — 服务端口，默认 `7777`
- `KITH_SPACE_HOME` — app 数据、日志和 agent 工作目录的根目录，默认 `~/.kith-space`（`app.db` 在此；各 Space 的数据库与附件分别在 `<rootPath>/.kith/workspace.db`、`<rootPath>/.kith/uploads`）

本地便利项（仅过渡开发）：`ALLOW_DEV_LOGIN=true` 可用用户名签发 JWT。账户/JWT/dev login 将在 A3 删除，不得用于新的浏览器 Token 设计。

> Worker 与 Core Service 的密钥必须一致。过渡命令仍名为 `pnpm run daemon`，其内置 `--api-key` 是 `poc-secret-key`；因此本地要么把 `.env` 的 `DAEMON_BOOTSTRAP_KEY=poc-secret-key`，要么手动用匹配的 key 起 Worker（见 §3）。用 `pnpm run dev:e2e:up`（§4）则会自动读 `.env` 的 key，无需对齐。

## 2. 数据库

**不需要单独 `db:push`**：每个 Space db 在连接时自动迁移（`src/db/index.ts` 的 `migrate()`）；`pnpm run seed` 初始化唯一 Human 与默认 `Home` Space，并建好 schema。分段起时**先 `seed` 即可**。

```bash
pnpm run seed                     # 建唯一 Human + Home Space 并自动迁移 schema（幂等）
pnpm run seed:dev                 # 追加开发用 dev-bot agent
pnpm run db:push                  # 可选/遗留：仅把 schema 推到一个 scratch db（./.kith-space-dev.db），供 drizzle-kit 迭代/studio 用，非应用运行所需
pnpm run db:studio                # 可选：Drizzle Studio 查那个 scratch db
```

数据层是 SQLite：中央 `app.db` + 每 Space 独立 workspace.db，无需 Postgres/Redis。附件固定使用 `<spaceRoot>/.kith/uploads`，不支持 S3 或 app 级上传目录覆盖。详见 `docs/kith-space/architecture-proposal.md §4.6/§5`。

A2.2b 使用破坏性单一 baseline，不迁移旧开发库。若启动时报 legacy workspace database，先备份报错路径指向的 `<space>/.kith/workspace.db`，再由开发者显式删除并重新 seed；应用不会自动迁移或删除旧库。

## 3. 手动起各服务（三个进程，分别开终端）

当前过渡开发由三部分组成：server/Core Service（API + 提供已构建 web）、唯一 Local Runtime Worker（代码/命令名暂为 daemon，承载所有本机 Space 的 agent）、web（开发时的 Vite 热更；不开发前端时可省）。这些分进程命令会作为内部调试入口保留。Core Service 当前固定监听 `127.0.0.1`；A3 Token/浏览器会话完成前没有 LAN 开发入口。

```bash
# 终端 A — server（API + WS），热更监听
pnpm run server                   # = tsx watch src/server/index.ts，监听 $PORT

# 终端 B — Local Runtime Worker（承载所有本机 Space 的 agent；命令名暂为 daemon）
pnpm run daemon                   # 内置 --api-key poc-secret-key（需与 .env 的 DAEMON_BOOTSTRAP_KEY 一致）
# 或指定自己的 key：
pnpm exec tsx src/daemon/index.ts --api-key "$DAEMON_BOOTSTRAP_KEY"

# 终端 C — web 前端热更（仅在改前端时需要）
pnpm --dir web run dev            # Vite dev server
```

Local Runtime Worker 固定连接 `http://127.0.0.1:$PORT`，不接受 `--server-url`；它不是可连接远程服务的独立 daemon 产品。

不带热更起 server：`pnpm start`（= `tsx src/server/index.ts`）。
停掉本地全部进程：`pnpm run stop`。

> agent 要真正运行，本机需安装并登录对应 runtime CLI（如 `claude`、`codex`、`opencode`）。缺失时 agent 无法启动。

## 4. 一键起本地全栈（推荐）

`dev:e2e:up` 会幂等地建 schema、种子、构建站点，然后后台起 Core Service + 唯一 Local Runtime Worker + dev-bot，日志写到 `$KITH_SPACE_HOME/logs/`。脚本先等 `/health` 可用，再等 `/health` 返回 `"workerConnected": true`，不会在 Worker 尚未 ready 时继续：

```bash
pnpm run dev:e2e:up               # 起：Core Service(127.0.0.1:$PORT) + Worker + dev-bot（读 .env，自动对齐 key）
pnpm run dev:e2e:down             # 停整套
```

前置：`.env` 需含 `PORT`、`DAEMON_BOOTSTRAP_KEY`；本机需有已登录的 `claude` CLI。起来后浏览器开 `http://127.0.0.1:$PORT`。

## 5. 测试与类型检查

```bash
pnpm run typecheck                # tsc 检查 server + web 两个 tsconfig
pnpm test --unit                  # 单元测试（node:test）
pnpm test --integration           # 集成测试（跑在 SQLite 上，零 PG/Redis）
pnpm test                         # 全量（单测 + 集成）
```

跑测试时把数据落到临时目录，避免污染真实 home：`KITH_SPACE_HOME=$(mktemp -d) pnpm test --unit`。
已知既有失败：`test/publicNavContract.unit.test.ts` 因仓库缺 `docs-site/` 而失败，非回归，可忽略。

## 6. 构建与打包

```bash
pnpm run web:build                # 构建前端到 web/dist（server 会提供它）
pnpm run pkg:daemon:build         # 打包 daemon 分发件
pnpm run cli -- <args>            # 运行 CLI（如 pnpm run cli role-template list）
```

## 7. 编排护栏相关环境变量（P1）

- `KITH_SPACE_MAX_DISPATCH_DEPTH` — agent→agent 分派链最大深度，默认 4
- `KITH_SPACE_MAX_DISPATCH_WAKES` — 每链最大成功唤醒次数，默认 16

急停等运行时控制走 `/api/tasks/:id/dispatch/*` 与 `/api/spaces/:id/dispatch/*`，详见 `docs/kith-space/architecture-proposal.md §6`。

## 8. 待删除的继承命令

`start:prod`、`daemon:prod`、`seed:prod`、`prod:up`、`prod:down`、`.env.prod`、公共 server/daemon 包和 OIDC 发布 workflow 是 open-tag 服务器发行遗留。它们在 A6 删除，不属于 Kith-space 正式产品路线；正式发行物只有 Desktop 安装包。

## 9. 目标 Desktop 开发入口（尚未实现）

A4 完成后新增 `pnpm run desktop:dev`，统一启动 Core Service、Local Runtime Worker、Vite 和 Electron，并使用临时内部凭据。该命令当前不可用；实现时必须同步更新本节、README、AGENTS 和 package scripts。
