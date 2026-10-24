import { expect, test } from "bun:test";
import { diagnosticFailures, diagnosticOperations } from "./diagnostics";

test("native and renderer diagnostic vocabularies stay identical", async () => {
  // The source-level check complements typed serialization/parser tests: adding
  // a native category must not silently disappear in the renderer (or vice versa).
  const source = await Bun.file(new URL("../../src-tauri/src/diagnostics.rs", import.meta.url)).text();
  const operations = source.match(/operations!\s*\{([\s\S]*?)\n\}/)?.[1];
  const failures = source.match(/pub enum Failure\s*\{([\s\S]*?)\n\}/)?.[1];
  expect(operations).toBeDefined();
  expect(failures).toBeDefined();
  const nativeOperations = [...operations!.matchAll(/=>\s*\("([^"]+)"/g)].map(match => match[1]);
  nativeOperations.push("other");
  const nativeFailures = [...failures!.matchAll(/^\s*([A-Z][A-Za-z]+),\s*$/gm)]
    .map(match => match[1].replace(/[A-Z]/g, (char, offset: number) => `${offset ? "_" : ""}${char.toLowerCase()}`));
  expect(nativeOperations.sort()).toEqual([...diagnosticOperations].sort());
  expect(nativeFailures.sort()).toEqual([...diagnosticFailures].sort());
});
