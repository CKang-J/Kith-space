# Windows / macOS / Linux 兼容性基线与审计清单

最后审计：2026-07-25。

本文是跨平台工程规则和已知缺口的事实清单。它不改变当前发行范围：**正式发行目前仍只有 Windows x64 v1，macOS / Linux 仍是 planned**。但从现在起，所有新增或修改的共享代码都必须同时评估 Windows、macOS、Linux；不能因为暂时只发布 Windows，就把新的平台假设继续写进领域、runtime、数据或共享 UI。

## 实施状态（2026-07-25）

本轮已完成以下共享边界，下面第 2 节的表格保留为审计时证据，便于追溯原始问题：

- **已完成代码修复**：CP-04、CP-05、CP-06、CP-07、CP-08、CP-09、CP-10、CP-15、CP-16、CP-17。
- **已建立持续门禁但仍待远端结果**：CP-01 已把 typecheck、unit、integration、`desktop:bundle` 扩展到 Ubuntu、Windows、macOS 矩阵；本机只验证了 Windows，必须以远端三端 job 全绿作为最终证据。
- **仍是显式后续项**：CP-02、CP-03、CP-11、CP-12、CP-13、CP-14、CP-18。macOS/Linux 打包、图标、签名/公证、安装生命周期、真实 runtime smoke 与 POSIX 专项 smoke 尚未完成，不能表述为正式支持。

已完成实现包括：可等待的跨平台进程树终止器与统一命令超时边界；Node 版 `stop`、worktree、E2E 脚本；隔离 staging 中的 Electron native rebuild；共享剪贴板降级；Windows owner/DACL 主动收紧与验证；Hermes 临时 turn 文件全终态清理。Windows 本机已验证定向回归、类型检查和 `desktop:pack`，且打包前后开发树 `better_sqlite3.node` 摘要一致。

## 1. 口径

### 1.1 分类

- **确认缺陷**：已由源码必然行为、当前平台实跑或失败测试证明。
- **高概率风险**：当前路径可能可用，但缺少必要的退出、权限、并发或平台语义保证。
- **验证缺口**：实现尚未由目标平台 CI、打包或真实运行证明。
- **明确延后**：产品路线已明确暂不发行该平台；仍需避免新增阻碍未来支持的共享代码。

### 1.2 严重度

- **高**：阻断目标平台启动、数据安全、凭据安全、进程收尾或正式发行。
- **中**：阻断开发/测试门禁、核心操作，或容易产生残留进程、环境污染和静默失败。
- **低**：文档、诊断、辅助脚本或尚未进入当前发行范围的体验缺口。

## 2. 当前审计结果

| ID | 严重度 | 分类 | 影响平台 | 发现与证据 | 建议边界 |
| --- | --- | --- | --- | --- | --- |
| CP-01 | 高 | 验证缺口 | Windows / macOS / Linux | 常规 CI 只有 Ubuntu：`.github/workflows/ci.yml:14-45`；Windows 只有手动 installer workflow：`.github/workflows/desktop-release.yml:10-39`。Windows 的 process tree、`.cmd`、ACL，macOS 的 app/login item，Linux 的 tray/desktop integration 都没有持续门禁。 | 先把 typecheck、unit、integration、`desktop:bundle` 扩成三平台矩阵；打包/签名/真实 Desktop smoke 继续按平台拆成独立 job。 |
| CP-02 | 低 | 明确延后 | macOS / Linux | `scripts/package-desktop.mjs:12-16,40-58` 硬编码 `--win --x64` 和 Electron x64 rebuild；`package.json:95-112` 只有 NSIS；没有 macOS/Linux target、图标、签名/公证或 artifact。 | 不做隐式“按宿主猜平台”；未来分别增加 `desktop:dist:mac`、`desktop:dist:linux`、对应 builder 配置、原生模块架构和平台 runner。 |
| CP-03 | 高 | 验证缺口 | Windows | Windows workflow 只上传未签名 `.exe`（`.github/workflows/desktop-release.yml:31-39`），尚无代码签名和真实安装→启动→升级→卸载证据。 | 只在 release/builder 层接入证书与干净 VM 验收，不把签名逻辑放进业务代码。 |
| CP-04 | 高 | 高概率风险 | Windows | `src/runtime/worker/maintenance/providerProcessTree.ts:21-29` 调用 `taskkill.exe` 后不检查退出码，也不等待目标 child 的 `exit`；`error` 分支直接 child `SIGTERM` 后即 resolve。调用方可能在凭据 helper 尚未真正退出时认为取消完成。当前 Windows 测试 `src/runtime/worker/maintenance/providerProcessTree.test.ts` 已失败。 | Windows 分支必须以目标进程真正退出为成功条件，检查 `taskkill` 结果并设置有界升级/失败；保持 Unix process-group 语义独立。 |
| CP-05 | 中 | 确认缺陷 | Windows | 2026-07-25 本机 `pnpm test --unit` 实跑为947通过、0 skip、6失败；其中5个失败与平台有关：runtime fixture 删除目录 `EPERM`（`src/daemon/runtimeContractBaseline.test.ts:34-159`）、模拟 Linux 时仍使用宿主 `node:path`（`src/runtime/worker/sessions/runtimeSessionPreparation.ts:133-146`）、直接执行 `.bin/tsx` 产生 `ENOENT`（`src/server/turn-gateway/gatewayTransports.test.ts:1-180`）以及 CP-04。另一项CSS失败与平台无关。 | 不用跳过掩盖；fixture stop 后等待 exit，再清目录；测试用 platform path adapter；CLI/MCP 测试统一走跨平台 executable seam。 |
| CP-06 | 中 | 确认缺陷 | Windows；最小化 Unix 环境 | `package.json:42` 的 `pnpm run stop` 直接调用 `pkill`；Windows 默认 shell 没有该命令，精简 macOS/Linux 环境也不保证存在。`package.json:52-55` 的 worktree/E2E 命令同样要求 Bash。 | 用小型 Node 入口承担共享生命周期；确实只支持 Bash 的辅助命令必须在命名和文档中标明前置条件。 |
| CP-07 | 中 | 高概率风险 | Windows | 各 runtime session 的 `stop()` 多数只对直接 child 调用 `SIGTERM`（如 `src/daemon/claudeRuntime.ts:142`、`src/daemon/codexRuntime.ts:287`、`src/runtime/adapters/piRpcRuntimeV2.ts:159`）。Windows 没有 Unix process-group 语义，CLI 若产生后代进程可能残留。 | 将 runtime termination 收口到可等待的跨平台进程树 Port；普通退出、超时、取消和 Desktop shutdown 共用，不在每个 adapter 复制信号代码。 |
| CP-08 | 中 | 高概率风险 | Windows 构建机 | `scripts/package-desktop.mjs:40-58` 会原地把共享 `node_modules` / pnpm store 中的 `better-sqlite3` 从 Node ABI 重建为 Electron ABI，再在 `finally` 恢复。并行测试、强杀或恢复失败可能污染开发环境或打包产物。 | 在隔离 staging/appDir 中重建；至少增加互斥、ABI pre/post assertion 和恢复失败诊断。 |
| CP-09 | 中 | 确认缺陷 | 所有 OS 的 HTTP LAN 浏览器 | Chat 的复制入口直接调用 `navigator.clipboard` 并吞掉失败（`web/src/views/Chat.tsx:123,400,813`），绕过已有 `web/src/clipboard.ts:1-28` 降级；非 secure context 下会静默不复制。`RuntimeSettings.tsx:192-198` 也绕过共享 helper。 | 所有复制动作统一走 `copyText`，保留明确成功/失败反馈，并覆盖 Clipboard API 缺失/拒绝。 |
| CP-10 | 中 | 高概率风险 | Windows | 当前凭据/配置/helper 已正确停止检查 Windows 合成的 POSIX `mode/uid`，但 `src/security/posixFileMetadata.ts:8-17` 在 Windows 依赖用户 profile/app data 的继承 ACL，没有主动验证 DACL。若用户显式放宽目录 ACL，安全强度与 POSIX owner/mode 门禁不完全对等。 | 当前修复保持；后续以独立 Windows ACL Adapter 读取 owner/DACL 并加真实 NTFS fixture，不能恢复错误的 POSIX mode 判断。 |
| CP-11 | 中 | 验证缺口 | macOS / Linux | 所有 runtime npm 包都通过同一 catalog 安装（`src/local-runtime/runtimeSetupCatalog.ts:14-69`），只有 Windows `.cmd` 后缀分支；缺少按 OS/arch 的包可用性、安装、登录、模型发现、MCP 和取消 smoke。 | catalog 增加经过验证的平台能力数据；三端分别跑 managed install 与 system CLI smoke，未验证组合明确返回 unsupported。 |
| CP-12 | 低 | 明确延后 | macOS / Linux | Desktop/Tray/Window 统一使用 ICO（`src/desktop/desktopIcon.ts:9-12`）；登录启动只声明 win32/darwin，Linux 显式不支持（`src/desktop/main.ts:102-111`），darwin 的 `--hidden` 行为也未实机验证。 | 保留现有 seam，按 platform + 用途提供 ICO、ICNS/template PNG、Linux PNG；登录启动按平台实现并做签名应用实测。 |
| CP-13 | 低 | 验证缺口 | macOS / Linux | P-A9 CLI smoke 是 PowerShell + `.cmd` 专用，非 Windows 整段 skip（`test/pA9BaselineScripts.unit.test.ts:11-15,75-154`），没有 Unix wrapper、PATH、timeout/process cleanup 的对称测试。 | 保留 Windows 测试，新增 POSIX fixture；共享断言下沉为 Node，平台层只负责启动器。 |
| CP-14 | 低 | 验证缺口 | macOS / Linux | 本轮已把首次准备路径改为 `<仓库目录>`、显式标注 shell/发行边界，并把 bug report 改为 OS + version + arch（`docs/dev-commands.md:12-18`、`.github/ISSUE_TEMPLATE/bug_report.yml:57-82`）；但隔离 profile 与贡献流程仍只有 PowerShell 示例（`docs/dev-commands.md:47-51`、`CONTRIBUTING.md:18-22,77-82`）。 | shell 专属命令补 PowerShell/POSIX 对照。 |
| CP-15 | 高 | 确认缺陷 | Windows | managed runtime 安装通过 `npm.cmd` 启动，但 `src/local-runtime/runtimeSetupService.ts:31-37,54-74,275-283` 的超时终止只 kill 直接 child；`cmd.exe`、npm/node 后代可能继续写 staging，1 秒后调用方仍结束等待。 | 复用统一进程树终止器；Windows `taskkill /T /F` 并检查结果，POSIX 保持 detached group；只有进程真正退出或明确报告失败后才能 settle。 |
| CP-16 | 中 | 高概率风险 | Windows / macOS / Linux | 模型发现超时只 kill 直接进程且 Promise 依赖 `exit`（`src/daemon/listModels.ts:243-260`）；Pi v2 启动取消直接 kill（`src/runtime/adapters/piRpcRuntimeV2.ts:155-161`）；Claude maintenance 无显式 credential 时也绕过 tree terminator（`src/runtime/worker/maintenance/claudeMaintenanceRuntime.ts:88-125`）。这些路径可能遗留后代或悬挂。 | 启动、探测、取消、超时统一使用可等待的 runtime process tree 句柄，并有最终强制完成上限。 |
| CP-17 | 中 | 确认缺陷 | Windows / macOS / Linux | Hermes turn side-channel 临时文件只在成功 bridge 后删除；spawn error、非零退出、missing-session retry 和 stop 不清理（`src/daemon/hermesRuntime.ts:188-257,294-300`），会在系统临时目录永久遗留 turn JSONL。 | 用单一幂等 finalize/finally 覆盖所有终态，随机独占创建临时目录/文件，并增加失败、重试、停止清理测试。 |
| CP-18 | 低 | 验证缺口 | Windows | `src/advisor-provider/providerArtifact.ts:9-20` 手工解析 PATH/PATHEXT，缺少带引号 PATH 项、命令已含扩展名和自定义 PATHEXT 的平台测试。当前主要调用无扩展命令，尚无产品故障证据。 | 把 Windows executable resolution 固化为定向测试；若发现语义差异，优先复用已有 `cross-spawn`/统一 resolver，不继续扩写散落解析。 |

## 3. 已确认的兼容基础

以下项目已检查，不应在后续改动中倒退：

- 共享磁盘路径主要使用 `node:path`、`os.homedir()`、`os.tmpdir()` 和 `path.delimiter`；没有 tracked path 大小写冲突或反斜杠文件名。
- runtime CLI 启动已统一经过 `src/daemon/runtimeProcess.ts` 的 `cross-spawn`，可解析 Windows npm `.cmd` shim。
- Windows Space root 比较做大小写归一；symlink/realpath/数据库位置检查集中在 Space root 边界。
- `*.sh`、`*.bash` 和 `drizzle/*.sql` 已由 `.gitattributes` 固定 LF；workspace journal 只对白名单中的历史 Windows CRLF hash 兼容。
- Vite alias 使用 URL/path API；测试 runner 使用临时 profile，不依赖固定 `/tmp`。
- 凭据、CLI 配置和 Pi helper 已统一使用平台文件元数据策略：macOS/Linux 保留 uid/mode fail-closed，Windows 不再误用 Node 合成的 POSIX mode。

这些是静态审计和当前 Windows 证据，不等于 macOS/Linux 已完成产品验收。Windows 私密凭据文件现在还会通过 `src/security/privateFileSecurity.ts` 从空 DACL 确定性重建 owner/Allow 规则，并验证 owner 必须是当前用户且仅当前用户拥有 Allow ACE，避免依赖 `icacls /remove:g` 在不同宿主上的保留行为；POSIX 继续按 owner/mode fail closed。文本型契约测试读取磁盘文件时先统一 CRLF/LF，再验证与换行无关的语义，避免 checkout 策略改变测试结果。

## 4. 后续处理顺序

1. **观察三端 CI 首轮结果**：处理 Windows/macOS/Linux runner 暴露的真实差异，不用平台 skip 掩盖。
2. **补齐平台专项 smoke**：CP-11/CP-13/CP-18；分别验证 managed/system runtime、POSIX wrapper/PATH/cleanup 与 Windows PATHEXT。
3. **补齐文档与 Desktop 资源**：CP-12/CP-14；增加 PowerShell/POSIX 对照及平台图标、登录启动实机证据。
4. **平台发行独立切片**：先完成 Windows 签名/安装生命周期，再分别设计 macOS 和 Linux packaging，不把三平台塞进一个条件分支文件。

## 5. 新功能验收模板

涉及文件、进程、runtime、Desktop 或 native dependency 的改动，在 PR 中回答：

- 路径、大小写、换行、symlink/junction、临时目录在三端分别是什么语义？
- 可执行文件是原生 binary、`.cmd`/`.bat`、shell script 还是 app bundle？由哪个无 shell-injection 的 Port 启动？
- 普通退出、取消、超时、崩溃时，父进程和所有后代如何被等待与回收？
- 权限检查使用 POSIX uid/mode 还是 Windows owner/DACL？是否把某平台的合成字段当成事实？
- Electron/native module 是否声明 OS、arch、ABI、图标、签名/公证和安装生命周期？
- 哪些行为由平台无关测试覆盖，哪些必须由 Windows/macOS/Linux runner 或真实 smoke 覆盖？
- 若某平台仍 unsupported，是否在能力探测、UI、错误和本文清单中显式记录，而不是静默失败或无条件 skip？
