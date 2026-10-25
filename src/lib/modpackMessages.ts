export function modpackPhase(phase: string, zh: boolean) {
  const messages: Record<string, [string, string]> = {
    checking: ["Checking instance ID", "检查实例 ID"], archive: ["Importing pack files", "导入整合包文件"],
    manifest: ["Reading imported instance", "读取导入的实例"], install: ["Installing game files", "安装游戏文件"],
    prepare: ["Preparing game", "准备游戏"], success: ["Ready to open", "已准备好，可打开实例"], error: ["Needs attention", "需要处理"],
  };
  return messages[phase]?.[zh ? 1 : 0] ?? "";
}
export function modpackError(code: string, zh: boolean) {
  const messages: Record<string, [string, string]> = {
    INSTANCE_BUSY: ["This instance is busy. Wait for the other operation, then retry.", "此实例正忙，请等待其他操作结束后重试。"],
    INSTANCE_EXISTS: ["That ID already exists. Nothing was overwritten. Edit the ID and try again.", "实例 ID 已存在，未覆盖内容。请修改 ID 后重试。"],
    INVALID_PARAMS: ["Check the selected archive and instance ID.", "请检查所选归档和实例 ID。"],
    CURSEFORGE_KEY_REQUIRED: ["Save a CurseForge key in Settings, then return here. Your selection is kept.", "请到设置保存 CurseForge 密钥后返回，所选内容会保留。"],
    CURSEFORGE_KEY_INVALID: ["Replace the saved CurseForge key in Settings.", "请到设置替换无效的 CurseForge 密钥。"],
    CURSEFORGE_KEYCHAIN: ["The OS credential store could not be accessed. Check Settings.", "无法访问系统凭据库，请检查设置。"],
    CURSEFORGE_AUTH: ["CurseForge rejected authorization. Check the saved key.", "CurseForge 拒绝授权，请检查已保存的密钥。"],
    CURSEFORGE_NETWORK: ["Could not reach CurseForge. Check your connection.", "无法连接 CurseForge，请检查网络。"],
    CURSEFORGE_RATE_LIMIT: ["CurseForge is rate limiting requests. Wait before trying again.", "CurseForge 请求过于频繁，请稍后重试。"],
    UNKNOWN_MODPACK_FORMAT: ["This archive is not a recognized modpack.", "此归档不是可识别的整合包。"],
    UNSUPPORTED_MODPACK_FORMAT: ["This modpack format version is unsupported.", "不支持此整合包格式版本。"],
    UNSUPPORTED_LOADER: ["This pack uses an unsupported loader.", "此整合包使用不支持的加载器。"],
    LOADER_CONFLICT: ["This pack declares conflicting loaders.", "此整合包声明了冲突的加载器。"],
    MODPACK_NOT_FOUND: ["The selected archive no longer exists. Choose it again.", "所选归档已不存在，请重新选择。"],
    UNSAFE_MODPACK: ["Core rejected unsafe paths in the archive. Use a trusted corrected pack.", "Core 拒绝了归档中的不安全路径，请使用可信的已修正整合包。"],
    UNSAFE_ARCHIVE: ["Core rejected an unsafe archive. Do not retry the same file blindly.", "Core 拒绝了不安全的归档，请勿盲目重试同一文件。"],
    DOWNLOAD_UNAVAILABLE: ["A required pack file is unavailable for third-party download. Core did not provide a file list; obtain a compatible pack from its author.", "必需文件不允许第三方下载。Core 未提供文件清单，请向作者获取兼容整合包。"],
    DOWNLOAD_FAILED: ["A download failed. Check the network and retry the appropriate stage.", "文件下载失败，请检查网络后重试对应阶段。"],
    HTTP_STATUS_ERROR: ["The download service rejected a request. Check availability and try later.", "下载服务拒绝了请求，请检查服务状态后重试。"],
    JAVA_DOWNLOAD_FAILED: ["Java download failed. Check the network or configure a compatible installed Java.", "Java 下载失败，请检查网络或配置已安装的兼容 Java。"],
    JAVA_NOT_FOUND: ["A compatible Java installation was not found. Configure Java before resuming.", "未找到兼容 Java，请配置后恢复。"],
    JAVA_INCOMPATIBLE: ["The selected Java is incompatible with this game version.", "所选 Java 与游戏版本不兼容。"],
    PROCESSOR_FAILED: ["The loader processor failed. Check Java compatibility and diagnostic logs before resuming.", "加载器处理失败，请检查 Java 兼容性和诊断日志后恢复。"],
    CACHE_INVALID: ["Cached game data is invalid. Inspect the instance before retrying preparation.", "游戏缓存无效，请检查实例后重试准备。"],
    PREPARE_CONFLICT: ["Preparation found conflicting files. Inspect the instance; no automatic deletion will be performed.", "准备阶段发现文件冲突，请检查实例，不会自动删除文件。"],
    INVALID_INSTANCE_RESULT: ["The imported instance identity changed or was invalid. Inspect it before further changes.", "导入实例标识发生变化或无效，请检查后再操作。"],
    IMPORT_OUTCOME_UNKNOWN: ["The connection outcome is unknown. Inspect the instance before creating another import; this task will not be replayed automatically.", "连接结果未知，请先检查实例；不会自动重放本次导入。"],
    IMPORT_INTERRUPTED: ["Setup was interrupted between stages. Inspect the instance before continuing.", "准备流程在阶段间中断，请先检查实例。"],
  };
  return messages[code]?.[zh ? 1 : 0] ?? (zh ? "此阶段失败，请查看诊断日志并检查实例。" : "This stage failed. Check diagnostic logs and inspect the instance.");
}
