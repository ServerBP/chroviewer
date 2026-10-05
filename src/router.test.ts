import { expect, test } from 'vite-plus/test';
import * as z from 'zod/mini';

import { viewerSearchSchema } from './modules/viewer/viewer-search';
import { parseUrlSearch } from './router';

test('canonicalizes the legacy replay trail shape before route validation', () => {
  const parsed = parseUrlSearch('?replayTrailShape=flag');

  expect(parsed.settings).toEqual({ replayTrailStyle: 'flag' });
  expect(z.parse(viewerSearchSchema, parsed).settings).toEqual(parsed.settings);
});

test('canonicalizes the legacy replay trail shape inside the settings object', () => {
  const settings = encodeURIComponent(JSON.stringify({ replayTrailShape: 'rectangle' }));
  const parsed = parseUrlSearch(`?settings=${settings}`);

  expect(parsed.settings).toEqual({ replayTrailStyle: 'rectangle' });
  expect(z.parse(viewerSearchSchema, parsed).settings).toEqual(parsed.settings);
});

test('parses isolated settings mode case-insensitively', () => {
  const parsed = parseUrlSearch('?ISOLATEDSETTINGS=true');

  expect(z.parse(viewerSearchSchema, parsed).isolatedSettings).toBe(true);
});

test('parses trail smoothing as a direct viewer setting', () => {
  const parsed = parseUrlSearch('?replayTrailSmoothing=false');

  expect(parsed.settings).toEqual({ replayTrailSmoothing: false });
  expect(z.parse(viewerSearchSchema, parsed).settings).toEqual(parsed.settings);
});
