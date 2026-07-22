import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings";
import { useTasks } from "@/lib/tasks";

export interface LogSheetProps {
  /** Instance whose launch log is shown; null closes the sheet. */
  instanceId: string | null;
  onOpenChange: (open: boolean) => void;
}

/** Parse a terminal launch message of the form `exited:<code>` / `terminated:<reason>`. */
function splitMessage(message: string): [string, string] {
  const idx = message.indexOf(":");
  if (idx === -1) return [message, ""];
  return [message.slice(0, idx), message.slice(idx + 1)];
}

export function LogSheet({ instanceId, onOpenChange }: LogSheetProps) {
  const { t } = useSettings();
  const { taskFor } = useTasks();
  const task = instanceId ? taskFor("launch", instanceId) : undefined;

  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const lineCount = task?.lines.length ?? 0;

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const viewport = root.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight });
  }, [instanceId, lineCount]);

  let statusLine: React.ReactNode = null;
  if (task?.status === "running") {
    statusLine = (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t("log.running")}
        {task.pid ? ` · pid ${task.pid}` : ""}
      </span>
    );
  } else if (task?.status === "success") {
    const [kind, value] = splitMessage(task.message ?? "");
    statusLine = (
      <span className="text-muted-foreground">
        {kind === "exited"
          ? t("log.exited", { code: value })
          : kind === "terminated"
            ? t("log.terminated", { reason: value })
            : task.message}
      </span>
    );
  } else if (task?.status === "error") {
    statusLine = <span className="text-destructive">{task.message}</span>;
  }

  return (
    <Sheet open={instanceId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle>{t("log.title")}</SheetTitle>
          {instanceId && (
            <div className="text-sm text-muted-foreground font-mono">
              {instanceId}
            </div>
          )}
          {statusLine && <div className="text-xs">{statusLine}</div>}
        </SheetHeader>
        <div ref={scrollRootRef} className="flex-1 min-h-0 px-4 pb-4">
          {lineCount === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("log.empty")}
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="font-mono text-xs leading-5 pr-3">
                {task?.lines.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      line.stream === "stderr" && "text-destructive/80",
                      line.stream === "core" && "text-muted-foreground italic",
                    )}
                  >
                    <span className="whitespace-pre-wrap break-all">
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
