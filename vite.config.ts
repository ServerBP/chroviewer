import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import rsc from '@vitejs/plugin-rsc';
import { nitro } from 'nitro/vite';
import { defineConfig, loadEnv } from 'vite';

import { enabledViewerSourcesSchema } from './src/sources/source-options';

const sourceFrameAncestors = {
  beatsaver: ['https://beatsaver.com'],
  scoresaber: ['https://scoresaber.com'],
  beatleader: ['https://beatleader.com', 'https://beatleader.xyz'],
};

const beatKhanaFrameAncestors = [
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
];

export default defineConfig(({ mode }) => {
  const enabledSources = enabledViewerSourcesSchema.parse(loadEnv(mode, process.cwd(), 'VITE_').VITE_ENABLED_SOURCES);
  const securityHeaders = {
    'content-security-policy': `frame-ancestors 'self' ${enabledSources
      .flatMap((source) => sourceFrameAncestors[source])
      .concat(beatKhanaFrameAncestors)
      .join(' ')}`,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': '*',
    'access-control-max-age': '86400',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
  };

  return {
    server: { cors: true },
    preview: { cors: true },
    plugins: [
      tanstackStart({ rsc: { enabled: true } }),
      nitro({
        preset: 'node-server',
        compressPublicAssets: { gzip: true, brotli: true },
        routeRules: {
          '/**': { cors: true, headers: securityHeaders },
          '/assets/**': {
            headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          },
          '/environments/**': {
            headers: { 'cache-control': 'public, max-age=3600, must-revalidate' },
          },
          '/environments/textures/**': {
            headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          },
          '/fonts/**': {
            headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          },
          '/twemoji/**': {
            headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          },
          '/health': { headers: { 'cache-control': 'no-store' } },
        },
      }),
      rsc(),
      viteReact(),
      tailwindcss(),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    ssr: {
      external: ['@resvg/resvg-js'],
    },
    optimizeDeps: {
      exclude: ['@resvg/resvg-js'],
    },
    build: {
      sourcemap: false,
      minify: 'oxc',
      chunkSizeWarningLimit: 1024,
    },
  };
});
