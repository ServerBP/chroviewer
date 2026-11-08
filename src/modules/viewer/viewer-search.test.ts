import { expect, test } from 'vite-plus/test';
import * as z from 'zod/mini';

import {
  hasConfiguredShowcase,
  hasExternallyConfiguredSettings,
  viewerSearchForShare,
  viewerSearchSchema,
} from './viewer-search';

test('standalone showcase map previews do not claim configured showcase loading', () => {
  expect(hasConfiguredShowcase({ showcase: true, showcaseConfig: undefined })).toBe(false);
});

test('configured showcases retain ownership of map loading', () => {
  expect(hasConfiguredShowcase({ showcase: true, showcaseConfig: '{"maps":[]}' })).toBe(true);
  expect(hasConfiguredShowcase({ showcase: false, showcaseConfig: '{"maps":[]}' })).toBe(false);
});

test('recognizes query-driven viewer settings as external configuration', () => {
  expect(hasExternallyConfiguredSettings(z.parse(viewerSearchSchema, {}))).toBe(false);
  expect(hasExternallyConfiguredSettings(z.parse(viewerSearchSchema, { renderScale: 0.75 }))).toBe(true);
  expect(hasExternallyConfiguredSettings(z.parse(viewerSearchSchema, { settings: { replayCameraFov: 90 } }))).toBe(
    true,
  );
});

test('tarfPath accepts paths on this site and https URLs', () => {
  expect(z.parse(viewerSearchSchema, { tarfPath: '/replays/match.tarf' }).tarfPath).toBe('/replays/match.tarf');
  expect(z.parse(viewerSearchSchema, { tarfPath: 'https://cdn.example.com/a.tarf' }).tarfPath).toBe(
    'https://cdn.example.com/a.tarf',
  );
  // Protocol relative paths would point at another site without going through the source proxy
  expect(z.parse(viewerSearchSchema, { tarfPath: '//cdn.example.com/a.tarf' }).tarfPath).toBeUndefined();
  expect(z.parse(viewerSearchSchema, { tarfPath: 'http://cdn.example.com/a.tarf' }).tarfPath).toBeUndefined();
  expect(z.parse(viewerSearchSchema, { tarfPath: '/replays/match.tarf', map: 'abc' }).map).toBeUndefined();
});

test('map shares retain ranked difficulty and characteristic alongside fork settings', () => {
  const share = viewerSearchForShare({ type: 'map', mapKey: 'abc', difficulty: 9, characteristic: 'OneSaber' }, 12, {
    saberModel: 'cg5',
    saberTrailDuration: 0.4,
    replayTrailSmoothing: false,
  });
  const search = z.parse(viewerSearchSchema, { ...share, hideUI: true, hidePlatform: true });
  expect(search).toMatchObject({
    map: 'abc',
    difficulty: 9,
    characteristic: 'OneSaber',
    beat: 12,
    hideUI: true,
    hidePlatform: true,
    settings: { saberModel: 'cg5', saberTrailDuration: 0.4, replayTrailSmoothing: false },
  });
});

test('TARF sources discard map selection while preserving independent preview parameters', () => {
  const replay = z.parse(viewerSearchSchema, {
    tarfPath: '/replays/a.tarf',
    map: 'abc',
    difficulty: 7,
    characteristic: 'Standard',
  });
  expect(replay.map).toBeUndefined();
  expect(replay.difficulty).toBeUndefined();
  expect(replay.characteristic).toBeUndefined();
  expect(
    z.parse(viewerSearchSchema, {
      map: 'abc',
      previewSource: 'beatleader',
      previewDifficulty: 9,
      previewCharacteristic: 'OneSaber',
      previewStartSeconds: 30,
    }),
  ).toMatchObject({
    previewSource: 'beatleader',
    previewDifficulty: 9,
    previewCharacteristic: 'OneSaber',
    previewStartSeconds: 30,
  });
});
