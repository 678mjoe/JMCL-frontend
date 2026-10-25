import { describe, expect, test } from "bun:test";
import { modpackPreviewErrorCode, parseModpackPreview, previewModpack } from "./modpackPreview";
const valid = { provider:"modrinth", name:"Pack", version:"v1", minecraft_version:"1.20.1", loader:{kind:"fabric",version:"0.15.0"}, files_declared:4, files_optional:null } as const;
describe("bounded native modpack metadata contract", () => {
  test("retains only known metadata, never raw manifest URLs or credentials", () => {
    expect(parseModpackPreview({...valid, url:"https://private.invalid/?token=secret", key:"secret"})).toEqual(valid);
  });
  test("accepts vanilla/no-version and CurseForge optional reference count", () => {
    expect(parseModpackPreview({...valid,provider:"curseforge",version:null,loader:null,files_optional:1})).toEqual({...valid,provider:"curseforge",version:null,loader:null,files_optional:1});
  });
  test("rejects invalid types, malicious display strings and impossible metadata", () => {
    for (const patch of [{name:"Pack\u0000secret"},{name:""},{name:"x".repeat(257)},{provider:"guessed"},{minecraft_version:"../../escape"},{loader:{kind:"quilt",version:"1"}},{files_declared:-1},{files_declared:4097},{files_declared:0.5},{files_optional:1},{version:undefined},{loader:undefined}]) {
      expect(()=>parseModpackPreview({...valid,...patch})).toThrow();
    }
    expect(()=>parseModpackPreview({...valid,provider:"curseforge",files_optional:5})).toThrow();
  });
  test("safe error presentation distinguishes budgets and unsupported format, redacts unknown errors", () => {
    expect(modpackPreviewErrorCode({code:"MODPACK_PREVIEW_LIMIT",message:"private path"})).toBe("MODPACK_PREVIEW_LIMIT");
    expect(modpackPreviewErrorCode({code:"MODPACK_PREVIEW_UNSUPPORTED"})).toBe("MODPACK_PREVIEW_UNSUPPORTED");
    expect(modpackPreviewErrorCode(new Error("token=secret"))).toBe("MODPACK_PREVIEW_READ_FAILED");
  });
  test("browser previews are explicitly synthetic and return typed metadata", async () => {
    expect((await previewModpack("/mock/pack.mrpack")).name).toBe("Synthetic Modrinth Pack");
    expect((await previewModpack("/mock/pack.zip")).provider).toBe("curseforge");
    await expect(previewModpack("")).rejects.toEqual({code:"MODPACK_PREVIEW_INVALID"});
  });
});
