# Kith-space 产品定位

> 本文负责回答“这是什么、给谁用、明确不是什么”。完整本机化规格见 `../superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`。

## 一句话定位

Kith-space 是桌面优先、单人使用的个人 AgentOS：一个 Human 和本机一队有身份、职责、记忆的 agent，在多个本地 Space 中通过频道、私聊、任务和 MCP 模块持续协作。

agent 由用户电脑上已有的 Claude Code、Codex、opencode 等 runtime 承载。Kith-space 不自研 runtime，专注建设协作空间、上下文、记忆、编排和模块工具。

## 目标用户与核心场景

Kith-space 只服务当前电脑的使用者。这个 Human 可以创建多个根植本地文件夹的 Space；每个 Space 有自己的频道、任务、agent 队伍和记忆。Human 可以 @leader 提需求，也可以直接与任意 agent 私聊；agent 能拆解、分派、汇报并经 MCP 操作任务、记忆，以及未来的日历、画布和邮箱。

角色是通用职责，不是固定岗位。leader、research、writing、testing 只是可选起点；开发、研究、写作和生活管理在产品里地位相同。

## 产品形态

正式产品只有 Electron Desktop 安装包。Desktop 自动管理本机 Core Service、Local Runtime Worker 和 React UI，不要求普通用户配置服务或 `.env`。

浏览器访问是 Desktop 运行期间的附属入口，不是独立 Web 产品。用户可选择关闭、仅本机或局域网访问；所有浏览器首次访问都需要访问 Token。浏览器中的使用者仍是同一个 Human，数据和 agent 都留在 Desktop 所在电脑。

Windows 是 v1 正式平台，macOS 和 Linux 后续支持。局域网 v1 只做 HTTP，限受信任私网；HTTPS 与 runtime 权限升级是高风险外部内容模块上线前的硬前置。

## 核心理念

### harness 优先

产品把工具、上下文、记忆和协作协议搭好，让通用 agent 自主决定如何工作，不为开发、客服或其他具体场景硬编码流水线。

### agent 是长期团队成员

每个 agent 有稳定身份、职责和记忆，并在频道、私聊、任务和执行轨迹中持续在场。产品不能为了自动化把这种协作手感压成无声任务队列。

### local-first

中央 `app.db` 保存唯一 Human、Desktop/Web 设置和 Space registry；每个 Space 的业务数据保存在 `<space>/.kith/workspace.db`，文件和附件只落本地磁盘。本机跨 Space 聚合属于长期路线，云同步不属于路线。

## 明确非目标

以下不是“v1 延后”，而是产品永久边界：

- 多真人、团队账号、邀请、Human membership、RBAC 和 Human-Human DM。
- 多 agent 主机、远程 daemon、机器加入和跨电脑运行。
- 公网部署、SaaS、独立 Web 发行、云同步和云数据库。
- Docker 部署、公共 server/daemon 包、PWA、push 和移动 Web。
- 自研 agent runtime。

邮箱、日历、画布、记忆增强、本机跨 Space 聚合、HTTPS、macOS/Linux 属于后续能力，不应与上述永久非目标混淆。

## 源项目关系与许可证

- open-tag（Apache-2.0）是代码底座，复用消息、频道、任务、daemon 和 runtime 适配骨架；它的服务器部署、多用户和多机器产品假设会被清除。
- OpenLoaf（AGPLv3）只作视觉和产品思路参考，禁止复制源码。
- openagents 和 zano 是历史研究与局部交互参考，不定义产品路线。

Kith-space 保持纯开源与宽松许可（Apache-2.0/MIT）。
