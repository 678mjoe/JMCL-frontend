import { useEffect, useRef, useState } from "react";
import { Coffee, Layers3, Server as ServerIcon, Settings as SettingsIcon } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { AccountWidget } from "@/components/AccountWidget";
import { currentQaIntent, usesMicrosoftAccounts } from "@/lib/integratedQa";
import { LauncherProvider, useLauncher } from "@/lib/launcher";
import { MicrosoftAccountsProvider } from "@/lib/auth";
import { SettingsProvider, useSettings } from "@/lib/settings";
import { EndpointContextProvider } from "@/lib/endpointContext";
import { ServersProvider } from "@/lib/servers";
import { TasksProvider } from "@/lib/tasks";
import { ModpackTasksProvider } from "@/lib/modpackTasks";
import { ModpackImportDialog } from "@/components/ModpackImportDialog";
import { InstallationTasksPanel } from "@/components/InstallationTasksPanel";
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
  const label = t(status === "ready" ? "core.ready" : status === "starting" ? "core.starting" : "core.error");
  return (
    <div
      className="jmcl-core-status"
      data-status={status}
      role="status"
      title={status === "error" ? (error ?? undefined) : undefined}
    >
      <span aria-hidden="true" className="jmcl-status-dot" />
      <span className="min-w-0">
        {label}
        {status === "ready" && core && <span className="jmcl-core-version">{core.version}</span>}
      </span>
    </div>
  );
}

function Shell() {
  const [route, setRoute] = useState<Route>({ page: "instances" });
  const { settings, t } = useSettings();
  const canUseMicrosoft = usesMicrosoftAccounts(currentQaIntent());
  const mainRef = useRef<HTMLElement>(null);
  const previousRoute = useRef(route);
  const activePage = route.page === "instance" || route.page === "instance-content"
    ? "instances"
    : route.page === "server" ? "servers" : route.page;

  useEffect(() => {
    document.documentElement.lang = settings.language === "zh" ? "zh-CN" : "en";
  }, [settings.language]);

  useEffect(() => {
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    main.focus({ preventScroll: true });
  }, [route]);

  const nav: { id: TopLevelPage; label: string; icon: typeof Layers3 }[] = [
    { id: "instances", label: t("nav.instances"), icon: Layers3 },
    { id: "servers", label: t("nav.servers"), icon: ServerIcon },
    { id: "java", label: t("nav.java"), icon: Coffee },
    { id: "settings", label: t("nav.settings"), icon: SettingsIcon },
  ];

  return (
    <div className="jmcl-shell flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground sm:flex-row">
      <a className="jmcl-skip" href="#jmcl-main">{t("nav.skip")}</a>
      <aside className="jmcl-rail flex w-full shrink-0 flex-col border-b sm:w-52 sm:border-b-0 sm:border-r">
        <div className="jmcl-brand">
          <img className="jmcl-brand-mark" src="/jmcl-mark.png" alt="" width={42} height={42} />
          <div className="min-w-0">
            <div className="jmcl-brand-name">{t("app.title")}</div>
            <div className="jmcl-brand-edition">Minecraft: Java Edition</div>
          </div>
        </div>
        <nav aria-label={t("nav.primary")} className="jmcl-nav flex flex-row sm:flex-1 sm:flex-col">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setRoute({ page: id })}
              aria-current={activePage === id ? "page" : undefined}
              className="jmcl-nav-item flex flex-1 justify-center sm:flex-none sm:justify-start"
            >
              <Icon aria-hidden="true" className="size-[17px] shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="jmcl-rail-footer flex min-w-0 items-center sm:block">
          <div className="jmcl-account min-w-0 flex-1">
            {canUseMicrosoft ? <AccountWidget onManage={() => setRoute({ page: "settings" })} />
              : <span className="text-sm text-muted-foreground">{settings.language === "zh" ? "离线测试" : "Offline QA"}</span>}
          </div>
          <CoreStatus />
        </div>
      </aside>
      <main id="jmcl-main" ref={mainRef} tabIndex={-1} className="jmcl-main min-h-0 min-w-0 flex-1 overflow-y-auto">
        <InstallationTasksPanel />
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
          <ServersPage onOpenDetail={(serverId) => setRoute({ page: "server", serverId })} onOpenSettings={() => setRoute({ page: "settings" })} />
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
      <Toaster theme={settings.theme} richColors position="bottom-right" />
      {canUseMicrosoft && <MicrosoftLoginDialog />}
      <ModpackImportDialog onOpenSettings={() => setRoute({ page: "settings" })} onOpenInstance={instanceId => setRoute({ page: "instance", instanceId })} />
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <EndpointContextProvider>
        <LauncherProvider>
          <ServersProvider>
            <MicrosoftAccountsProvider>
              <ServerOperationsProvider>
                <TasksProvider>
                  <ModpackTasksProvider><Shell /></ModpackTasksProvider>
                </TasksProvider>
              </ServerOperationsProvider>
            </MicrosoftAccountsProvider>
          </ServersProvider>
        </LauncherProvider>
      </EndpointContextProvider>
    </SettingsProvider>
  );
}
