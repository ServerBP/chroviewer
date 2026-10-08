import { expect, test } from 'vite-plus/test';

import { isBeatKhanaFrameAncestor, matchesFrameAncestor } from './embed-origins';

test('trusts every embedder allowed by frame-ancestors', () => {
  expect(isBeatKhanaFrameAncestor('https://bseuc.eu')).toBe(true);
  expect(isBeatKhanaFrameAncestor('https://beatkhana.com')).toBe(true);
  expect(isBeatKhanaFrameAncestor('https://overlay.beatkhana.com')).toBe(true);
  expect(isBeatKhanaFrameAncestor('https://view.replay.beatkhana.com')).toBe(true);
  expect(isBeatKhanaFrameAncestor('https://compcube.net')).toBe(true);
  expect(isBeatKhanaFrameAncestor('http://localhost:5173')).toBe(true);
  expect(isBeatKhanaFrameAncestor('http://localhost')).toBe(true);
});

test('rejects origins outside the list', () => {
  expect(isBeatKhanaFrameAncestor('http://bseuc.eu')).toBe(false);
  expect(isBeatKhanaFrameAncestor('https://bseuc.eu.evil.com')).toBe(false);
  expect(isBeatKhanaFrameAncestor('https://evilbeatkhana.com')).toBe(false);
  expect(isBeatKhanaFrameAncestor('https://shyyluna.dev')).toBe(false);
  expect(isBeatKhanaFrameAncestor('null')).toBe(false);
});

test('matches CSP ports', () => {
  expect(matchesFrameAncestor('https://bseuc.eu:8443', 'https://bseuc.eu')).toBe(false);
  expect(matchesFrameAncestor('https://bseuc.eu:443', 'https://bseuc.eu')).toBe(true);
  expect(matchesFrameAncestor('http://localhost:1420', 'http://localhost:1420')).toBe(true);
  expect(matchesFrameAncestor('http://localhost:1421', 'http://localhost:1420')).toBe(false);
});
