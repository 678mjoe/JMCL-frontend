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
  return <section aria-label={zh ? "安装任务" : "Installation tasks"} className="border-b bg-muted/30 px-4 py-3 space-y-2">
    <h2 className="text-sm font-medium">{zh ? "安装任务" : "Installation tasks"}</h2>
    {draft.file && <Button size="sm" variant="outline" onClick={() => jobs.show()}>{zh ? "继续整合包导入表单" : "Continue modpack import form"}</Button>}
    {packs.map(task => {
      const state = task.controller.getSnapshot();
      return <div key={task.key} className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium break-all" title={`${task.controller.input.directory}/${task.controller.input.id}`}>{task.controller.input.id}</span><span className="text-muted-foreground">{modpackPhase(state.phase, zh)}</span>
        <Button size="sm" variant="outline" onClick={() => jobs.show(task.key)}>{zh ? "查看任务" : "View task"}</Button>
        {state.phase === "success" && <Button size="sm" variant="ghost" onClick={() => jobs.registry.dismiss(task.key)}>{zh ? "移除完成提示" : "Dismiss completed task"}</Button>}
      </div>;
    })}
    {installs.map(task => <div key={task.key} className="max-w-xl rounded border p-2"><p className="text-sm mb-1">{task.instanceId}</p><p className="text-xs text-muted-foreground break-all mb-1">{task.instancesDir}</p><InstallTaskProgress task={task} /></div>)}
  </section>;
}
