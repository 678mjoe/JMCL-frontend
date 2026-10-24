import { expect, test } from "bun:test";
import { emptyLaunchOptions, launchOptionsFor, parseLaunchOptions, parseLaunchOptionsDraft, parseLaunchOptionsStore, withLaunchOptions } from "./launchOptions";
import { mergeStoredSettings } from "./settings";
test("literal ordered argv keeps duplicates, whitespace, empty strings and shell metacharacters", () => {
  const args = ["-Dpath=a b", "-Xmx1G", "-Xmx2G", "", "$(touch nope)"];
  expect(parseLaunchOptions({ extra_jvm_args: args })?.extra_jvm_args).toEqual(args);
  for (const bad of [null, [], { extra_game_args: [1] }, { extra_jvm_args: ["x\0y"] }, { demo: "false" }, { unknown: true }]) expect(parseLaunchOptions(bad)).toBeNull();
});
test("resolution is paired positive u32 and draft does not accept exponent, fractional or signed syntax", () => {
  for (const [w,h] of [[0,1], [1,0], [1,undefined], [1.5,1], [0x100000000,1], [-1,1]]) expect(parseLaunchOptions({ resolution_width:w,resolution_height:h })).toBeNull();
  expect(parseLaunchOptions({ resolution_width:0xffffffff,resolution_height:1 })).not.toBeNull();
  for (const width of ["1e2","+1","1.0"," 1", "-1"]) expect(parseLaunchOptionsDraft({jvm:"[]",game:"[]",width,height:"1",demo:false,defaults:true})).toBeNull();
});
test("versioned storage isolates normalized roots and preserves other instances", () => {
  let store = withLaunchOptions(emptyLaunchOptions(), "/a/./", "demo", {demo:true});
  store = withLaunchOptions(store,"/b","demo",{extra_game_args:["literal"]});
  expect(launchOptionsFor(store,"/a","demo")).toEqual({demo:true});
  expect(launchOptionsFor(store,"/b","demo")).toEqual({extra_game_args:["literal"]});
  expect(launchOptionsFor(store,"/a","other")).toEqual({});
});
test("malformed startup entries/future versions cannot affect good settings", () => {
  const good=withLaunchOptions(emptyLaunchOptions(),"/a","demo",{demo:true});
  const settings=mergeStoredSettings({theme:"dark",javaOverrides:{demo:"/java"},launchOptions:{...good,instances:{...good.instances,bad:{extra_game_args:[null]}}}});
  expect(settings.theme).toBe("dark"); expect(settings.javaOverrides).toEqual({demo:"/java"});
  expect(launchOptionsFor(settings.launchOptions,"/a","demo")).toEqual({demo:true});
  expect(settings.launchOptions.instances.bad).toBeUndefined();
  for(const invalid of [null,[],{version:2,instances:good.instances},{version:1,instances:null}]) expect(parseLaunchOptionsStore(invalid)).toEqual(emptyLaunchOptions());
  expect(mergeStoredSettings({}).launchOptions).toEqual(emptyLaunchOptions());
});
