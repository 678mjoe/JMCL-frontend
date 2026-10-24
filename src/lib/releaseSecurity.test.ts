import { describe, expect, test } from "bun:test";
import config from "../../src-tauri/tauri.conf.json";
import capabilities from "../../src-tauri/capabilities/default.json";
import { unconfiguredUpdate, canUpdate } from "./updates";

describe("release security gates", () => {
  test("unconfigured updater cannot check, download or install", () => {
    for (const action of ["check", "download", "install", "discard", "restart"] as const) expect(canUpdate(unconfiguredUpdate.phase, action)).toBe(false);
    expect(Object.isFrozen(unconfiguredUpdate)).toBe(true);
    expect(config.bundle.createUpdaterArtifacts).toBe(false);
    expect(config.plugins.updater).toEqual({ pubkey: "", requireSignedVersion: true, allowDowngrades: false });
    expect(JSON.stringify(capabilities)).not.toContain("updater:");
  });

  test("production CSP denies remote scripts, frames and arbitrary networking", () => {
    const csp = config.app.security.csp;
    expect(csp["default-src"]).toBe("'none'");
    expect(csp["script-src"]).toBe("'self'");
    expect(csp["connect-src"]).toBe("'self' ipc: http://ipc.localhost");
    for (const directive of ["object-src", "base-uri", "form-action", "frame-src", "worker-src"] as const) {
      expect(csp[directive]).toBe("'none'");
    }
    expect(JSON.stringify(csp)).not.toContain("*");
    expect(JSON.stringify(csp)).not.toContain("unsafe-eval");
    expect(JSON.stringify(csp)).not.toContain("ws:");
  });

  test("only required image origins and bundled fonts are permitted", () => {
    expect(config.app.security.csp["img-src"]).toBe("'self' data: https://minotar.net https://cdn.modrinth.com");
    expect(config.app.security.csp["font-src"]).toBe("'self'");
    // Inline styles are deliberately CSS-only: Base UI/Sonner position overlays
    // and set theme CSS variables dynamically. Scripts never inherit this.
    expect(config.app.security.csp["style-src"]).toBe("'self' 'unsafe-inline'");
    expect(config.app.security.devCsp["script-src"]).toBe("'self' 'unsafe-inline'");
  });
});
