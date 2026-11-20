import { Button } from "./ui/button";
import { useModpackTasks } from "@/lib/modpackTasks";
import { useTasks } from "@/lib/tasks";
import { useSettings } from "@/lib/settings";
import { modpackPhase } from "@/lib/modpackMessages";
import { InstallTaskProgress } from "./InstallTaskProgress";
/** Visible from every route; job ownership is in application providers, not views. */
export function InstallationTasksPanel() {
  const jobs = useModpackTasks();
  const { tasks } = useTasks();
  const { settings } = useSettings();
  const zh = settings.language === "zh";
  const packs = jobs.registry.list();
  const installs = Object.values(tasks).filter(task => task.kind === "install" && task.status === "running");
  const draft = jobs.registry.draft(settings.instancesDir, settings.storeDir);
  if (!packs.length && !installs.length && !draft.file) return null;
  const title = zh ? "安装任务" : "Installation tasks";
  return (
    <section aria-label={title} className="mx-auto max-w-[var(--jmcl-page-width)] px-[var(--jmcl-page-gutter)] pt-4">
      <div className="jmcl-panel divide-y divide-border">
        <div className="flex flex-wrap items-center justify-between gap-2 px-(--jmcl-panel-padding) py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {draft.file && (
            <Button size="sm" variant="outline" onClick={() => jobs.show()}>
              {zh ? "继续整合包导入表单" : "Continue modpack import form"}
            </Button>
          )}
        </div>
        {packs.map(task => {
          const state = task.controller.getSnapshot();
          return (
            <div key={task.key} className="flex flex-wrap items-center justify-between gap-2 px-(--jmcl-panel-padding) py-2.5">
              <div className="min-w-0 flex-[1_1_10rem] text-sm">
                <p className="font-medium wrap-anywhere" title={`${task.controller.input.directory}/${task.controller.input.id}`}>
                  {task.controller.input.id}
                </p>
                <p className="text-xs text-muted-foreground">{modpackPhase(state.phase, zh)}</p>
              </div>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => jobs.show(task.key)}>
                  {zh ? "查看任务" : "View task"}
                </Button>
                {state.phase === "success" && (
                  <Button size="sm" variant="ghost" onClick={() => jobs.registry.dismiss(task.key)}>
                    {zh ? "移除完成提示" : "Dismiss completed task"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {installs.map(task => (
          <div key={task.key} className="space-y-1 px-(--jmcl-panel-padding) py-2.5">
            <p className="text-sm font-medium wrap-anywhere">{task.instanceId}</p>
            <p className="text-xs text-muted-foreground wrap-anywhere">{task.instancesDir}</p>
            <div className="max-w-xl"><InstallTaskProgress task={task} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}
