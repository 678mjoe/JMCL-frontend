# JMCL 用户指南 / User guide

> 当前是开发版本，不是已完成原生验收的正式发行版。自动更新不可用。
> This is a development build, not an accepted signed release. Automatic updates are unavailable.

## 开始之前 / Before starting

从可信源码构建时，按[环境指南](development.md)准备匹配平台的 Core；不要下载未知来源的替代二进制。浏览器 Mock 只演示合成数据，不会安装、启动游戏或保存真实账户。Linux 自动测试、macOS/Windows 编译与真实桌面验收是不同证据，详见[验收目录](verification/)。

For source builds, follow the [environment guide](development.md) and use the matching Core revision/architecture. Browser Mock uses synthetic data, not real accounts, installations or games. Read the verification record for the exact revision; compilation does not prove desktop behavior.

## 实例与账户 / Instances and accounts

1. 在设置中确认实例和共享存储目录；使用独立目录，不要指向唯一的重要存档副本。
2. 创建实例，选择 Minecraft 版本、加载器和下载源，然后安装/准备。等待任务完成；失败时保留结构化错误码，不要重复点击写入操作。
3. 选择 Java 或托管运行时。需要时在实例启动选项中设置参数、分辨率、Java override；argv 每项单独输入，不是 shell 脚本。
4. 选择离线或 Microsoft 账户。只在官方验证页面输入 Microsoft 凭据；刷新令牌由原生凭据库保存。取消登录会结束当前流程，不等于注销官方网站会话。
5. 启动并观察日志。不要分享令牌、完整敏感命令行或私人文件路径；诊断报告应说明版本、平台、操作和脱敏错误。

Confirm separate instance/store directories, create an instance, install/prepare it, select Java and an account, then launch. Advanced arguments are individual argv entries, not shell commands. Microsoft login belongs on the official verification page; native keychain stores refresh credentials. Never paste credentials into logs or issue reports.

## 内容与世界 / Content and worlds

- Mod、资源包、光影、世界数据包可通过兼容版本搜索安装和管理。CurseForge 需要在原生设置中配置 API key；不要把 key 写入问题报告或浏览器代码。
- 整合包导入使用隔离实例；导入成功后仍可能需要安装/准备游戏。读取归档不代表下载和运行已成功。
- **已安装 ≠ 已选择 ≠ 兼容 ≠ 实际加载。** 资源包顺序与光影配置修改前停止所有游戏进程并确认。JMCL 无法证明外部启动的游戏已停止。
- Windows 配置写入要求本地卷中的非链接路径，拒绝重解析点、硬链接配置及无法安全访问的文件；目标平台执行验证见 [Windows 激活记录](verification/2026-10-24-windows-pack-activation.md)。未知/旧版资源包格式和 OptiFine/其他未知运行时配置不受支持；使用游戏内菜单。Iris/Oculus 只修改明确选择的已有配置，目录兼容结果不保证 GPU 或游戏加载。
- 世界删除和覆盖恢复不可逆；先导出/备份并确认可恢复性。不要在游戏运行时操作世界。
- 共享存储清理先做 dry-run，核对目录和候选项再确认；不确定结果时先重新预览，不自动重试删除。

Use compatible catalog versions. Imported packs may still need game installation/preparation. Installed files, selection, compatibility and actual loading are separate. Stop every game before config/world changes; keep independent backups before delete/restore. Windows activation requires non-linked paths on a local volume and refuses unsupported access. Unknown runtime formats remain unsupported. Review store cleanup's dry-run and exact directory before confirming.

## 远端服务器 / Remote servers

系统 OpenSSH 管理密钥、agent 和 known_hosts。先由用户在受信环境确认目标和主机身份；JMCL 不自动信任未知主机，也不保存 SSH 密码。目标需安装兼容 Core。端点切换不会把本地客户端操作转到远端。

创建 → 显式同意 EULA → 安装 → 启动 → 状态/日志/命令 → 停止。连接失败或断线不表示服务器停止；重连后刷新权威状态。properties、世界和内容修改需停服。RCON 密码只用于当前命令；不要公开暴露 RCON/Query 服务或在日志中分享密码。

Use a host you control and have verified through system OpenSSH. Unknown/changed host keys are rejected. A disconnect does not mean the server stopped: reconnect and refresh state. Accept the EULA explicitly before installing; stop the server before properties/world/content edits. Never expose RCON/Query as a workaround for connection errors.

## 故障与更新 / Troubleshooting and updates

- Core missing/protocol mismatch: check the pinned Core and staged sidecar architecture; a web preview is not a native build.
- Keychain/dialog/SSH failure: record the OS and exact structured error; do not bypass OS security or host-key checks.
- Catalog/image failure: retry deliberately after checking connectivity; CSP intentionally blocks unapproved hosts. Report the provider and sanitized URL hostname, never a key.
- Pending/failed mutation: refresh authoritative state before retry. Back up data independently.
- Updates: updater code is present, but default builds have no update service or signed update artifacts configured. The app must not claim “up to date.” Follow future maintainer release instructions only after a release is explicitly approved and verified. Do not disable signature checks to install an update.

更新代码已实现，但默认构建的自动更新渠道未配置；“不可用”不表示“已是最新”。正式版本需完成[发布门槛](release.md)，本指南不授权发布、登录真实账户或操作真实服务器。
