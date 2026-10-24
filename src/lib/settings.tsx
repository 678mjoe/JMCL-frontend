/**
 * App settings: theme, language, directories, offline player name.
 * Persisted to localStorage; theme is applied to <html> as `.dark`.
 * Directory defaults resolve from the Tauri app-data dir on first run.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate, type Language, type MessageKey } from "./i18n";
import type { Source } from "./types";
import { appDataDirectories } from "./native";
import { emptyLaunchOptions, parseLaunchOptionsStore, type LaunchOptionsStore } from "./launchOptions";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  theme: Theme;
  language: Language;
  playerName: string;
  /** Absolute paths; empty until resolved from app-data on first run. */
  instancesDir: string;
  storeDir: string;
  serversDir: string;
  source: Source;
  hideTestVersions: boolean;
  /** Selected Microsoft account id (public metadata; tokens stay in the keychain). */
  activeAccountId: string | null;
  selectedServerEndpointId: string;
  /** Per-instance java_override executable paths; absent = auto policy (docs/java.md §Forced Override). */
  javaOverrides: Record<string, string>;
  launchOptions: LaunchOptionsStore;
}

const STORAGE_KEY = "jmcl.settings.v1";

const defaults: Settings = {
  theme: "system",
  language: "zh",
  playerName: "Player",
  instancesDir: "",
  storeDir: "",
  serversDir: "",
  source: "official",
  hideTestVersions: true,
  activeAccountId: null,
  selectedServerEndpointId: "local",
  javaOverrides: {},
  launchOptions: emptyLaunchOptions(),
};

export function mergeStoredSettings(stored: unknown): Settings {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return defaults;
  const value = stored as Record<string, unknown>;
  const result: Settings = { ...defaults, launchOptions: parseLaunchOptionsStore(value.launchOptions), javaOverrides: {} };
  // Validate each field independently so corrupt/new preferences cannot crash
  // startup or erase unrelated valid legacy preferences.
  for (const key of ["playerName", "instancesDir", "storeDir", "serversDir", "selectedServerEndpointId"] as const) {
    if (typeof value[key] === "string") result[key] = value[key];
  }
  if (value.theme === "system" || value.theme === "light" || value.theme === "dark") result.theme = value.theme;
  if (value.language === "zh" || value.language === "en") result.language = value.language;
  if (value.source === "official" || value.source === "bmclapi") result.source = value.source;
  if (typeof value.hideTestVersions === "boolean") result.hideTestVersions = value.hideTestVersions;
  if (typeof value.activeAccountId === "string" || value.activeAccountId === null) result.activeAccountId = value.activeAccountId;
  if (value.javaOverrides && typeof value.javaOverrides === "object" && !Array.isArray(value.javaOverrides)) {
    result.javaOverrides = Object.fromEntries(Object.entries(value.javaOverrides).filter(([, path]) => typeof path === "string"));
  }
  return result;
}

function loadStored(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeStoredSettings(JSON.parse(raw));
  } catch {
    // Corrupted storage — fall back to defaults.
  }
  return defaults;
}

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function applyTheme(theme: Theme) {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && systemDark);
  document.documentElement.classList.toggle("dark", dark);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadStored);

  // Resolve default directories once (Tauri app-data dir).
  useEffect(() => {
    if (settings.instancesDir && settings.storeDir && settings.serversDir) return;
    let cancelled = false;
    void appDataDirectories()
      .then(({ instancesDir, storeDir, serversDir }) => {
        if (!cancelled) {
          setSettings((s) => ({
            ...s,
            instancesDir: s.instancesDir || instancesDir,
            storeDir: s.storeDir || storeDir,
            serversDir: s.serversDir || serversDir,
          }));
        }
      })
      .catch(() => {
        // Outside Tauri (plain browser dev): leave empty; pages show errors.
      });
    return () => {
      cancelled = true;
    };
  }, [settings.instancesDir, settings.storeDir]);

  // Persist + apply theme.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [settings.theme]);

  const update = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      t: (key, vars) => translate(settings.language, key, vars),
    }),
    [settings, update],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
