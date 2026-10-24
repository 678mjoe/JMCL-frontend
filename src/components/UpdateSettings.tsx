import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { canUpdate, updateBusy, updateController, type UpdateAction, type UpdateController } from "@/lib/updates";

export function UpdateSettings({ controller = updateController }: { controller?: UpdateController }) {
  const { settings, t } = useSettings();
  const say = (en: string, zh: string) => settings.language === "zh" ? zh : en;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { snapshot: status, pending, bridgeError } = state;
  const [confirmation, setConfirmation] = useState<{ action: UpdateAction; key: string } | null>(null);
  const key = `${status.phase}:${status.version}:${status.channel}`;
  const busy = pending || updateBusy(status.phase);
  useEffect(() => { void controller.refresh(); }, [controller]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => { void controller.refresh(); }, 1000);
    return () => clearInterval(timer);
  }, [controller, busy]);
  const confirm = confirmation?.key === key && !busy && !bridgeError ? confirmation.action : null;
  const labels: Record<UpdateAction, string> = {
    check: t("updates.check"), download: say("Download update", "下载更新"), install: say("Install update", "安装更新"),
    discard: say("Discard update", "放弃此更新"), restart: say("Restart launcher", "重启启动器"),
  };
  const descriptions: Record<UpdateAction, string> = {
    check: say("Contact this build's verified HTTPS update channel? No download or installation starts.", "连接本构建已验证的 HTTPS 更新渠道？此操作不会下载或安装。"),
    download: say("Download and verify the signed update? Installation requires a separate confirmation. The active download cannot be canceled; you can discard it afterward.", "下载并验证已签名的更新？安装需要另行确认。下载过程中不能取消；下载完成后可放弃。"),
    install: say("Save your work and stop games and servers first. Installation stops launcher tasks and cannot be canceled. Windows exits to its installer; reopen the launcher manually afterward. Linux/macOS require a separate restart.", "请先保存工作并停止游戏和服务器。安装将停止启动器任务，且不能取消。Windows 会退出到安装器；完成后请手动打开启动器。Linux/macOS 需另行重启。"),
    discard: "",
    restart: say("Restart now? Save your work first; launcher tasks will stop.", "立即重启？请先保存工作；启动器任务将停止。"),
  };
  const errorText = status.error === "missingUpdate"
    ? say("Update data is no longer available. Run a new check; installation did not start.", "更新数据已不可用。请重新检查；尚未开始安装。")
    : status.error === "downloadOrSignatureFailed"
    ? say("Download or signature verification failed. Check connectivity and ask the release maintainer to verify the artifact; never bypass signature checks.", "下载或签名验证失败。请检查网络并让发布维护者验证文件；不要跳过签名检查。")
    : status.error === "installFailed"
      ? say("Installation failed; the local installation may need repair. Save work and follow maintainer recovery instructions before retrying.", "安装失败；本地安装可能需要修复。请保存工作并遵循维护者的恢复说明后再重试。")
      : status.error === "unsafeDownloadUrl"
        ? say("The channel returned an unsafe download URL. Contact the release maintainer.", "更新渠道返回了不安全的下载地址。请联系发布维护者。")
        : say("The update check failed. Check connectivity or contact the release maintainer, then retry explicitly.", "更新检查失败。请检查网络或联系发布维护者，然后手动重试。" );
  const phaseText = {
    unconfigured: t("updates.unconfigured"), idle: say("Ready for an explicit update check", "可手动检查更新"),
    checking: say("Checking update channel…", "正在检查更新渠道…"), current: say("No newer version reported by this channel", "此渠道未报告新版本"),
    available: say("Update available", "有可用更新"), downloading: say("Downloading and verifying signature…", "正在下载并验证签名…"),
    downloaded: say("Signature verified — awaiting install confirmation", "签名已验证 — 等待安装确认"),
    installing: say("Installing — do not close the launcher", "正在安装 — 请勿关闭启动器"),
    installed: say("Installed — restart required", "已安装 — 需要重启"), error: say("Update failed. Retry with a new check; no automatic retry.", "更新失败。请重新检查后重试；不会自动重试。"),
  }[status.phase];
  return <section className="space-y-4" aria-labelledby="updates-heading">
    <h2 id="updates-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{t("updates.title")}</h2>
    <p role="status">{phaseText}</p>
    {status.phase === "unconfigured" && <p id="updates-unavailable" className="text-xs text-muted-foreground">{t("updates.hint")}</p>}
    {status.phase === "error" && <p role="alert">{errorText}</p>}
    {status.channel && <p>{say("Build channel", "构建渠道")}: {status.channel}</p>}
    {status.version && <p>{say("Version", "版本")}: {status.version}</p>}
    {status.phase === "downloading" && <p>{status.downloaded.toLocaleString()} {say("bytes received", "字节已接收")}{status.total ? ` / ${status.total.toLocaleString()}` : ""}</p>}
    {busy && <p className="text-xs">{say("This operation cannot be canceled here. Leaving Settings does not cancel it.", "此处无法取消正在进行的操作。离开设置不会取消操作。")}</p>}
    {bridgeError && <p role="alert">{say("Updater status unavailable. Refresh status before retrying; no success is assumed.", "无法获取更新状态。请刷新状态后重试；不会假定操作成功。")}</p>}
    <div className="flex flex-wrap gap-2">
      {(["check", "download", "install", "restart"] as const).map(action => (action === "check" || canUpdate(status.phase, action)) &&
        <Button key={action} variant="outline" disabled={busy || bridgeError || !canUpdate(status.phase, action)} onClick={() => setConfirmation({ action, key })}>{labels[action]}</Button>)}
      {canUpdate(status.phase, "discard") && <Button variant="outline" disabled={busy || bridgeError} onClick={() => { setConfirmation(null); void controller.act("discard"); }}>{labels.discard}</Button>}
      {bridgeError && <Button variant="outline" disabled={pending} onClick={() => { setConfirmation(null); void controller.refresh(); }}>{say("Refresh update status", "刷新更新状态")}</Button>}
    </div>
    {confirm && <div role="group" aria-label={say("Confirm update action", "确认更新操作")} className="space-y-3 rounded border p-3">
      <p>{descriptions[confirm]}</p>
      <Button onClick={() => { setConfirmation(null); void controller.act(confirm); }}>{say("Confirm", "确认")}: {labels[confirm]}</Button>{" "}
      <Button variant="outline" onClick={() => setConfirmation(null)}>{say("Cancel", "取消")}</Button>
    </div>}
  </section>;
}
