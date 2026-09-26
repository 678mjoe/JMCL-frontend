import { useEffect, useState } from "react";

export function useServerUptime(isDisplayedRunning: boolean, startedAtMs: number | null | undefined, serverId: string) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isDisplayedRunning || startedAtMs === null || startedAtMs === undefined) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [isDisplayedRunning, serverId, startedAtMs]);

  if (!isDisplayedRunning || startedAtMs === null || startedAtMs === undefined) return null;
  return Math.max(0, now - startedAtMs);
}
