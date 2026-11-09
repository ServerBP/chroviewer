export interface CompositorTransport {
  playing: boolean;
  /** Song seconds at `at`. */
  time: number;
  rate: number;
  /** performance.now() when the transport was received. */
  at: number;
}

export interface TilePlayback {
  ready: boolean;
  time: number;
  duration: number;
  playing: boolean;
  playbackRate: number;
}

export interface TileSyncAction {
  rate?: number;
  seek?: number;
  correct?: number;
  play?: boolean;
  pause?: boolean;
}

// Small drift is corrected smoothly by the song clock, large jumps (a seek in the parent) are seeks
const PAUSED_TOLERANCE_SECONDS = 0.05;
const CORRECT_AFTER_SECONDS = 0.08;
const SEEK_AFTER_SECONDS = 0.75;

export function transportTimeAt(transport: CompositorTransport, now: number) {
  return transport.time + (transport.playing ? ((now - transport.at) / 1000) * transport.rate : 0);
}

/**
 * What a tile has to do to show the parent's clock. A replay only plays inside its own song: before
 * it starts and after it ends (a failed or shorter play) it waits on its first or last frame.
 */
export function planTileSync(
  tile: TilePlayback,
  target: number,
  transport: Pick<CompositorTransport, 'playing' | 'rate'>,
): TileSyncAction {
  if (!tile.ready || tile.duration <= 0 || !Number.isFinite(target)) return {};
  const action: TileSyncAction = {};
  if (Math.abs(tile.playbackRate - transport.rate) > 1e-3) action.rate = transport.rate;
  const inside = target >= 0 && target < tile.duration;
  const clamped = Math.min(Math.max(target, 0), tile.duration);
  if (!transport.playing || !inside) {
    if (tile.playing) action.pause = true;
    if (Math.abs(tile.time - clamped) > PAUSED_TOLERANCE_SECONDS) action.seek = clamped;
    return action;
  }
  if (!tile.playing) {
    if (Math.abs(tile.time - target) > PAUSED_TOLERANCE_SECONDS) action.seek = target;
    action.play = true;
    return action;
  }
  const drift = Math.abs(tile.time - target);
  if (drift > SEEK_AFTER_SECONDS) action.seek = target;
  else if (drift > CORRECT_AFTER_SECONDS) action.correct = target;
  return action;
}
