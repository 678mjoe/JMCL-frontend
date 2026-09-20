import { useState } from "react";
import {
  Check,
  ChevronsUpDown,
  LogIn,
  Plus,
  Settings2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useMicrosoftAccounts } from "@/lib/auth";
import { useLauncher } from "@/lib/launcher";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { AccountProfile } from "@/lib/types";

/** Fallback block with the player's initial when no face render is available. */
function InitialAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-primary/10 font-semibold text-primary",
        className,
      )}
    >
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

/** Minecraft face render (crafatar-compatible), letter fallback on failure. */
function AccountAvatar({
  account,
  className,
}: {
  account: AccountProfile;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <InitialAvatar name={account.player_name} className={className} />;
  return (
    <img
      src={`https://minotar.net/helm/${account.id}/64.png`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-md", className)}
    />
  );
}

/**
 * Persistent sidebar account entry point. Keeps the Microsoft sign-in one
 * click away on every page and shows the current identity (licensed account
 * or offline mode) at a glance.
 */
export function AccountWidget({ onManage }: { onManage: () => void }) {
  const {
    accounts,
    loading,
    activeAccount,
    setActiveAccount,
    startLogin,
  } = useMicrosoftAccounts();
  const { status } = useLauncher();
  const { t } = useSettings();
  const ready = status === "ready";

  if (loading && accounts.length === 0 && status === "starting") {
    return (
      <div className="px-4 py-2.5">
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="space-y-1.5 px-4 py-2.5">
        <Button
          size="sm"
          className="w-full"
          disabled={!ready}
          onClick={startLogin}
        >
          <LogIn className="size-4" />
          {t("account.login.cta")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("account.offlineMode")}
        </p>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 data-popup-open:bg-accent/60"
            aria-label={t("account.choose")}
          />
        }
      >
        {activeAccount ? (
          <AccountAvatar account={activeAccount} className="size-8" />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <UserRound className="size-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {activeAccount?.player_name ?? t("account.choose")}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {activeAccount ? t("account.genuine") : t("account.offlineMode")}
          </div>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("account.choose")}</DropdownMenuLabel>
          {accounts.map((account) => (
            <DropdownMenuItem
              key={account.id}
              onClick={() => setActiveAccount(account.id)}
            >
              <AccountAvatar account={account} className="size-5" />
              <span className="flex-1 truncate">{account.player_name}</span>
              {activeAccount?.id === account.id && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => setActiveAccount(null)}>
            <div className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted">
              <UserRound className="size-3 text-muted-foreground" />
            </div>
            <span className="flex-1 truncate">{t("account.offlineMode")}</span>
            {!activeAccount && <Check className="size-4" />}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!ready} onClick={startLogin}>
          <Plus className="size-4" />
          {t("account.add")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onManage}>
          <Settings2 className="size-4" />
          {t("account.manage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
