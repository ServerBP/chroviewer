import { expect, test } from 'vite-plus/test';

import { embeddingReplyOrigin, isEmbeddingParentMessage } from './embedding';

const parent = {} as Window;
const otherWindow = {} as Window;

for (const origin of [
  'https://new-overlay.example',
  'https://nested.overlay.example:8443',
  'http://another-overlay.example:8080',
  'http://localhost:5173',
  'http://127.0.0.1:4000',
  'null',
]) {
  test(`accepts the embedding parent from ${origin} without domain registration`, () => {
    const message = { source: parent, origin };
    expect(isEmbeddingParentMessage(message, parent)).toBe(true);
    expect(embeddingReplyOrigin(origin)).toBe(origin === 'null' ? '*' : origin);
  });

  test(`rejects messages from other windows regardless of ${origin}`, () => {
    const message = { source: otherWindow, origin };
    expect(isEmbeddingParentMessage(message, parent)).toBe(false);
    expect(isEmbeddingParentMessage({ source: null }, parent)).toBe(false);
  });
}
