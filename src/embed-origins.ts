// BeatKhana pages that may embed the viewer. vite.config.ts turns this list into
// the CSP frame-ancestors header, and the multiview shell only accepts configs
// from parents that match it, so adding an embedder here covers both.
export const beatKhanaFrameAncestors = [
  'http://localhost:*',
  'http://localhost:1420',
  'https://beatkhana.com',
  'https://*.beatkhana.com',
  // CSP wildcard host sources do not reliably cover nested subdomains such as
  // view.replay.beatkhana.com, and every ancestor in a nested iframe chain
  // must be allowed explicitly.
  'https://view.beatkhana.com',
  'https://view.replay.beatkhana.com',
  'https://replay.beatkhana.com',
  'https://*.replay.beatkhana.com',
  'https://*.shyyluna.dev',
  'https://*.compcube.net',
  'https://compcube.net',
  'https://bseuc.eu',
];

/** Matches an origin against a CSP host source (`scheme://[*.]host[:port|:*]`). */
export function matchesFrameAncestor(origin: string, source: string) {
  const match = /^(https?):\/\/(\*\.)?([^:/*]+)(?::(\d+|\*))?$/.exec(source);
  if (match === null) return false;
  const [, scheme, wildcard, host, port] = match;
  try {
    const url = new URL(origin);
    if (url.protocol !== `${scheme}:`) return false;
    const hostname = url.hostname.toLowerCase();
    if (wildcard === undefined ? hostname !== host : !hostname.endsWith(`.${host}`)) return false;
    // URL.port is empty for the scheme's default port, as is a source without one.
    return port === '*' || url.port === (port ?? '');
  } catch {
    return false;
  }
}

export function isBeatKhanaFrameAncestor(origin: string) {
  return beatKhanaFrameAncestors.some((source) => matchesFrameAncestor(origin, source));
}
