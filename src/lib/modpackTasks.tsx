import { createContext, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLauncher } from "./launcher";
import { instanceMutationKey } from "./instanceCoordinator";
import { ModpackImportController, type ModpackImportInput, type ModpackSession } from "./modpackImport";
import type { ModpackPreview } from "./modpackPreview";

export interface ModpackDraft { id: string; file: string; preview: ModpackPreview | null }
export interface ModpackTask { key: string; controller: ModpackImportController }
const scope = (directory: string, store: string) => JSON.stringify([directory, store]);
/** Application-owned, in-memory jobs. Navigation/closing a view never cancels RPC. */
export class ModpackTaskRegistry {
  private tasks: ModpackTask[] = [];
  private drafts = new Map<string, ModpackDraft>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private serial = 0;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.revision;
  private changed() { this.revision++; this.listeners.forEach(fn => fn()); }
  list() { return this.tasks; }
  draft(directory: string, store: string): ModpackDraft { return this.drafts.get(scope(directory, store)) ?? { id: "", file: "", preview: null }; }
  setDraft(directory: string, store: string, draft: ModpackDraft) { this.drafts.set(scope(directory, store), draft); this.changed(); }
  start(input: ModpackImportInput, open: () => Promise<ModpackSession>): ModpackTask {
    const existing = this.tasks.find(task => {
      if (instanceMutationKey(task.controller.input.directory, task.controller.input.id) !== instanceMutationKey(input.directory, input.id)) return false;
      const state = task.controller.getSnapshot();
      return state.busy || state.canResume || state.error === "IMPORT_OUTCOME_UNKNOWN" || state.error === "INVALID_INSTANCE_RESULT";
    });
    if (existing) return existing;
    const controller = new ModpackImportController(input, open);
    const task = { key: `modpack-${++this.serial}`, controller };
    controller.subscribe(() => this.changed());
    this.tasks = [...this.tasks, task];
    this.changed();
    void controller.run();
    return task;
  }
  dismiss(key: string) {
    const task = this.tasks.find(task => task.key === key);
    // Only completed or safely editable pre-import failures may be retired.
    if (!task) return;
    const state = task.controller.getSnapshot();
    if (state.busy || (state.phase !== "success" && !state.canEdit)) return;
    this.tasks = this.tasks.filter(task => task.key !== key); this.changed();
  }
}
interface ContextValue {
  registry: ModpackTaskRegistry;
  open: boolean;
  selected: string | null;
  show: (key?: string) => void;
  hide: () => void;
  start: (input: ModpackImportInput) => void;
  edit: () => void;
}
const Context = createContext<ContextValue | null>(null);
export function ModpackTasksProvider({ children }: { children: ReactNode }) {
  const { openSession } = useLauncher();
  const openRef = useRef(openSession); openRef.current = openSession;
  const [registry] = useState(() => new ModpackTaskRegistry());
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  return <Context.Provider value={{ registry, open, selected,
    show: key => { setSelected(key ?? null); setOpen(true); },
    hide: () => setOpen(false),
    start: input => { const task = registry.start(input, () => openRef.current()); setSelected(task.key); },
    edit: () => { if (selected) registry.dismiss(selected); setSelected(null); },
  }}>{children}</Context.Provider>;
}
export function useModpackTasks() {
  const value = useContext(Context);
  if (!value) throw new Error("useModpackTasks outside ModpackTasksProvider");
  useSyncExternalStore(value.registry.subscribe, value.registry.getSnapshot);
  return value;
}
