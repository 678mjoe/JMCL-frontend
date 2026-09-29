import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EndpointContextProvider, useEndpointContext } from "./endpointContext";
import { SettingsProvider } from "./settings";
import { canonicalEndpointConfig, type EndpointConfigV1 } from "./endpoints";

const testDom = new (await import("happy-dom")).Window({ url: "http://localhost/" });
const testGlobals = globalThis as typeof globalThis & Record<string, unknown>;
Object.assign(testGlobals, {
  window: testDom,
  document: testDom.document,
  localStorage: testDom.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const remoteId = "123e4567-e89b-42d3-a456-426614174000";
const remote: EndpointConfigV1 = {
  version: 1,
  endpoints: [
    { id: "local", kind: "local", label: "Local" },
    { id: remoteId, kind: "ssh", label: "Remote", destination: "user@host", serversDirectory: "/srv" },
  ],
};

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; localStorage.clear(); });

describe("shared endpoint context", () => {
  test("loads once, persists an invalid selected ID fallback, and accepts only existing selections", async () => {
    localStorage.setItem("jmcl.settings.v1", JSON.stringify({ selectedServerEndpointId: "deleted" }));
    const repository = { reads: 0, read: async () => { repository.reads++; return remote; }, write: async () => {} };
    let value!: ReturnType<typeof useEndpointContext>;
    function Capture() { value = useEndpointContext(); return null; }
    const host = document.createElement("div");
    root = createRoot(host);
    await act(async () => {
      root!.render(<SettingsProvider><EndpointContextProvider repository={repository}><Capture /></EndpointContextProvider></SettingsProvider>);
    });
    expect(value.config).toEqual(remote);
    expect(value.selectedEndpointId).toBe("local");
    expect(JSON.parse(localStorage.getItem("jmcl.settings.v1")!).selectedServerEndpointId).toBe("local");
    await act(async () => { expect(value.selectEndpoint(remoteId)).toBe(true); });
    expect(value.selectedEndpoint?.id).toBe(remoteId);
    expect(value.selectEndpoint("missing")).toBe(false);
    expect(value.selectedEndpointId).toBe(remoteId);
    expect(repository.reads).toBe(1);
  });

  test("replace and reload update the shared config without duplicate initial reads", async () => {
    let stored = canonicalEndpointConfig();
    const repository = { reads: 0, read: async () => { repository.reads++; return stored; }, write: async () => {} };
    let value!: ReturnType<typeof useEndpointContext>;
    function Capture() { value = useEndpointContext(); return null; }
    root = createRoot(document.createElement("div"));
    await act(async () => { root!.render(<SettingsProvider><EndpointContextProvider repository={repository}><Capture /></EndpointContextProvider></SettingsProvider>); });
    expect(repository.reads).toBe(1);
    await act(async () => { value.replaceConfig(remote); });
    expect(value.config).toEqual(remote);
    stored = remote;
    await act(async () => { await value.reload(); });
    expect(value.config).toEqual(remote);
    expect(repository.reads).toBe(2);
  });
});
