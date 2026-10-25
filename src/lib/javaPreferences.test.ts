import { expect, test } from "bun:test";
import { installationJavaOptions, javaPreferencesFor, withJavaPreferences, parseJavaPreferences, absoluteJavaPath } from "./javaPreferences";
import { mergeStoredSettings } from "./settings";
import { instanceLaunchOptions } from "./instanceLaunch";
import type { InstanceManifest } from "./types";

test("legacy ID-only overrides remain preserved but inactive even when a stored root exists", () => {
  for (const root of [undefined, "", "/old-root"]) {
    const settings = mergeStoredSettings({ instancesDir: root, javaOverrides: { same: "/legacy/java" } });
    expect(settings.javaOverrides.same).toBe("/legacy/java");
    for (const directory of ["/old-root", "/new-root"]) expect(javaPreferencesFor(settings.javaPreferences, directory, "same")).toEqual({ policy: "auto" });
  }
});
test("same ID under different roots has independent policy/candidates/forced overrides", () => {
  let store = withJavaPreferences({}, "/one", "same", { policy: "local", paths: ["/jdk/java"] });
  store = withJavaPreferences(store, "/two", "same", { policy: "managed", override: "C:\\Java\\bin\\java.exe" });
  expect(javaPreferencesFor(store, "/one", "same")).toEqual({ policy: "local", paths: ["/jdk/java"] });
  expect(javaPreferencesFor(store, "/two", "same")).toEqual({ policy: "managed", override: "C:\\Java\\bin\\java.exe" });
  expect(javaPreferencesFor(store, "/three", "same")).toEqual({ policy: "auto" });
  expect(mergeStoredSettings({ javaPreferences: store }).javaPreferences).toEqual(store);
});
test("invalid settings cannot create conflicting or relative Java execution selections", () => {
  for (const value of [null, [], {policy:"other"}, {policy:"auto",override:"java"}, {policy:"auto",paths:["/java\0"]}, {policy:"auto",override:"/java",paths:[]}, {policy:"local",unknown:true}]) expect(parseJavaPreferences(value)).toBeNull();
  for (const path of ["/usr/bin/java", "C:\\jdk\\java.exe", "D:/jdk/java.exe", "\\\\server\\share\\java.exe"]) expect(absoluteJavaPath(path)).toBe(true);
  for (const path of ["java", "C:java", "./java", ""]) expect(absoluteJavaPath(path)).toBe(false);
});
test("launch and preview use policy and ordinary paths without accidentally forcing", () => {
  const instance = {source:"official"} as InstanceManifest;
  expect(instanceLaunchOptions(instance,"/store",{policy:"managed",paths:["/java"]})).toEqual({source:"official",store_directory:"/store",java_policy:"managed",java_paths:["/java"],options:{}});
  expect(instanceLaunchOptions(instance,"/store",{policy:"local",override:"/java"})).toEqual({source:"official",store_directory:"/store",java_policy:"local",java_override:"/java",options:{}});
});

test("installation shares policy/candidates but never a forced launch override", () => {
 expect(installationJavaOptions({policy:"local",paths:["/java"]})).toEqual({java_policy:"local",java_paths:["/java"]});
 expect(installationJavaOptions({policy:"managed",override:"/forced"})).toEqual({java_policy:"managed"});
});
