export function corsProxyUrl(url: string, proxyUrl: string, currentOrigin?: string): string {
  let target: URL;
  let proxy: URL;
  try {
    target = new URL(url);
    proxy = new URL(proxyUrl);
  } catch {
    return url;
  }

  if (!['http:', 'https:'].includes(target.protocol)) return url;
  if (target.origin === proxy.origin || target.origin === currentOrigin) return url;

  const proxyBase = proxy.href.replace(/\/+$/, '');
  const scheme = target.protocol.slice(0, -1);
  return `${proxyBase}/${scheme}/${target.host}${target.pathname}${target.search}`;
}
