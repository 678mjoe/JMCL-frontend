import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EndpointContextProvider } from "@/lib/endpointContext";
import { ServersContext, type ServersContextValue } from "@/lib/servers";
import { SettingsProvider } from "@/lib/settings";
import { canonicalEndpointConfig, type EndpointConfigV1 } from "@/lib/endpoints";
import { createEmptyServerStatusCache } from "@/lib/serverStatusCache";

const dom = new Window({ url: "http://localhost/" });
const globals = globalThis as typeof globalThis & Record<string, unknown>;
Object.assign(globals, {
  window: dom, document: dom.document, localStorage: dom.localStorage,
  HTMLElement: dom.HTMLElement, Node: dom.Node, Element: dom.Element, MutationObserver: dom.MutationObserver,
  Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, HTMLButtonElement: dom.HTMLButtonElement,
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  getComputedStyle: dom.getComputedStyle.bind(dom),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { EndpointManager } = await import("./EndpointManager");
const id = "123e4567-e89b-42d3-a456-426614174000";
const initial: EndpointConfigV1 = { version: 1, endpoints: [
  ...canonicalEndpointConfig().endpoints,
  { id, kind: "ssh", label: "Remote", destination: "user@host", serversDirectory: "/srv" },
] };
const buttons = () => [...dom.document.querySelectorAll("button")];
const clickButton = async (name: string) => {
  const button = buttons().find((item) => item.textContent?.trim() === name);
  if (!button) throw new Error(`Button not found: ${name}`);
  await act(async () => { button.click(); });
};
const fill = async (id: string, value: string) => {
  const input = dom.document.getElementById(id) as unknown as HTMLInputElement;
  await act(async () => {
    input.value = value;
    const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"));
    const props = propsKey ? (input as unknown as Record<string, { onChange?: (event: { target: HTMLInputElement; currentTarget: HTMLInputElement; nativeEvent: { defaultPrevented: boolean }; preventDefault: () => void; stopPropagation: () => void }) => void }>)[propsKey] : undefined;
    props?.onChange?.({ target: input, currentTarget: input, nativeEvent: { defaultPrevented: false }, preventDefault() {}, stopPropagation() {} });
  });
};
const renderManager = async (repository: { read: () => Promise<EndpointConfigV1>; write: (value: EndpointConfigV1) => Promise<void> }, testConnection?: Parameters<typeof EndpointManager>[0]["testConnection"]) => {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en" }));
  const serverValue = { cache: createEmptyServerStatusCache(), prepareEndpointDeletion: async () => {} } as unknown as ServersContextValue;
  const host = dom.document.createElement("div"); dom.document.body.append(host);
  root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(
    <SettingsProvider><EndpointContextProvider repository={repository}><ServersContext.Provider value={serverValue}>
      <EndpointManager repository={repository} testConnection={testConnection} />
    </ServersContext.Provider></EndpointContextProvider></SettingsProvider>,
  ));
  return host;
};
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; localStorage.clear(); dom.document.body.replaceChildren(); });

describe("EndpointManager", () => {
  test("renders an immutable Local row and labeled SSH fields without credential controls", async () => {
    let stored = initial;
    const repository = { read: async () => stored, write: async (value: EndpointConfigV1) => { stored = value; } };
    const host = await renderManager(repository);
    expect(host.textContent).toContain("Local");
    expect(host.textContent).toContain("Remote");
    expect(host.querySelectorAll("input").length).toBe(0);
    expect(host.textContent).not.toMatch(/password|private key|executable|command/i);
  });

  test("add and edit forms expose labeled fields without credentials; save retains UUID and invalid input is not written", async () => {
    let stored = initial;
    let writes = 0;
    const repository = { read: async () => stored, write: async (value: EndpointConfigV1) => { writes++; stored = value; } };
    await renderManager(repository);
    await clickButton("Add Endpoint");
    expect(dom.document.querySelectorAll("input").length).toBe(3);
    expect(dom.document.querySelector("label[for='endpoint-label']")).not.toBeNull();
    expect(dom.document.querySelector("label[for='endpoint-destination']")).not.toBeNull();
    expect(dom.document.querySelector("label[for='endpoint-directory']")).not.toBeNull();
    await fill("endpoint-label", "New remote");
    await fill("endpoint-destination", "me@host");
    await fill("endpoint-directory", "/srv/jmcl");
    await clickButton("Confirm");
    expect(writes).toBe(1);
    const created = stored.endpoints.find((endpoint) => endpoint.kind === "ssh" && endpoint.label === "New remote")!;
    expect(created).toMatchObject({ kind: "ssh", label: "New remote", destination: "me@host", serversDirectory: "/srv/jmcl" });
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    await clickButton("Edit");
    expect((dom.document.querySelector("#endpoint-destination") as unknown as HTMLInputElement).value).toBe("user@host");
    await fill("endpoint-destination", "bad host");
    await clickButton("Confirm");
    expect(writes).toBe(1);
    expect(stored.endpoints.find((endpoint) => endpoint.id === id)).toEqual(initial.endpoints[1]);
    expect(stored.endpoints).toContainEqual(created);
  });

  test("delete requires explicit confirmation and does not offer Local deletion", async () => {
    let stored = initial;
    const repository = { read: async () => stored, write: async (value: EndpointConfigV1) => { stored = value; } };
    await renderManager(repository);
    expect(buttons().some((button) => button.textContent?.trim() === "Delete" && button.closest("li")?.textContent?.includes("Local"))).toBe(false);
    await clickButton("Delete");
    expect(dom.document.body.textContent).toContain("Delete “Remote”?");
    expect(stored.endpoints).toHaveLength(2);
    const confirms = buttons().filter((button) => button.textContent?.trim() === "Confirm");
    await act(async () => { confirms.at(-1)!.click(); });
    expect(stored.endpoints.map((endpoint) => endpoint.id)).toEqual(["local"]);
  });

  test("connection test is cancelled when editing, deleting, and unmounting", async () => {
    let stored = initial;
    const repository = { read: async () => stored, write: async (value: EndpointConfigV1) => { stored = value; } };
    const signals: AbortSignal[] = [];
    const testConnection = async (_endpoint: unknown, _opener: unknown, options: { signal?: AbortSignal }) => {
      signals.push(options.signal!);
      return new Promise<never>(() => {});
    };
    await renderManager(repository, testConnection as never);
    await clickButton("Test Connection");
    await clickButton("Edit");
    expect(signals[0].aborted).toBe(true);
    await clickButton("Cancel");
    await clickButton("Test Connection");
    await clickButton("Delete");
    expect(signals[1].aborted).toBe(true);
    await clickButton("Cancel");
    await clickButton("Test Connection");
    act(() => root!.unmount());
    root = undefined;
    expect(signals[2].aborted).toBe(true);
  });
});
