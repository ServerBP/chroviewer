import { expect, test } from 'vite-plus/test';

import { hasConfiguredShowcase } from './viewer-search';

test('standalone showcase map previews do not claim configured showcase loading', () => {
  expect(hasConfiguredShowcase({ showcase: true, showcaseConfig: undefined })).toBe(false);
});

test('configured showcases retain ownership of map loading', () => {
  expect(hasConfiguredShowcase({ showcase: true, showcaseConfig: '{"maps":[]}' })).toBe(true);
  expect(hasConfiguredShowcase({ showcase: false, showcaseConfig: '{"maps":[]}' })).toBe(false);
});
