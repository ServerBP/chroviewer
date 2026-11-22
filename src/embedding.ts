/** Any origin may embed the viewer; only its immediate parent may control it. */
export function isEmbeddingParentMessage(event: Pick<MessageEvent, 'source'>, parent: Window) {
  return event.source === parent;
}

/** Opaque origins (sandboxed frames and local files) cannot be targetOrigin values. */
export function embeddingReplyOrigin(origin: string) {
  return origin === 'null' ? '*' : origin;
}
