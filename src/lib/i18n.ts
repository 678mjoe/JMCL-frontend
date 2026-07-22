/**
 * Minimal type-safe i18n. Dictionaries are the source of truth; `zh` defines
 * the key set and `en` must cover every key. Add keys to both.
 */

const zh = {
  "app.title": "JMCL",

  "nav.instances": "实例",
  "nav.settings": "设置",

  "core.starting": "正在连接核心…",
  "core.ready": "核心已连接",
  "core.error": "核心连接失败",

  "instances.title": "实例",
  "instances.new": "新建实例",
  "instances.empty": "还没有实例",
  "instances.emptyHint": "点击“新建实例”开始",
  "instances.launch": "启动",
  "instances.install": "安装",
  "instances.reinstall": "重新安装",
  "instances.delete": "删除",
  "instances.deleteTitle": "删除实例",
  "instances.deleteConfirm": "确定删除实例 “{name}” 吗？该操作不可撤销。",
  "instances.notInstalled": "未安装",
  "instances.log": "日志",
  "instances.refresh": "刷新",

  "create.title": "新建实例",
  "create.name": "名称",
  "create.namePlaceholder": "我的实例",
  "create.id": "标识",
  "create.idHint": "小写字母、数字、点、下划线、连字符",
  "create.version": "游戏版本",
  "create.hideTestVersions": "隐藏测试版",
  "create.versionLoading": "正在获取版本列表…",
  "create.versionError": "版本列表获取失败",
  "create.versionPlaceholder": "选择游戏版本",
  "create.loader": "加载器",
  "create.loader.none": "无",
  "create.loaderVersion": "加载器版本",
  "create.loaderVersionPlaceholder": "例如 0.16.10",
  "create.loaderVersionLoading": "正在获取加载器版本…",
  "create.loaderVersionError": "加载器版本列表获取失败，可手动输入",
  "create.loaderVersionEmpty": "该游戏版本没有兼容的加载器版本",
  "create.selectVersionFirst": "请先选择游戏版本",
  "create.submit": "创建",
  "create.creating": "创建中…",

  "task.install": "安装",
  "task.launch": "启动",
  "task.stage.download": "下载游戏文件",
  "task.stage.processor": "运行加载器安装处理器",
  "task.progress.files": "{completed} / {total} 个文件",
  "task.stage.prepare": "准备运行环境",
  "task.stage.launch": "游戏运行中",
  "task.success": "完成",
  "task.failed": "失败",

  "log.title": "运行日志",
  "log.running": "运行中",
  "log.exited": "已退出，退出码 {code}",
  "log.terminated": "已终止（{reason}）",
  "log.empty": "暂无输出",

  "settings.title": "设置",
  "settings.appearance": "外观",
  "settings.theme": "主题",
  "settings.theme.system": "跟随系统",
  "settings.theme.light": "浅色",
  "settings.theme.dark": "深色",
  "settings.language": "语言",
  "settings.game": "游戏",
  "settings.playerName": "离线玩家名",
  "settings.playerNameHint": "用于离线模式启动",
  "settings.source": "下载源",
  "settings.source.official": "官方",
  "settings.source.bmclapi": "BMCLAPI 镜像",
  "settings.bmclapiNotice": "BMCLAPI 由 bangbang93 提供",
  "settings.directories": "目录",
  "settings.instancesDir": "实例目录",
  "settings.storeDir": "共享缓存目录",

  "common.cancel": "取消",
  "common.confirm": "确定",
  "common.close": "关闭",
  "common.retry": "重试",
} as const;

export type MessageKey = keyof typeof zh;
export type Language = "zh" | "en";

const en: Record<MessageKey, string> = {
  "app.title": "JMCL",

  "nav.instances": "Instances",
  "nav.settings": "Settings",

  "core.starting": "Connecting to core…",
  "core.ready": "Core connected",
  "core.error": "Core connection failed",

  "instances.title": "Instances",
  "instances.new": "New Instance",
  "instances.empty": "No instances yet",
  "instances.emptyHint": "Click “New Instance” to get started",
  "instances.launch": "Launch",
  "instances.install": "Install",
  "instances.reinstall": "Reinstall",
  "instances.delete": "Delete",
  "instances.deleteTitle": "Delete Instance",
  "instances.deleteConfirm": "Delete instance “{name}”? This cannot be undone.",
  "instances.notInstalled": "Not installed",
  "instances.log": "Log",
  "instances.refresh": "Refresh",

  "create.title": "New Instance",
  "create.name": "Name",
  "create.namePlaceholder": "My Instance",
  "create.id": "ID",
  "create.idHint": "Lowercase letters, digits, dots, underscores, hyphens",
  "create.version": "Game Version",
  "create.hideTestVersions": "Hide test versions",
  "create.versionLoading": "Loading versions…",
  "create.versionError": "Failed to load versions",
  "create.versionPlaceholder": "Select a game version",
  "create.loader": "Mod Loader",
  "create.loader.none": "None",
  "create.loaderVersion": "Loader Version",
  "create.loaderVersionPlaceholder": "e.g. 0.16.10",
  "create.loaderVersionLoading": "Loading loader versions…",
  "create.loaderVersionError": "Failed to load loader versions; enter one manually",
  "create.loaderVersionEmpty": "No compatible loader versions for this game version",
  "create.selectVersionFirst": "Select a game version first",
  "create.submit": "Create",
  "create.creating": "Creating…",

  "task.install": "Install",
  "task.launch": "Launch",
  "task.stage.download": "Downloading game files",
  "task.stage.processor": "Running loader installer processors",
  "task.progress.files": "{completed} / {total} files",
  "task.stage.prepare": "Preparing runtime",
  "task.stage.launch": "Game running",
  "task.success": "Done",
  "task.failed": "Failed",

  "log.title": "Game Log",
  "log.running": "Running",
  "log.exited": "Exited with code {code}",
  "log.terminated": "Terminated ({reason})",
  "log.empty": "No output yet",

  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.theme.system": "System",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.language": "Language",
  "settings.game": "Game",
  "settings.playerName": "Offline Player Name",
  "settings.playerNameHint": "Used for offline-mode launches",
  "settings.source": "Download Source",
  "settings.source.official": "Official",
  "settings.source.bmclapi": "BMCLAPI Mirror",
  "settings.bmclapiNotice": "BMCLAPI is provided by bangbang93",
  "settings.directories": "Directories",
  "settings.instancesDir": "Instances Directory",
  "settings.storeDir": "Shared Cache Directory",

  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.close": "Close",
  "common.retry": "Retry",
};

const dictionaries: Record<Language, Record<MessageKey, string>> = { zh, en };

/** Translate `key`, interpolating `{name}`-style placeholders from `vars`. */
export function translate(
  lang: Language,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let text = dictionaries[lang][key] ?? dictionaries.zh[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
