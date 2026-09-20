# JMCL Frontend Roadmap

本文记录 JMCL-frontend 的长期目标、当前实现状态、平台分工、阶段划分和验收标准。它用于跨日续作、任务委派和阶段复盘。

`gui-handoff.md` 是从 JMCLCore 复制的权威 RPC 契约。路线图描述 GUI 的实施顺序，不替代契约；两者冲突时，应先核对 JMCLCore，再同步契约副本。

## 1. 项目目标

JMCL-frontend 的目标是构建完整的 Minecraft: Java Edition 桌面管理器，覆盖两类使用场景：

1. 管理本机 Minecraft 客户端实例；
2. 通过 SSH 管理远端 Linux Minecraft Server。

最终范围包括：

- 原版、Fabric、NeoForge、Forge 客户端实例；
- 离线账户和 Microsoft 正版账户；
- Java 运行时检测、托管安装和实例级选择；
- Mod、资源包、光影、数据包和整合包；
- 客户端世界存档；
- 远端服务器创建、安装、启停、重启和状态；
- 服务端日志、控制台、RCON、Query 和 `server.properties`；
- 服务端世界、Mod 和数据包；
- macOS、Windows 桌面构建和发布。

## 2. 架构方向

```text
React 19 + TypeScript
        │
        │ Tauri invoke / Channel
        ▼
Rust/Tauri RPC bridge
        │
        │ JSON Lines over stdin/stdout
        ▼
jmcl-core rpc
        │
        ├─ 客户端安装与启动
        ├─ 内容与世界管理
        └─ Linux Minecraft Server 管理
```

本地模式使用 `LocalProcessTransport` 启动 `jmcl-core rpc`。

远端服务器模式计划增加 SSH transport，第一版优先复用系统 OpenSSH：

```text
ssh user@host jmcl-core rpc
```

这样可复用用户已有的 SSH key、`~/.ssh/config`、known_hosts、ProxyJump、ControlMaster、SSH Agent 和硬件密钥，不在 JMCL 中另造密码协议。

## 3. 平台与测试分工

### Raspberry Pi

Pi 是无头开发、core 和服务器测试节点，不是最终桌面 UI 运行目标。

Pi 负责：

- 源码编辑与 Git；
- Bun/TypeScript 测试；
- Vite production build；
- Vite browser mock 页面；
- 浏览器自动化、截图和控制台检查；
- Rust 格式检查和可独立执行的纯逻辑测试；
- JMCLCore 编译和测试；
- Linux-only `server.*` RPC 真实测试；
- 测试用 Minecraft Server；
- SSH 远端目标。

Pi 不为完整 Tauri GUI 安装 GTK/WebKit 开发依赖。

### macOS

macOS 是主要桌面集成与 UI 验收平台，负责：

- Tauri 原生窗口和 WebView；
- macOS Keychain；
- Microsoft Device Code 登录；
- 原生文件对话框；
- macOS `jmcl-core` sidecar；
- SSH transport 连接 Pi；
- Minecraft 客户端实际启动；
- 应用打包和交互验收。

### Windows

Windows 负责兼容性和发布验证：

- Credential Manager；
- Windows 路径和保留文件名规则；
- `.exe` sidecar；
- WebView2/Tauri 打包；
- Java 检测；
- Minecraft 启动；
- Windows 安装器和进程行为。

### 验证层级

每项功能应明确通过了哪一层验证：

1. **Pi 自动验证**：类型检查、测试、Vite build、core/RPC 测试；
2. **桌面编译验证**：macOS/Windows Tauri、sidecar、keychain、原生 API；
3. **真实 UI 验收**：实际点击、长任务反馈、重连、游戏或服务器运行。

Pi 上的 Vite build 不能被描述为完整桌面验收。

## 4. 当前状态

### 已实现的客户端能力

- 多实例管理；
- 原版、Fabric、NeoForge、Forge；
- Official 和 BMCLAPI；
- 后台版本/加载器验证；
- 安装、prepare、启动、重装和删除；
- 文件数和字节级进度；
- 离线账户；
- Microsoft Device Code、多账户和 refresh token 轮换；
- OS keychain 凭据存储；
- 本地与托管 Java；
- 推荐 Java 主版本和实例级 `java_override`；
- Modrinth Mod、资源包和光影管理；
- 内容启停、删除、接管、升级和降级；
- 世界列表、元数据、锁定、重命名、复制和删除；
- 世界导入、导出、备份和恢复；
- stdout、stderr 和 core 诊断日志；
- 中英文和明暗主题。

### 尚未实现的客户端能力

- 世界级数据包；
- 完整整合包导入 UI；
- CurseForge；
- store GC UI；
- 高级 JVM/游戏参数；
- 资源包和光影的游戏内激活顺序；
- Shader runtime 指引；
- 自动更新。

### 服务器 GUI

阶段 1A 已完成：服务器领域类型和完整 `server.*` RPC 层已完成；服务器 UI、状态机、Mock 生命周期和 SSH transport 尚未完成。

JMCLCore 已实现主要 `server.*` 能力，但 JMCL-frontend 尚未实现：

- SSH transport；
- 连接配置；
- 服务器页面；
- 状态轮询和日志游标；
- 控制台、RCON 和 Query；
- properties；
- 服务端世界、Mod 和数据包 UI。

## 5. 已完成：阶段 0——稳定开发基线

基线提交：

```text
5cee089 feat: establish browser development baseline
```

契约同步提交：

```text
01c872a docs: sync GUI integration contract from JMCLCore
```

阶段 0 已完成：

- Bun、Rust stable 和 Zig 0.16 开发环境；
- ARM64 `jmcl-core` 构建和 protocol v1 握手；
- 显式、开发态限定的 Vite mock transport；
- `default`、`empty`、`errors` 场景；
- app-data、keychain、dialog、opener native adapter；
- 同实例 mutation 协调，不同实例并发；
- 路径 key 规范化；
- session open/close 和登录取消清理；
- stdout/stderr 独立缓冲及错误尾部冲刷；
- managed Java runtime 启动进度；
- `launch.execute` 顶层 wire 参数测试；
- 账户、Java、内容、世界的可变 mock；
- 世界错误码与 replace 语义；
- Bun 单元/集成测试；
- Rust 格式基线；
- 中英文 README 更新。

阶段 0 最终自动验证：

```text
bun run test: 21 pass, 0 fail
bun run build: pass
cargo fmt --check: pass
zig-0.16 build test: pass
git diff --check: pass
```

已知非阻断项：

- production JS 主 chunk 约 612 kB，Vite 提示超过 500 kB；
- Vite HTTP readiness 已验证，但仍应补一次 default/empty/errors 的真实浏览器视觉走查；
- Pi 不执行完整 Tauri 编译，原生验证留给 macOS/Windows。

## 6. 阶段 1——服务器领域模型、RPC、状态机和 Mock UI

阶段 1 不依赖真实 SSH。目标是先在 Vite mock 中把服务器产品模型和基础交互走通。

### 1A. 领域类型与 RPC

根据 `gui-handoff.md` 定义：

- `ServerManifest`；
- `ServerStatus`；
- `ServerInstallResult`；
- `ServerLogResult`；
- `ServerProperties`；
- `ServerQueryResult`；
- `ServerRconResult`；
- `ServerWorld`；
- `ServerBackup`；
- 服务端内容类型和稳定错误码。

增加完整类型化封装：

```text
server.create/list/get/delete
server.install
server.start/stop/restart/status
server.logs
server.command
server.rcon.command
server.query
server.properties.get/set
server.worlds.*
server.mods.*
server.datapacks.*
```

关键请求必须有 wire-shape 测试，避免宽松 mock 掩盖顶层字段错误。

### 1B. 状态机

集中表达三个基础状态：

```text
已创建、未安装
已安装、已停止
运行中
```

以纯函数集中决定可用操作，不在组件中重复散落判断。

状态矩阵至少覆盖：

- install/repair；
- start；
- stop/restart；
- logs/command；
- properties 读写；
- 世界修改；
- Mod/数据包修改；
- delete。

core 始终进行最终校验；GUI 状态机只负责正确启用控件和提供恢复操作。

### 1C. Mock 与基础 UI

Mock 场景至少包含：

- 空服务器列表；
- 已创建、未安装；
- 已安装、已停止；
- 运行中；
- stale state；
- EULA 未接受；
- Java 不兼容；
- 日志追加与轮换；
- RCON/Query 未启用；
- 服务端世界、Mod 和数据包 fixture。

第一批 UI 只实现：

- 侧栏“服务器”；
- 服务器列表；
- 创建服务器；
- 服务器详情；
- 安装；
- 启动、停止、重启；
- 状态；
- 日志；
- 控制台命令。

暂不在这一批展开完整 properties、RCON、Query、世界、Mod 和数据包操作页。

### 阶段 1 验收

在 Vite mock 中走通：

```text
打开服务器页
→ 创建服务器
→ 因未接受 EULA 被阻止
→ 显式接受 EULA并安装
→ 启动
→ 状态变为运行中
→ 日志按 cursor/file_id 追加
→ 发送命令
→ 停止
→ 删除
```

同时要求：

- 所有 `server.*` 方法有类型化封装；
- 状态矩阵有纯逻辑测试；
- default/empty/errors 场景可观察；
- `bun run test`、`bun run build`、格式检查通过；
- 不引入 SSH 或真实远端依赖。

## 7. 阶段 2——SSH Transport

阶段 2 把阶段 1 的 mock UI 接到远端 `jmcl-core rpc`。

实现：

- 本地/远端 endpoint 模型；
- SSH 连接配置；
- 系统 OpenSSH 子进程 transport；
- JSON Lines stdin/stdout；
- stderr 诊断；
- 连接超时和握手；
- 断线状态；
- 子进程清理；
- SessionPool 按 endpoint 管理；
- 不绕过 known_hosts；
- 不持久化 SSH 密码。

### 阶段 2 验收

- macOS/Windows GUI 能通过 SSH 对 Pi 调用 `core.version` 和 `ping`；
- 能读取 Pi 上的 `server.list`；
- 连接失败和协议不兼容有明确错误；
- SSH 断开不会被误判为服务器停止；
- 本地客户端 transport 不受影响。

## 8. 阶段 3——真实服务器生命周期闭环

把基础服务器页面接到 Pi 的真实 core：

```text
添加 Pi 连接
→ 列出服务器
→ 创建
→ 显式接受 EULA
→ 安装
→ 启动
→ 状态/日志
→ 控制台命令
→ 停止/重启
→ 删除
```

重点实现：

- `installed` 与 `running` 双状态；
- `server.status` 权威刷新；
- `stale_state`；
- 日志 `cursor`、`file_id`、`reset`、`truncated`；
- detached server 生命周期；
- EULA 显式确认；
- Java 错误引导；
- stopped-only/running-only 控件约束。

### 阶段 3 验收

- GUI 关闭或 SSH 断开后服务器继续运行；
- 重连后恢复状态与日志；
- Pi 上真实服务器完成安装、启停和命令链；
- 不依赖 GUI 保存服务器进程。

## 9. 阶段 4——服务器配置与高级控制

实现：

- `server.properties.get/set`；
- 字符串值保持；
- 未知字段保留；
- `rcon.password` 脱敏和禁止自动写回；
- RCON 即时密码输入，不缓存；
- Query basic/full；
- 玩家数和玩家列表；
- 结构化错误恢复。

安全边界：

- 不记录、缓存或遥测 RCON 密码；
- 不提供公网暴露 RCON/Query 的快捷操作；
- RCON/Query 仅连接 core 所在主机的 `127.0.0.1`；
- properties 运行中写入应被 GUI 和 core 双重拒绝。

## 10. 阶段 5——服务端世界管理

实现：

- base world 和维度兄弟目录；
- 停服后修改；
- 重命名并同步 `level-name`；
- 删除时级联维度目录；
- 全量服务器世界备份；
- 恢复和覆盖；
- 锁定与状态错误处理。

客户端世界组件可以复用视觉和交互模式，但不能直接套用客户端路径或生命周期假设。

## 11. 阶段 6——服务端 Mod 与数据包

实现：

- 服务端 Mod 列表、安装和版本切换；
- 启用、禁用、删除和接管；
- 服务端数据包；
- world-scoped registry；
- stopped-only mutation；
- Vanilla/Loader 适用性检查；
- Modrinth 搜索；
- 后续 CurseForge。

验收重点：

- Fabric/NeoForge/Forge 服务端 Mod 可管理；
- Vanilla 正确拒绝 Mod；
- Vanilla 允许数据包；
- 数据包可在首次启动前安装到正确 world。

## 12. 阶段 7——补齐客户端剩余功能

按优先级补齐：

1. 客户端世界级数据包；
2. 整合包导入；
3. CurseForge；
4. store GC；
5. 高级 JVM 和游戏参数；
6. 分辨率与启动选项；
7. 资源包/光影游戏内激活；
8. Shader runtime 指引。

## 13. 阶段 8——质量与发布

完成：

- React 单元测试扩展；
- 浏览器 E2E；
- RPC fixture/contract 测试；
- GitHub Actions；
- macOS/Windows build matrix；
- sidecar 平台矩阵；
- CSP 收口；
- 代码签名准备；
- 安装包；
- 自动更新；
- 用户文档；
- 首个发布标签。

## 14. 长期工程原则

- 先以真实 core 契约和错误码为依据，再写 UI；
- 公共 RPC wrapper 必须自己保证正确 wire shape，不能依赖宽松 mock；
- mock 必须是显式 development/test 能力，生产不可运行时切换；
- 同一实例/服务器 mutation 不并发，不同目标可并发；
- 长操作使用独立 session，不阻塞共享轻量 session；
- 不记录 access token、refresh token、API key、RCON 密码或未脱敏请求；
- 结构化处理稳定错误码，不解析可变 message；
- “测试通过”必须注明测试层级和平台；
- Pi 上不以安装图形依赖换取虚假的桌面验证；
- macOS/Windows 原生行为必须在目标平台验证；
- 每个阶段形成独立提交和可复现验收记录。

## 15. 最近下一步

1. 对阶段 0 的 `default`、`empty`、`errors` 页面做一次真实浏览器视觉走查；
2. 推送本地已验证提交，形成远端检查点；
3. 启动阶段 1A：服务器类型与全部 `server.*` RPC wrapper；
4. 再做状态机、mock 生命周期和基础服务器 UI；
5. 阶段 1 完成后才开始 SSH transport。
