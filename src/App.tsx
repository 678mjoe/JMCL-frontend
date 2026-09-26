import { useState } from "react";
import { Gamepad2, Coffee, Server as ServerIcon, Settings as SettingsIcon } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { AccountWidget } from "@/components/AccountWidget";
import { cn } from "@/lib/utils";
import { LauncherProvider, useLauncher } from "@/lib/launcher";
import { MicrosoftAccountsProvider } from "@/lib/auth";
import { SettingsProvider, useSettings } from "@/lib/settings";
import { ServersProvider } from "@/lib/servers";
import { TasksProvider } from "@/lib/tasks";
import { ServerOperationsProvider } from "@/lib/serverOperations";
import { MicrosoftLoginDialog } from "@/components/MicrosoftLoginDialog";
import { InstanceDetailPage } from "@/pages/InstanceDetailPage";
import { JavaPage } from "@/pages/JavaPage";
import { InstanceContentPage } from "@/pages/InstanceContentPage";
import { InstancesPage } from "@/pages/InstancesPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ServersPage } from "@/pages/ServersPage";
import { ServerDetailPage } from "@/pages/ServerDetailPage";
import "./App.css";

type TopLevelPage = "instances" | "servers" | "java" | "settings";
type Page = TopLevelPage | "instance" | "instance-content" | "server";
type Route = { page: Page; instanceId?: string; serverId?: string };

function CoreStatus() {
  const { status, core, error } = useLauncher();
  const { t } = useSettings();
  return (
    <div
      className="flex items-center gap-2 px-2 text-xs text-muted-foreground"
      title={status === "error" ? (error ?? undefined) : undefined}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          status === "ready" && "bg-green-500",
          status === "starting" && "bg-yellow-500 animate-pulse",
          status === "error" && "bg-destructive",
        )}
      />
      <span className="truncate">
        {status === "ready" && core
          ? `${t("core.ready")} · ${core.version}`
          : status === "starting"
            ? t("core.starting")
            : t("core.error")}
      </span>
    </div>
  );
}

function Shell() {
  const [route, setRoute] = useState<Route>({ page: "instances" });
  const { t } = useSettings();

  const nav: { id: TopLevelPage; label: string; icon: typeof Gamepad2 }[] = [
    { id: "instances", label: t("nav.instances"), icon: Gamepad2 },
    { id: "servers", label: t("nav.servers"), icon: ServerIcon },
    { id: "java", label: t("nav.java"), icon: Coffee },
    { id: "settings", label: t("nav.settings"), icon: SettingsIcon },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-52 shrink-0 flex-col border-r">
        <div className="flex h-14 items-center px-4 text-lg font-semibold tracking-tight">
          {t("app.title")}
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setRoute({ page: id })}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                route.page === id ||
                ((route.page === "instance" || route.page === "instance-content") &&
                  id === "instances")
                || (route.page === "server" && id === "servers")
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="border-t">
          <AccountWidget onManage={() => setRoute({ page: "settings" })} />
        </div>
        <div className="border-t py-3">
          <CoreStatus />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {route.page === "server" && route.serverId ? (
          <ServerDetailPage
            serverId={route.serverId}
            onBack={() => setRoute({ page: "servers" })}
          />
        ) : route.page === "instance" && route.instanceId ? (
          <InstanceDetailPage
            instanceId={route.instanceId}
            onBack={() => setRoute({ page: "instances" })}
            onOpenContent={() =>
              setRoute({ page: "instance-content", instanceId: route.instanceId })
            }
          />
        ) : route.page === "instance-content" && route.instanceId ? (
          <InstanceContentPage
            instanceId={route.instanceId}
            onBack={() =>
              setRoute({ page: "instance", instanceId: route.instanceId })
            }
          />
        ) : route.page === "settings" ? (
          <SettingsPage />
        ) : route.page === "java" ? (
          <JavaPage />
        ) : route.page === "servers" ? (
          <ServersPage onOpenDetail={(serverId) => setRoute({ page: "server", serverId })} />
        ) : (
          <InstancesPage
            onOpenDetail={(instanceId) =>
              setRoute({ page: "instance", instanceId })
            }
            onOpenContent={(instanceId) =>
              setRoute({ page: "instance-content", instanceId })
            }
          />
        )}
      </main>
      <Toaster richColors position="bottom-right" />
      <MicrosoftLoginDialog />
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <LauncherProvider>
        <ServersProvider>
          <MicrosoftAccountsProvider>
            <ServerOperationsProvider>
              <TasksProvider>
                <Shell />
              </TasksProvider>
            </ServerOperationsProvider>
          </MicrosoftAccountsProvider>
        </ServersProvider>
      </LauncherProvider>
    </SettingsProvider>
  );
}
