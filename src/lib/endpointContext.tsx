import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { endpointRepository } from "./native";
import { reconcileSelectedEndpointId, validateEndpointConfig, type Endpoint, type EndpointConfigV1 } from "./endpoints";
import { useSettings } from "./settings";

export interface EndpointContextValue {
  config: EndpointConfigV1 | null;
  loading: boolean;
  error: string | null;
  selectedEndpointId: string;
  selectedEndpoint: Endpoint | null;
  selectEndpoint: (id: string) => boolean;
  /** Publish a config after its repository write has succeeded. */
  replaceConfig: (config: EndpointConfigV1) => void;
  /** Re-read the one shared repository after external changes. */
  reload: () => Promise<void>;
}

const EndpointContext = createContext<EndpointContextValue | null>(null);
type EndpointReader = Pick<typeof endpointRepository, "read">;

export function EndpointContextProvider({ children, repository = endpointRepository }: { children: ReactNode; repository?: EndpointReader }) {
  const { settings, update } = useSettings();
  const [config, setConfig] = useState<EndpointConfigV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialLoad = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await repository.read();
      setConfig(validateEndpointConfig(loaded));
      setError(null);
    } catch {
      setConfig(null);
      setError("Endpoint configuration is unavailable");
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    initialLoad.current ??= reload();
  }, [reload]);

  const selectedEndpointId = config
    ? reconcileSelectedEndpointId(settings.selectedServerEndpointId, config)
    : settings.selectedServerEndpointId;
  useEffect(() => {
    if (config && settings.selectedServerEndpointId !== selectedEndpointId) {
      update({ selectedServerEndpointId: selectedEndpointId });
    }
  }, [config, selectedEndpointId, settings.selectedServerEndpointId, update]);

  const selectEndpoint = useCallback((id: string) => {
    if (!config?.endpoints.some((endpoint) => endpoint.id === id)) return false;
    update({ selectedServerEndpointId: id });
    return true;
  }, [config, update]);
  const replaceConfig = useCallback((next: EndpointConfigV1) => {
    setConfig(validateEndpointConfig(next));
    setError(null);
  }, []);
  const selectedEndpoint = config?.endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null;
  const value = useMemo<EndpointContextValue>(() => ({
    config, loading, error, selectedEndpointId, selectedEndpoint, selectEndpoint, replaceConfig, reload,
  }), [config, loading, error, selectedEndpointId, selectedEndpoint, selectEndpoint, replaceConfig, reload]);
  return <EndpointContext.Provider value={value}>{children}</EndpointContext.Provider>;
}

export function useEndpointContext(): EndpointContextValue {
  const value = useContext(EndpointContext);
  if (!value) throw new Error("useEndpointContext outside EndpointContextProvider");
  return value;
}
