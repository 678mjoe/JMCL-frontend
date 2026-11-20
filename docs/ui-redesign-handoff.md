# JMCL UI 重设计交接

截至 2026-11-20，桌面界面重设计已完成。本轮改动在 `ui-redesign` 分支，基线是 `9c0fd81`。视觉改版和共用控件打磨记录在 `bc0b32a`，新建实例表单的第二轮调整记录在 `77dc287`。

桌面端通过 Tauri 连接 Zig Core，浏览器预览使用 Mock。

## 已交付

- 实例、服务器、Java、设置共用侧栏导航、页面标题和控件样式。浅色用暖灰底，深色用暖深灰，主操作采用低饱和蓝灰。卡片用细边框，浮层和弹窗使用轻阴影。
- 首页保留快速启动区和其他实例列表。实例详情、内容管理、启动日志、整合包导入和安装任务沿用同一套布局。切换页面后仍可查看正在进行的安装任务。
- 新建实例时，名称独占一行，游戏版本和加载器在有足够空间时并排，实例标识按需展开。游戏版本在弹窗内搜索，可切换是否仅显示正式版。返回表单时保留草稿并恢复焦点。
- 服务器列表、详情、控制台及管理面板，Java 运行时列表和设置页统一了栏位、留白、按钮高度与窄窗换行。

## 代码和素材

- 应用壳负责四个入口及全局任务视图。配色、焦点、间距及浮层样式由主题和基础控件统一管理。[应用壳](../src/App.tsx) · [主题样式](../src/App.css) · [基础控件](../src/components/ui/)
- 快捷启动卡片和新建实例弹窗是首页与创建流程的入口。实例操作使用目录、实例 ID 和端点上下文，连接与任务状态由全局状态管理。[快捷启动卡片](../src/components/InstanceCard.tsx) · [新建实例](../src/components/CreateInstanceDialog.tsx) · [GUI 集成契约](../gui-handoff.md) · [前端与 Core 能力表](frontend-core-capability-report.md)
- 随包分发的方块是 Pixel Perfection CE 的磨制安山岩纹理，由 CSS 投影为三个面。该纹理偏暖，纹理排列比本地原版预览更规则。开发模式可通过 `VITE_JMCL_FEATURE_BLOCK_PREVIEW` 指定个人预览图，预览文件放在开发机且位于 `public/` 之外。[素材和许可](../public/jmcl-feature-andesite.LICENSE.txt)
- 应用内标志和桌面图标各有素材入口。[应用内标志](../public/jmcl-mark.png) · [桌面图标](../src-tauri/icons/)

## 复现与验证

使用仓库锁文件安装前端依赖，启动 Mock 预览。浏览器入口是 `http://127.0.0.1:1420/`。

```sh
bun install --frozen-lockfile
bun run dev:mock --host 127.0.0.1
```

```sh
bun run test
bun run build
bun run test:e2e
```

Playwright 使用已安装的 Chromium，并启动自己的 Mock 服务。运行默认配置前请释放 1420 端口。

| 环境 | 验证结果 |
| --- | --- |
| 前端 | 591 项单测、12 项 Playwright 测试和生产构建通过。Mock 覆盖创建、安装、启动和日志，另检查中英文、浅深色及窄窗布局。 |
| Apple Silicon macOS | 使用 CI 固定的 Zig Core `5a4310de` 构建和暂存 arm64 sidecar，9 项原生 RPC 冒烟测试通过。 |
| macOS 原生界面 | 在独立应用标识和测试目录下验证了 Core 连接、官方版本目录搜索、原版 1.21.4 安装与启动、运行日志及设置重启后持久化。打包的首页纹理已查看，应用图标和 Core 二进制已与构建输入核对。 |

原生开发使用匹配架构的 sidecar。以 CI 固定的 Core 版本为准，按开发指南暂存并启动。[CI 配置](../.github/workflows/quality.yml) · [开发指南](development.md)

## 剩余原生验收

- **归档选择。** macOS 文件选择器可打开和取消。测试归档选中后，「打开」按钮仍置灰，选档并回到应用内预览的流程待核对。
- **从游戏内正常退出。** 本轮向隔离 Java 进程发送 `SIGTERM`，启动器记录退出码 143。仍需从 Minecraft 菜单退出，确认正常退出码和日志。
