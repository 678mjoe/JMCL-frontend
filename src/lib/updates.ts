/**
 * Release gate, not an updater implementation. Enabling updates requires a
 * separately reviewed native plugin integration, HTTPS endpoint, signing public
 * key, signed artifacts and platform acceptance. No runtime preference or
 * environment variable may enable an unconfigured update channel.
 */
export const updateAvailability = Object.freeze({
  state: "unconfigured" as const,
  canCheck: false as const,
  canDownload: false as const,
  canInstall: false as const,
});
