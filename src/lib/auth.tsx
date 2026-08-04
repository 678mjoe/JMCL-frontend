/**
 * Microsoft account state (contract §5–§6):
 * device-code login on a dedicated session, account picker metadata from
 * the core, and keychain-backed refresh-token rotation.
 *
 * Security invariants:
 * - Refresh tokens live only in the OS keychain (`credential_*` commands);
 *   they never enter localStorage, props, or logs.
 * - A rotated token is persisted BEFORE the refreshed session is used,
 *   even when `exchange_failed` (§6.4).
 * - The device code stays inside the login loop; only `user_code` and the
 *   verification URI reach the UI.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { errorText, useLauncher } from "./launcher";
import { makeOfflineSession } from "./offline";
import { RpcError, type CoreSession } from "./rpc";
import { useSettings } from "./settings";
import type {
  AccountProfile,
  AuthSession,
  DevicePollResult,
  RefreshExchangeResult,
} from "./types";

/**
 * Microsoft Entra public client ID for this application (contract §5).
 * Public by design — device-code flows use no client secret.
 */
export const MICROSOFT_CLIENT_ID = "3dca676e-ab27-4afb-a40d-c177a33ffd70";

/** Keychain slot used between OAuth approval and profile resolution. */
const PENDING_KEY = "pending-device-login";

const sleep = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const credentialSet = (accountId: string, refreshToken: string) =>
  invoke("credential_set", { accountId, refreshToken });
const credentialGet = (accountId: string) =>
  invoke<string | null>("credential_get", { accountId });
const credentialDelete = (accountId: string) =>
  invoke("credential_delete", { accountId });

export type LoginStatus = "starting" | "pending" | "finishing" | "error";

export interface LoginState {
  status: LoginStatus;
  userCode?: string;
  verificationUri?: string;
  error?: string;
}

/** Thrown when a stored account can no longer produce a session. */
export class ReloginRequiredError extends Error {
  constructor() {
    super("relogin-required");
    this.name = "ReloginRequiredError";
  }
}

/** Thrown when an auth step failed transiently; the caller may simply retry. */
export class AuthTransientError extends Error {
  constructor() {
    super("auth-transient");
    this.name = "AuthTransientError";
  }
}

/** Retryable auth RPC failures (network blips, timeouts); everything else is terminal. */
const TRANSIENT_AUTH_CODES: Record<string, true> = {
  AUTH_NETWORK_ERROR: true,
  AUTH_TIMEOUT: true,
};

const isTransientAuthError = (e: unknown): boolean =>
  e instanceof RpcError && TRANSIENT_AUTH_CODES[e.code ?? ""] === true;

interface MicrosoftAccountsContextValue {
  accounts: AccountProfile[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Currently selected account; `null` launches offline. */
  activeAccount: AccountProfile | null;
  setActiveAccount: (id: string | null) => void;
  removeAccount: (id: string) => Promise<void>;
  /** Non-null while the device-code dialog should be visible. */
  login: LoginState | null;
  startLogin: () => void;
  cancelLogin: () => void;
  /**
   * Produce a launch session for the active account, or `null` when no
   * account is selected (caller falls back to offline). Rotates and
   * persists the refresh token; throws ReloginRequiredError when the
   * account needs a fresh device login.
   */
  getLaunchSession: () => Promise<AuthSession | null>;
}

const MicrosoftAccountsContext = createContext<MicrosoftAccountsContextValue | null>(null);

export function MicrosoftAccountsProvider({ children }: { children: ReactNode }) {
  const { session, status, openSession } = useLauncher();
  const { settings, update, t } = useSettings();
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<LoginState | null>(null);
  const loginSessionRef = useRef<CoreSession | null>(null);
  const cancelledRef = useRef(false);

  const activeAccountId = settings.activeAccountId;
  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId) ?? null,
    [accounts, activeAccountId],
  );

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const result = await session.accountList();
      setAccounts(result.accounts);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (status === "ready") void refresh();
  }, [status, refresh]);

  const setActiveAccount = useCallback(
    (id: string | null) => update({ activeAccountId: id }),
    [update],
  );

  const removeAccount = useCallback(
    async (id: string) => {
      if (!session) return;
      await session.accountDelete(id);
      await credentialDelete(id);
      if (activeAccountId === id) update({ activeAccountId: null });
      await refresh();
    },
    [session, activeAccountId, update, refresh],
  );

  const cancelLogin = useCallback(() => {
    cancelledRef.current = true;
    void loginSessionRef.current?.close();
    loginSessionRef.current = null;
    setLogin(null);
  }, []);

  const startLogin = useCallback(() => {
    if (loginSessionRef.current) return;
    cancelledRef.current = false;
    setLogin({ status: "starting" });

    void (async () => {
      let loginSession: CoreSession | null = null;
      try {
        loginSession = await openSession();
        if (cancelledRef.current) return;
        loginSessionRef.current = loginSession;

        const begin = await loginSession.authDeviceBegin(
          MICROSOFT_CLIENT_ID,
          settings.language,
        );
        if (cancelledRef.current) return;
        setLogin({
          status: "pending",
          userCode: begin.user_code,
          verificationUri: begin.verification_uri,
        });

        let interval = (typeof begin.interval === "number" ? begin.interval : 5) * 1000;
        const deadline =
          Date.now() + (typeof begin.expires_in === "number" ? begin.expires_in : 900) * 1000;
        let oauth: { access_token: string; refresh_token: string } | null = null;
        // Poll requests can hit transient network errors (observed:
        // AUTH_NETWORK_ERROR on an isolated poll while dozens of identical
        // polls succeed); retry instead of aborting the whole login.
        let consecutiveFailures = 0;

        while (Date.now() < deadline) {
          await sleep(interval);
          if (cancelledRef.current) return;
          let poll: DevicePollResult;
          try {
            poll = await loginSession.authDevicePoll(
              MICROSOFT_CLIENT_ID,
              begin.device_code,
            );
          } catch (e) {
            if (isTransientAuthError(e) && consecutiveFailures < 6) {
              consecutiveFailures += 1;
              continue;
            }
            throw e;
          }
          consecutiveFailures = 0;
          if (poll.state === "authenticated") {
            oauth = poll.credential;
            break;
          }
          if (poll.state === "slow_down") interval += 5000;
        }
        if (!oauth) throw new Error("device-code-expired");

        // Persist the refresh token before the exchange can fail (§6.3).
        await credentialSet(PENDING_KEY, oauth.refresh_token);
        if (cancelledRef.current) return;
        setLogin((current) => ({ ...current, status: "finishing" }));

        const exchange = await (async () => {
          try {
            return await loginSession.authMinecraftExchange(
              MICROSOFT_CLIENT_ID,
              oauth.access_token,
            );
          } catch (e) {
            if (!isTransientAuthError(e) || cancelledRef.current) throw e;
            await sleep(2000);
            if (cancelledRef.current) throw new Error("cancelled");
            return loginSession.authMinecraftExchange(
              MICROSOFT_CLIENT_ID,
              oauth.access_token,
            );
          }
        })();
        const xuid = exchange.session.xuid;
        const profile: AccountProfile = {
          id: exchange.session.uuid,
          player_name: exchange.session.player_name,
          client_id: MICROSOFT_CLIENT_ID,
          // Core rejects empty xuid (validateXuid: 1-32 digits); some
          // accounts have none — omit it instead of sending "".
          ...(typeof xuid === "string" && xuid.length > 0 ? { xuid } : {}),
        };
        await credentialSet(profile.id, oauth.refresh_token);
        await credentialDelete(PENDING_KEY);
        await session?.accountSave(profile);
        await refresh();
        update({ activeAccountId: profile.id });
        if (!cancelledRef.current) {
          setLogin(null);
          toast.success(t("account.login.success", { name: profile.player_name }));
        }
      } catch (e) {
        if (!cancelledRef.current) {
          setLogin((current) => ({
            userCode: current?.userCode,
            verificationUri: current?.verificationUri,
            status: "error",
            error:
              e instanceof Error && e.message === "device-code-expired"
                ? t("account.login.expired")
                : errorText(e),
          }));
        }
      } finally {
        loginSessionRef.current = null;
        void loginSession?.close();
      }
    })();
  }, [openSession, settings.language, session, refresh, update, t]);

  const getLaunchSession = useCallback(async (): Promise<AuthSession | null> => {
    if (!activeAccount) return null;
    const refreshToken = await credentialGet(activeAccount.id);
    if (!refreshToken) throw new ReloginRequiredError();

    const authSession = await openSession();
    try {
      let result: RefreshExchangeResult;
      try {
        result = await authSession.authMinecraftRefreshExchange(
          activeAccount.client_id,
          refreshToken,
        );
      } catch (e) {
        // RPC-level failure: no rotated token arrived, nothing to persist.
        throw isTransientAuthError(e) ? new AuthTransientError() : e;
      }
      // §6.4: persist the rotated token BEFORE using the session,
      // even when the exchange itself failed.
      await credentialSet(activeAccount.id, result.refresh_token);
      if (result.state === "exchange_failed") {
        throw TRANSIENT_AUTH_CODES[result.exchange_error?.code ?? ""] === true
          ? new AuthTransientError()
          : new ReloginRequiredError();
      }
      return result.session;
    } finally {
      void authSession.close();
    }
  }, [activeAccount, openSession]);

  const value = useMemo<MicrosoftAccountsContextValue>(
    () => ({
      accounts,
      loading,
      error,
      refresh,
      activeAccount,
      setActiveAccount,
      removeAccount,
      login,
      startLogin,
      cancelLogin,
      getLaunchSession,
    }),
    [
      accounts,
      loading,
      error,
      refresh,
      activeAccount,
      setActiveAccount,
      removeAccount,
      login,
      startLogin,
      cancelLogin,
      getLaunchSession,
    ],
  );

  return (
    <MicrosoftAccountsContext.Provider value={value}>
      {children}
    </MicrosoftAccountsContext.Provider>
  );
}

export function useMicrosoftAccounts(): MicrosoftAccountsContextValue {
  const ctx = useContext(MicrosoftAccountsContext);
  if (!ctx) throw new Error("useMicrosoftAccounts outside MicrosoftAccountsProvider");
  return ctx;
}

/**
 * Resolve the launch session: Microsoft account when one is active,
 * otherwise the offline player name. Throws ReloginRequiredError when the
 * active account needs a fresh device login.
 */
export function useLaunchAuth(): () => Promise<AuthSession> {
  const { getLaunchSession } = useMicrosoftAccounts();
  const { settings } = useSettings();
  return useCallback(async () => {
    const microsoft = await getLaunchSession();
    return microsoft ?? makeOfflineSession(settings.playerName);
  }, [getLaunchSession, settings.playerName]);
}
