import { describe, expect, test } from 'bun:test';

import { corsProxyUrl } from './cors-proxy';

const proxyUrl = 'https://c.prox.artemis.shyyluna.dev';

describe('corsProxyUrl', () => {
  test('converts an HTTPS URL to the proxy path format', () => {
    expect(corsProxyUrl('https://scoresaber.com/api/v2/leaderboards/42/scores?page=1', proxyUrl)).toBe(
      'https://c.prox.artemis.shyyluna.dev/https/scoresaber.com/api/v2/leaderboards/42/scores?page=1',
    );
  });

  test('preserves HTTP, a target port, path, and query string', () => {
    expect(corsProxyUrl('http://example.com:8080/scores/latest?limit=1#ignored', proxyUrl)).toBe(
      'https://c.prox.artemis.shyyluna.dev/http/example.com:8080/scores/latest?limit=1',
    );
  });

  test('does not proxy relative, same-origin, or already-proxied URLs', () => {
    expect(corsProxyUrl('/api/source?url=https%3A%2F%2Fexample.com', proxyUrl)).toBe(
      '/api/source?url=https%3A%2F%2Fexample.com',
    );
    expect(
      corsProxyUrl(
        'https://chroviewer.artemis.shyyluna.dev/health',
        proxyUrl,
        'https://chroviewer.artemis.shyyluna.dev',
      ),
    ).toBe('https://chroviewer.artemis.shyyluna.dev/health');
    expect(corsProxyUrl(`${proxyUrl}/https/scoresaber.com/api/v2/scores`, proxyUrl)).toBe(
      `${proxyUrl}/https/scoresaber.com/api/v2/scores`,
    );
  });
});
