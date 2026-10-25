import { useSettings } from "@/lib/settings";
import type { Task } from "@/lib/tasks";
import { InstallProgressView } from "./InstallProgressView";
export { formatBytes } from "@/lib/installProgress";
export interface InstallTaskProgressProps { task: Task }
/** Ordinary installs and modpack setup share the same safe stage display. */
export function InstallTaskProgress({ task }: InstallTaskProgressProps) {
  const { t } = useSettings();
  return <InstallProgressView state={task.installProgress ?? {
    stage: task.stage === "task.stage.processor" ? "processor" : task.stage === "task.stage.java" ? "java" : "download",
    progress: task.progress,
    detail: null,
  }} label={t(task.stage)} />;
}
