import { useEffect, useRef } from "react";
import { Loader2, X } from "lucide-react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
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
  const { settings, t } = useSettings();
  const { taskFor } = useTasks();
  const task = instanceId ? taskFor("launch", instanceId, settings.instancesDir) : undefined;

  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const lineCount = task?.lines.length ?? 0;

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const viewport = root.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight });
  }, [settings.instancesDir, instanceId, lineCount]);

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
      <SheetContent
        side="right"
        showCloseButton={false}
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg motion-reduce:transition-none"
      >
        <SheetHeader className="gap-1 pb-0 pr-14">
          <SheetTitle>{t("log.title")}</SheetTitle>
          {instanceId && (
            <div className="font-mono text-xs text-muted-foreground wrap-anywhere">
              {instanceId}
            </div>
          )}
          <div aria-live="polite" className="mt-1 text-xs wrap-anywhere">{statusLine}</div>
        </SheetHeader>
        <SheetClose render={
          <Button size="icon-sm" variant="ghost" aria-label={t("common.close")} className="absolute top-(--jmcl-panel-padding) right-(--jmcl-panel-padding)" />
        }><X aria-hidden="true" /></SheetClose>
        <div ref={scrollRootRef} className="mx-(--jmcl-panel-padding) mb-(--jmcl-panel-padding) min-h-0 flex-1 rounded-md border bg-muted/45">
          {lineCount === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("log.empty")}
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="px-3 py-2 font-mono text-xs leading-5">
                {task?.lines.map((line, i) => (
                  <div
                    key={i}
                    data-slot="launch-log-line"
                    className={cn(
                      "min-h-5",
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
