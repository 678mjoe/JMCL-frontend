# 前端 / Core 功能现状与后续实施报告

审计日期：2026-10-25。本报告以实际代码和 [GUI handoff](../gui-handoff.md)
为标准，区分“已经接入”“自动化验证”“真实环境待验收”“尚未实现”。它是实施状态和
建议顺序，不替代项目主人的产品路线图；路线图打勾、存在 RPC 方法名或 Mock 通过都不等于产品完成。

## 1. 基线与证据边界

- 前端审计基线：[9dc0b25](https://github.com/678mjoe/JMCL-frontend/commit/9dc0b25b2948a4df02b5ea89f0b90584190b8add)，已经包含五项整合包/普通安装 UX 改进。本次补缺代码及验证另见第 3 节。
- 当前配套 sidecar：**Zig Core** [5a4310de](https://github.com/678mjoe/JMCLCore/commit/5a4310debbcee26b3d2391bab2339f79cd6ec52e)。Core main 后续仅更新文档，不表示前端更换了这个二进制。
- Rust 重写：[06204812](https://github.com/678mjoe/JMCLCore/commit/06204812e24375fa4fa4483708c2685d634a563d)，独立 `rust-rewrite` 分支，不是目前安装包内的 Core。
- 之前交付的桌面包来自前端 `d1fcea49`，包含账户封装修复，但**不包含后来全部安装 UX 改进**。反馈问题时应记录安装包修订，不能用旧包结果验收新代码。

“已接入”表示真实 UI 存在生产调用链；“自动化验证”包括单元、Mock、原生合成夹具；
“真实验收”还需要对应安装包、账户/提供商、游戏或服务器环境。四平台原生 CI 不能代替真人
GUI 验收或真实服务交互。环境/凭据未提供属于验收前提缺失，不自动意味着实现错误。

## 2. 当前功能矩阵

文件路径相对于本仓库；RPC 按功能族概括，不代表每个可选参数都有 UI 控件。

| 功能与实际入口 | Core / 客户端边界 | 当前实现 | 尚缺内容或真实验收 |
|---|---|---|---|
| 多账户、离线/微软登录（`src/lib/auth.tsx`、账户组件） | `auth.microsoft.*`、`auth.minecraft.*`、`account.microsoft.*`；前端负责钥匙串 | 已接入；保存发送嵌套 `account`，读取解包账户 envelope；有合成原生契约测试 | 当前包完整授权→保存→重启→刷新→启动；中断轮换时不能假定旧 token 有效 |
| 实例（`InstancesPage`、`InstanceDetailPage`） | `version.list/resolve`、`instance.*`、`install.execute/prepare`、`launch.execute` | 原版/Fabric/Forge/NeoForge 创建、安装、修复、启动、删除已接入 | 真实 loader processor/游戏矩阵；没有安装计划预览是 UX 缺口，不等于安装协议错误 |
| 安装任务（`InstallationTasksPanel`、`InstallTaskProgress`、`lib/tasks.tsx`） | Core 下载/runtime/processor 事件和终态 | 普通安装和整合包共用进度展示；导航不丢任务；显示阶段、文件、重试 | 只保留当前进程内状态；退出、断线、未知结果不等于可持久恢复 |
| 本地整合包（`ModpackImportDialog`、`lib/modpackTasks.tsx`） | 有界原生清单预览→`modpack.install`→游戏安装/prepare | 文件选择/预览、后台任务、已知错误安全重试、完成摘要已接入 | 真实 Modrinth/CF 包跨系统验收；v1 只有跳过数量，没有逐文件解释；预览不等于完整验证 |
| 内容管理（`InstanceContentPage`、`ContentSearchDialog`） | 前端 HTTP 搜索；`mods.*`、`resourcepacks.*`、`shaderpacks.*`、世界 `datapacks.*` | 搜索、选版本、安装、切换、启停、移除、接管已接入 | 真实提供商错误/依赖冲突/凭据/游戏效果验收；单个模组搜索不等于在线整合包库 |
| 资源包/光影激活（`lib/packActivation.ts`、原生适配器） | 无 Core 激活 RPC；前端受保护的配置写入 | 支持的资源包/Iris/Oculus 格式已实现，包含 Windows 原生适配 | 未知/OptiFine 格式仍需手动或游戏内操作；文件测试不能证明游戏实际加载 |
| 世界管理（实例详情/内容页） | `worlds.*`、`datapacks.*` | 详情、重命名、复制、删除、导入导出、备份恢复、数据包已接入 | 游戏运行锁、真实恢复、跨版本提醒；可变世界保持私有，绝不硬链接共享 |
| Java（`JavaPage`、`InstanceJavaCard`、`lib/java.ts`） | `java.detect/select/runtime.*`、启动/安装 Java 参数 | 本地检测、托管 8/16/17/21/25 安装/移除已接入 **Zig**；本轮补偏好/架构/策略 | 本轮验证见第 3 节；不要与 Rust 尚未完成的自动获取混为一谈 |
| 服务器（`ServersPage`、`ServerDetailPage`、`lib/server*.tsx`） | 本地/SSH RPC；`server.*` 仅 Linux Core | EULA、安装、生命周期、日志、控制台、properties、RCON/Query、世界/内容已接入 | 获授权的真实 Linux SSH、断线重连、脱离会话生存、日志轮转、运行状态约束与负载 |
| 设置/维护（`SettingsPage`） | 根目录/共享仓库、来源/代理、钥匙串、`store.gc` | 路径、下载源、代理、语言主题、CF key、GC 已接入；本轮补下载参数 | 保持 GC dry-run 和共享不可变对象语义，不做 GUI 猜测式缓存删除 |
| 诊断 | 应用原生日志，与游戏/服务器日志分开 | 日志功能与 Windows 控制台隐藏已实现 | 当前版本完整登录/错误提示/日志脱敏与导出验收；旧 Windows 问题复现不作为本轮交付门槛 |
| 更新（`lib/updates.ts`、Settings） | Tauri 签名更新，非 Core RPC | 原生桥接/UI 已存在；默认渠道关闭 | 生产 feed、公钥/签名产物链、实际升级验收尚未建立；“不可用”不是“已是最新” |

源码入口：[RPC](../src/lib/rpc.ts)、[普通任务](../src/lib/tasks.tsx)、
[整合包任务](../src/lib/modpackTasks.tsx)、[用户指南](user-guide.md)、[发布门槛](release.md)。

## 3. 本轮使用既有 Core 能力补齐的前端缺口

以下代码已在本轮工作分支实现，尚待最终集成测试和发布结果确认；没有新增 Zig RPC。

| 缺口 | 基线问题 | 本轮实现 | 必须验证的行为 | 相对工作量 |
|---|---|---|---|---|
| Java 偏好按根目录隔离 | 旧 `javaOverrides[instance.id]` 会让不同根目录的同名实例串用路径 | 新偏好按 root + ID 标识；旧 override 保留为未激活提示，需用户填入路径、确认信任并主动保存到当前 root | 两个 root 同 ID 独立；不能静默迁移歧义旧偏好或偷偷强制覆盖 | 小—中 |
| 架构识别/主动装托管 Java | 只按 major 判断可能误认架构；本地同版本阻止主动安装托管版 | 使用打包进程平台/架构；区分本地与托管信息；允许同 major 主动托管安装 | 错误架构不显示满足目标；receipt 提示不冒充启动兼容证明 | 小—中 |
| Java 策略/自选候选 | 原来只有 auto 或强制可执行文件 | `auto/local/managed`；受信任绝对路径候选用 `java_paths`；危险强制覆盖用 `java_override`，两者互斥；启动和预览共用选择；普通安装/重装传递策略和候选，强制覆盖不传给安装 processor | `managed` 是托管优先而非仅托管；`local` 不下载；候选探测会执行程序，必须提示信任 | 中 |
| 下载调优 | 包装器支持参数，但实际 UI/任务未普遍传入 | 高级设置 workers 1–32、retries 0–5，默认 8/2；普通/整合包/客户端内容/服务器/托管 Java 操作传递，开始时快照 | 范围/默认值、跨操作一致性、运行中改设置不篡改已有任务；不发送不支持的字段 | 中 |
| `install.plan` 预览 | 包装器存在，无生产调用 | **本轮未实现**，保留为下一项前端增量 | 绑定版本/loader/目标平台，丢弃过期响应；估计不冒充实际磁盘占用；关闭预览不是取消 Core | 中 |

本轮本地验证：570 项测试通过、0 失败（77 文件 / 3741 断言）；production build
通过（保留既有 chunk-size 提示）；`cargo fmt --check` 通过。
`scripts/test-capabilities-core.ts` 对真实固定 Zig Core `5a4310de` 的 Linux x86_64
合成参数守卫检查通过；它不执行 Java、不下载，不是运行时安装验收。
新增原生 `runtime_target` 测试及其他目标检查交由本次 PR CI；本地缺 GTK sysroot，
未完成原生编译。没有本地浏览器/真实 GUI 验收；Browser Mock E2E 与原生 CI 结果
应查本次 PR 的精确提交检查，不把待运行检查写成通过。
若此后代码调整，必须重跑受影响测试，以上数字只描述记录时的本轮结果。

## 4. 较大端到端工作：建议阶段、依赖与验收

工作量是相对范围/风险，不是工期承诺。可以使用既有 v1 的前端增量继续做；需要新 Core
能力的部分优先排到 **Rust 重写就绪以后**，不扩展 Zig main。

### A. 在线整合包发现到可启动实例（大）

**现状：**有单内容搜索、本地包导入，没有完整在线整合包库。
**缺项：**项目/版本发现、兼容性显示、归档获取/来源验证、错误处理和接入导入器。

1. 前端先设计提供商项目/版本流程，保留 provider/project/version/source 身份；明确
   下载源、凭据、提供商限制，不能因为 UI 可搜索就假定所有包可直接下载。
2. 实现选择→有界验证的归档获取→既有导入；处理缺 key、不可下载、重复 ID、过期选择；
   明确临时文件生命周期，任务元数据和日志不存秘密。
3. 两个提供商各选实际包，在支持的桌面目标完成失败恢复和游戏启动；验证不可变对象共享、
   overrides/配置私有。整合包更新/差异合并另立范围。

**决策：**GUI 负责搜索、Core 负责安装。若需归档获取新接口或逐文件跳过原因，先列 Rust
后续设计，不假装 v1 已有。现有完成摘要继续如实显示数量。

### B. 持久任务历史与恢复（大）

**现状：**控制器跨导航生存，不跨应用退出。缺持久身份、恢复分类、启动核对和未知结果状态。

1. 只持久化非秘密描述/最后阶段，明确 root + ID；重启用既有读取接口核对，显示
   “中断/未知”，不伪造成功、不自动重放所有旧命令。
2. 区分可重新验证的不可变下载、世界修改、进程启动和 token 轮换；保留已验证共享对象，
   不能将终止进程解释为事务回滚。
3. 精确任务身份/status/resume 若需要新协议，排入 Rust 设计；验收退出重开、断线、
   多 root 同 ID、过期描述和外部修改状态。

**边界：**第一阶段可以是诚实的历史/核对 UI，不承诺恢复到中断前的同一个任务。

### C. 真正取消（大；协议待讨论）

**现状：**v1 无 cancel。单会话串行处理，排在长任务后面的取消请求无法打断它；关对话框是后台运行。
**缺项：**任务身份/控制通道、已接受与最终已取消的区别、部分完成语义和执行检查点。

先讨论已有 Rust 取消草案，再冻结 schema。明确下载、processor、认证、世界操作、启动的
范围、too-late、部分结果和进程所有权，再实现可选 Rust 控制层与 UI，保持 v1 兼容。
验收与成功/失败竞态、重复取消、连接丢失和有界进程收尾。token 轮换、可变数据和已发布
验证对象不承诺回滚。不得为了 UX 放一个虚假的取消按钮。

### D. 正式发布与签名更新（中—大）

**现状：**有构建/打包路径与 updater，默认渠道禁用。
**缺项：**获批准的渠道/目标映射、密钥保管、签名 feed/产物、macOS 公证/Windows 签名和升级验收。

1. 确定渠道/版本/架构策略和签名安排。
2. 构建 desktop + 固定 sidecar，核验双方版本；仅通过获批准的凭据流程签名发布。
3. 每个支持目标做干净机器安装、旧→新升级、坏签名/下载中断、数据保留和卸载。

需要明确的凭据/服务/发布授权，不需要新 Core 功能。不绕过签名、Gatekeeper 或
SmartScreen；详见 [release.md](release.md)。

### E. 原生与真实服务验收矩阵（中—大，可并行）

先验收已有功能：账户刷新/重启、原版/loader、本地整合包、游戏启动、受信任 Java 选择、
世界备份恢复、Linux SSH 脱离会话/重连/日志轮转、资源包/光影实际激活。
每项记录前端/Core SHA、包、OS/架构、预期/实际结果和脱敏日志；区分代码问题、提供商限制、
缺凭据、环境问题。项目主人可接手边界清晰的原生验收，也可主动作设计决策；这些决策不是
因旧路线图不同就应该被撤销。CI 不授权真实账户/服务器操作或大规模下载。

## 5. Rust 重写进度：已有基础，但不具备直接替换资格

协议/CLI/磁盘兼容和**硬链接式不可变文件管理**仍是约束，不因换语言重新设计。
可变世界、设置和日志始终实例私有。

| 范围 | 已实现/已有证据 | 剩余门槛 |
|---|---|---|
| RPC/CLI、存储、本地记录 | 兼容 harness、共享对象/materialization/GC、账户/实例、世界备份、内容 registry、Java receipt，有有限差分夹具 | 普通契约分支、路径/平台变体、既有数据接管验收；方法名数量不能证明兼容 |
| metadata/content/modpack/安装编排 | 有源码实现与合成 transport/processor 证据 | 真实提供商/TLS/重定向/错误语义、真实游戏/包、依赖自动 Java 获取的路径尚未证明完成 |
| auth/launch/server | 合成认证/轮换、进程事件/生命周期、本地状态；近期补账户/内容/服务器数字语法兼容 | 真实凭据、当前原生 GUI IPC/打包、真实负载和重连验收 |
| 最新服务器记录修复 | PR #12 合并前八项原生检查通过；portable grammar 四目标；85 个持久记录差分案例仅 Linux | 本报告草稿时 postmerge 检查待完成；不得将 Linux 差分称为四平台覆盖 |
| Java | 检测/选择、已安装 receipt、本地/预安装运行时路径已有实现 | **`java.runtime.install` / 自动获取仍未完成且受阻**；返回下载失败不是下载器兼容完成，也没有可交付的完整安装器补丁 |
| 前端桥接 | 有历史、有限的未修改 wrapper/wire smoke | 不能代表当前完整 Tauri/安装包/UI 验收，更不允许直接替换 sidecar |

项目主人计划独立验收已有 Java 的检测；尚不记为已开始/通过，与受阻的自动获取分开。
新取消/恢复/扩展元数据继续排队，不伪装成兼容修复或 Zig 新功能。

下一步是继续独立兼容缺口、精确提交的原生/postmerge 检查，明确剩余 live/platform/Java
门槛，达到替换标准并确认后才改主线或 sidecar。不以方法覆盖数量编造完成百分比。
已有技术文章和缺陷台账是理解决策的资料，不替代验收：
[重写说明](https://github.com/678mjoe/JMCLCore/blob/rust-rewrite/docs/rewrite/README.md)、
[技术文章](https://github.com/678mjoe/JMCLCore/blob/rust-rewrite/docs/blog/README.md)、
[原版缺陷台账](https://github.com/678mjoe/JMCLCore/blob/rust-rewrite/docs/rewrite/original-core-defects.md)。

## 6. 建议顺序与完成定义

1. 同步两边 handoff，利用现有 Zig 能力补前端缺口。
2. 验证/构建最终修订，单列未完成的真实验收，不拿 Mock 代替端到端完成。
3. 继续独立 Rust 兼容工作；主人 Java 验收独立推进，不让单个阻塞挡住无关任务。
4. 分阶段做在线整合包与诚实的持久历史。
5. 讨论重写后 Rust 的取消/恢复等新 Core 能力；发布/签名安排单独获准。

一项功能完成，需要实际 UI→真实契约→失败处理→对应原生/真实验收达到该项门槛。
文档同步、编译通过、Mock 浏览器通过、包产出各证明不同事实，必须分别标注。
