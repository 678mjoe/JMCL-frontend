# JMCL Frontend Agent Guide

## 项目定位

本仓库是 JMCL 启动器的桌面 GUI。界面不直接实现 Minecraft 安装、文件校验、Java 启动或进程监管；这些工作由 `jmcl-core` 完成。GUI 通过 Tauri Rust 中间层启动 `jmcl-core rpc`，并使用 JSON Lines RPC 通讯。

协议与行为的权威来源是根目录的 `gui-handoff.md`。`backend-binaries/jmcl-core` 是当前开发用 ReleaseSafe 二进制；该目录中的平台二进制不纳入 Git。需要核对实现细节时，可读取 `../../JMCLCore`，但不得用源码中的偶然行为替代 `gui-handoff.md` 的公开契约。

## 技术栈

- 桌面框架：Tauri 2
- 前端：React 19 + TypeScript 6
- 构建工具：Vite 8
- 样式：Tailwind CSS 4
- 组件体系：shadcn/ui，底层使用 Base UI
- 图标：Lucide React
- 通知：Sonner
- Rust 异步运行时：Tokio
- 序列化：Serde / serde_json
- 包管理与前端脚本：Bun

不要引入第二套组件库、CSS-in-JS 方案或另一套状态管理框架。优先复用 `src/components/ui/` 中已有的 shadcn 组件，并使用 Tailwind 工具类和 `cn()` 组合样式。

## 常用命令

```bash
bun install
bun run dev
bun run build
bun run tauri dev
bun run tauri build
cargo test --manifest-path src-tauri/Cargo.toml
```

Vite 开发端口固定为 `1420`。`bun run build` 同时执行 TypeScript 类型检查和 Vite 生产构建。

## 目录与职责

### 前端

- `src/App.tsx`：应用外壳、侧边栏导航、Provider 组合和 core 状态。
- `src/pages/`：页面级 UI；当前包括实例列表和设置。
- `src/components/`：业务组件，例如实例卡片、创建实例对话框和日志面板。
- `src/components/ui/`：shadcn/ui 基础组件。新增通用控件时遵循这里的结构和样式。
- `src/lib/rpc.ts`：前端唯一的 core RPC 客户端入口；包含 `CoreSession` 和方法封装。
- `src/lib/types.ts`：与 core 契约对应的共享类型。RPC 字段保持 core 的 `snake_case`。
- `src/lib/launcher.tsx`：共享 core 会话、连接状态和额外会话创建。
- `src/lib/tasks.tsx`：安装和启动等长任务，负责事件流、进度和日志状态。
- `src/lib/settings.tsx`：本地设置及持久化。
- `src/lib/i18n.ts`：中文和英文文案。所有新增用户可见文本必须同时补齐两种语言。
- `src/lib/loaderVersions.ts`：Fabric、NeoForge 和 Forge 加载器版本目录请求。
- `src/App.css`：Tailwind 入口、shadcn 主题变量和全局动画。

`@/` 映射到 `src/`。跨目录导入优先使用该别名。

### Tauri / Rust

- `src-tauri/src/lib.rs`：Tauri commands 和 RPC 事件桥接。
- `src-tauri/src/session.rs`：协议 v1 会话状态机、请求与终止事件处理。
- `src-tauri/src/pool.rs`：多个 core 会话的生命周期管理。
- `src-tauri/src/transport.rs`：面向行的 transport 抽象及本地子进程实现。
- `src-tauri/tests/rpc_smoke.rs`：使用 `backend-binaries/` 中真实 `jmcl-core` 的协议冒烟测试。

`LineTransport` 是传输边界。未来 SSH transport 应实现同一抽象，不应把 SSH 判断散布到 session、Tauri command 或 React 代码中。

## RPC 约束

- 启动方式为 `jmcl-core rpc`。
- stdin 写入一行一个请求；stdout 输出一行一个协议事件；stderr 仅用于诊断。
- 协议 v1 的单个 session 同时只能有一个请求。`CoreSession` 会串行化同一会话的调用。
- 并发任务必须使用额外 session；不得从两个 session 并发修改同一个实例目录。
- 请求产生零到多个非终止事件，最后必须得到一个 `result` 或 `error`。
- 未知响应字段必须忽略。上游允许增加字段而不提升协议版本，因此 TypeScript 和 Rust 解析都应保持 additive-tolerant。
- 安装任务可启用中间层事件压缩：丢弃高频 `file` 事件，并将 `progress` 合并到约 100 ms 一次。不得丢弃阶段切换、错误或终止事件。
- 进度百分比优先使用 `bytes_processed / bytes_total`；文件数量仅作为辅助信息。
- `installed` 完全以 `instance.list` / `instance.get` 的 core 返回值为准，不得通过本地文件存在性或 UI 历史自行推断。
- 所有实例路径和共享 store 路径应传绝对路径。所有实例共用一个 `store_directory`。

## Core 二进制与上游更新

开发时 core 路径按以下方式解析：

1. 显式传入的路径；
2. `JMCL_CORE` 环境变量；
3. 应用可执行文件附近或父目录中的 `jmcl-core`，用于打包后的 sidecar；
4. 应用可执行文件各级父目录下的 `backend-binaries/jmcl-core`，用于开发仓库。

当用户说明上游已更新时：

1. 先读取最新 `gui-handoff.md`；
2. 使用根目录新二进制直接复现对应 RPC；
3. 更新 `src/lib/types.ts` 和 `src/lib/rpc.ts` 的契约；
4. 检查所有 React 消费方；
5. 对新增或变化的可观察契约补充真实 core 回归测试；
6. 不保留旧字段别名或兼容 shim，除非契约明确要求。

## UI 约定

- 使用函数组件和 React hooks。
- 页面负责数据加载和页面级状态；可复用业务行为放入 `src/lib/` context 或 hook。
- 长时间安装、启动和后续内容下载必须在独立 RPC session 中运行，并在 UI 中展示运行、成功和失败状态。
- 对话框必须适配较矮窗口：内容区域可滚动，标题和操作栏保持可见。
- 所有异步操作都要提供 loading、empty、error 和 retry 状态；不得只依赖 toast 表达持续状态。
- 使用现有 shadcn 颜色变量，例如 `bg-background`、`text-muted-foreground`、`text-destructive`，不要硬编码一套新配色。
- 主题必须同时支持浅色、深色和跟随系统。
- 动画应遵守 `prefers-reduced-motion`。
- 交互控件必须有可访问名称；进度控件使用正确的 `role` 和 ARIA 数值。
- Minecraft 测试版过滤使用 `version.list` 的 `type: "release"`，不要依赖版本 ID 字符串猜测版本类别。

## 网络与文件边界

- Minecraft 元数据解析、游戏文件下载、校验、安装、内容落盘和游戏进程监管属于 core。
- GUI 可直接访问目录型第三方 API，例如 Modrinth、CurseForge 及加载器版本目录；在 Tauri WebView 中统一通过 `@tauri-apps/plugin-http`，不要依赖浏览器 CORS 行为。
- GUI 不应直接修复 `.minecraft` 内的 core 管理文件。
- 被禁用内容在磁盘上是 `<file>.disabled`；只能调用对应的 enable、disable、remove RPC。
- `manual` 内容不能执行 `set-version`。

## 凭据与日志

- Microsoft Entra client ID、CurseForge API key 和 OAuth refresh token 均由 GUI 提供，core 不持久化。
- refresh token 应存入系统钥匙串，禁止进入 `localStorage`、普通配置文件或日志。
- refresh token 轮换后必须先原子持久化，再使用新 session；即使返回 `exchange_failed` 也必须先保存轮换 token。
- 不得记录完整认证请求、认证响应、access token、refresh token、device code 或 API key。
- `account.microsoft.*` 只保存公开账户元数据，不保存 token。

## 当前功能状态

已实现：

- core 本地进程与可扩展 transport 中间层；
- 实例创建、列表、删除和权威安装状态；
- Minecraft 正式版/测试版过滤；
- Fabric、NeoForge、Forge 加载器版本选择；
- 游戏安装、字节级进度和加载器处理器进度；
- 离线启动、游戏进程日志和终止状态；
- 主题、语言、下载源和目录设置。

尚未形成完整 UI 的主要能力：

- Microsoft 登录、账户选择和系统钥匙串；
- 实例详情页；
- Mods、资源包、光影包的管理与目录搜索；
- 整合包导入；
- Java 运行时管理；
- Store GC 和高级启动选项。

## 验证要求

- TypeScript 或 React 改动至少运行 `bun run build`。
- Rust、中间层或 RPC 事件改动至少运行 `cargo test --manifest-path src-tauri/Cargo.toml`。
- UI 改动必须启动应用或 Vite 页面，实际操作变化路径并检查最终状态；仅通过类型检查不算完成。
- RPC 行为变化必须使用 `backend-binaries/` 中真实 `jmcl-core` 验证，不能只依赖 mock。
- Bug 修复应先复现，再确认同一场景不再失败。
- 测试应覆盖用户可观察的契约，不要断言源码文本、样式实现细节或内部调用次数，除非调用次数本身是协议约束。
