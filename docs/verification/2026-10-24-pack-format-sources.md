# Pack activation format research — 2026-10-24

This is source inspection, **not** native/game acceptance. No game, runtime or pack was downloaded or launched. Configured selection, installed files, runtime compatibility and successfully rendered effects are distinct states.

## Resource packs

Inspected upstream HMCL commit `0d20910ea302a907d6a01fec9244ab10d2993d5e` via the GitHub read connector:

- [ResourcePackManager.java](https://github.com/HMCL-dev/HMCL/blob/0d20910ea302a907d6a01fec9244ab10d2993d5e/HMCLCore/src/main/java/org/jackhuang/hmcl/addon/resourcepack/ResourcePackManager.java): `loadOptions` splits on the first colon; `enableResourcePacks` serializes `resourcePacks` as a string list. Modern pack IDs prepend `file/` to the actual filename. Its format boundary is release 1.13 / snapshot 17w43a; older releases use unprefixed filenames. This does not justify treating arbitrary version strings as modern versions.
- [StringUtils.java](https://github.com/HMCL-dev/HMCL/blob/0d20910ea302a907d6a01fec9244ab10d2993d5e/HMCLCore/src/main/java/org/jackhuang/hmcl/util/StringUtils.java): list serialization uses Gson JSON, not comma-separated text or Java Properties.
- [Mojang 26.3 Snapshot 3](https://www.minecraft.net/en-us/article/minecraft-26-3-snapshot-3), “Always-on Post Effect Support”: explains normal resource conflict priority as the last pack in the list winning. Saved selection order is therefore low-to-high priority; a UI presenting highest-first must reverse explicitly.

Preserve non-file IDs (vanilla, loader/built-in IDs) and unknown entries rather than reconstructing the entire list from installed registry contents. HMCL's `isEnabled` also considers `incompatibleResourcePacks`; leaving that setting untouched must not be presented as forcing compatibility or proving that Minecraft will accept the selected pack. No pack-format compatibility table was invented here.

## Iris and Oculus

Inspected branch heads, then re-read configuration source at the exact commit:

- Iris branch `1.21.1`, commit `eb7afb99f747cc8ed5ee4072119539035d33cefd`: [IrisConfig.java](https://github.com/IrisShaders/Iris/blob/eb7afb99f747cc8ed5ee4072119539035d33cefd/common/src/main/java/net/irisshaders/iris/config/IrisConfig.java) reads/writes `shaderPack` and `enableShaders` with Java `Properties`. [Iris.java](https://github.com/IrisShaders/Iris/blob/eb7afb99f747cc8ed5ee4072119539035d33cefd/common/src/main/java/net/irisshaders/iris/Iris.java) resolves `iris.properties` in the loader config directory and resolves the selected filename under `shaderpacks`.
- Oculus branch `1.16.5`, commit `a2ed79988284940bf3f72e1321f6c36530ccbf97`: [IrisConfig.java](https://github.com/Asek3/Oculus/blob/a2ed79988284940bf3f72e1321f6c36530ccbf97/src/main/java/net/coderbot/iris/config/IrisConfig.java) uses those same two keys. [Iris.java](https://github.com/Asek3/Oculus/blob/a2ed79988284940bf3f72e1321f6c36530ccbf97/src/main/java/net/coderbot/iris/Iris.java) defines `MODID` as `oculus` and resolves `MODID + ".properties"` under `FMLPaths.CONFIGDIR`.

These are runtime configuration files, **not options.txt**. A single shader pack is selected; shaders do not form a resource-pack priority stack. Selection plus `enableShaders=true` requests activation, but pack load/compile may still fail.

[Java Properties specification](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Properties.html) documents ISO-8859-1 input streams, Unicode escapes, escaped separators and logical-line continuation. A limited parser must reject unsupported syntax rather than silently corrupt it. Config existence alone does not prove the corresponding runtime is installed or compatible, and one inspected runtime branch does not prove every version uses the same config contract.

## Runtime compatibility guidance

- [Iris catalog metadata](https://api.modrinth.com/v2/project/iris) verifies project ID `YL57xq9U`, slug `iris`, and upstream source `IrisShaders/Iris`.
- [Oculus catalog metadata](https://api.modrinth.com/v2/project/oculus) verifies project ID `GchcoXML`, slug `oculus`, and upstream source `Asek3/Oculus`.
- [Modrinth project-version API](https://docs.modrinth.com/api/operations/getprojectversions/) supports exact game-version and loader filtering, and returns per-version game versions, loaders and dependencies. Query candidate projects for the **actual selected instance version and loader**, validate returned project identity and arrays, and route an explicit compatible version choice through the existing mod install flow. Project-level aggregates do not establish a version/loader combination; dependencies and pack/GPU compatibility remain additional checks. Do not hardcode “Fabric always Iris / Forge always Oculus”.

## OptiFine boundary

The [official OptiFine downloads chart](https://optifine.net/downloads) exposes version-specific Minecraft and Forge compatibility, including N/A cases. This research did not establish an authoritative supported activation-file contract from OptiFine's official source/docs; no guessed `optionsshaders.txt` adapter is justified. Unknown/unverified runtimes should keep automatic config writes unavailable and offer in-game/manual guidance instead. No binaries or download links were followed.
