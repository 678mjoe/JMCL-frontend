# JMCL UI 重设计交接

## 目标与工作区

在 `~/projects/JMCL-UI-Redesign` 的 `ui-redesign` 分支上，直接改现有 JMCL 桌面界面。起点是前端 `9c0fd81`，原始 `main` 工作目录在 `~/projects/JMCL-frontend/JMCL`，不要在那里改。目标是让 JMCL 有一致的视觉语言、清晰的信息层级和顺手的实例操作，不是另建一套前端，也不是做一份无法接回应用的静态原型。

**只替换表现层，保留现有能力和接口。** 可以重做导航、布局、样式、组件及界面内的交互编排；页面继续调用现有 hooks、回调和服务。浏览器预览使用仓库已有 Mock，生产仍走原有 Tauri → Zig Core 链路，不切 Rust Core。不要重写中间层、修改 RPC 方法或参数、调整数据存储、任务或账号逻辑，也不要改打包和 CI。需要超出 UI 的改动时，单独记录原因和方案，不在本分支顺手改掉。

## 从哪读、从哪改

- [GUI 集成契约](../gui-handoff.md) 和当前 Core 实现是协议与行为依据；[前端能力表](frontend-core-capability-report.md) 用于盘点界面已经接通的功能。契约列出某个 RPC，不代表现有 UI 已经接通，也不自动扩大这次重设计范围。
- [App.tsx](../src/App.tsx) 是应用壳、四个顶层入口（实例、服务器、Java、设置）和全局弹窗、任务面板的入口。允许重排，但不要因换页而卸载全局 providers，丢掉账号、任务或 Core 会话状态。
- [App.css](../src/App.css)、`src/components/ui/` 是现有主题和基础组件；`src/pages/` 是页面。使用当前 React、TypeScript、Tailwind/shadcn 体系即可。共用色彩、字体、间距、圆角和交互状态；保留中英文、主题、键盘焦点与可访问名称。
- [InstancesPage](../src/pages/InstancesPage.tsx)、[InstanceDetailPage](../src/pages/InstanceDetailPage.tsx)、[InstanceContentPage](../src/pages/InstanceContentPage.tsx) 是首轮样板。改变布局和交互时，保留原有实例 ID、目录和活动端点的传递，不能让同名实例的操作串到另一个目录或端点。
- [launcher](../src/lib/launcher.tsx)、[tasks](../src/lib/tasks.tsx)、[endpointContext](../src/lib/endpointContext.tsx)、[instanceCoordinator](../src/lib/instanceCoordinator.ts) 提供连接、任务、端点和互斥逻辑。复用它们，不在组件里重做状态源、绕开任务协调器或直接拼 RPC。账号与密钥继续走原有逻辑，不写进组件日志、截图或 Mock 数据。

## 建议的推进顺序

1. **先定壳和视觉方向。** 给实例、服务器、Java、设置明确的位置；让“当前实例”和“下一步能做什么”一眼可见。优先把实例列表、详情和启动状态做成一条真正可操作的样板，再将设计语言扩到其他页面。避免先全局换色却不解决层级和操作路径。
2. **让样板跑通主流程。** 在现有 Mock 中从列表进入详情、返回、打开内容页，覆盖创建、安装或修复、启动与日志。导入整合包后切换页面，仍应能看到任务进度和结果。保留现有账号、存档、内容管理、Java、服务器和设置入口，不用装饰性占位替换已有功能。
3. **补齐非理想状态。** Core 连接中、连接失败、列表为空和加载中应彼此可辨。关闭进度视图不是取消任务；重启后的恢复不是现有承诺。已有破坏性操作的确认、重复提交防护、稳定错误码、日志空行和失败重试语义继续保留。检查浅色、深色、较窄窗口、中英长文案及键盘操作。
4. **评审后再推广。** 交付应用壳、实例页的前后截图，以及可点的 Mock 主流程。记录哪些页面已改、哪些仍沿用旧 UI、哪些需要后续处理；不合并、不发布，除非另有明确安排。

## 本地预览与验收

依赖未装时使用锁文件安装。浏览器预览走现有 Mock，不需要 Tauri、Core 或真实账号。操作说明见 [development.md](development.md)。

```sh
bun install --frozen-lockfile
bun run dev:mock --host 127.0.0.1
```

提交评审前运行：

```sh
bun run test
bun run build
bun run test:e2e
```

Playwright 需要已安装的 Chromium，且会自己启动 Mock Vite；运行前先停掉占用同一端口的手动预览。[现有 E2E](../e2e/mock.spec.ts) 覆盖导航与返回、创建弹窗取消重开、连接失败与恢复、浏览器诊断限制、整合包后台进度和日志空行。重排 UI 时可更新面向用户的定位方式，但不要删掉原有行为断言。若测试没跑，注明原因；Mock 和构建通过不代表真实桌面、账号登录、游戏启动或打包通过。
