import type { ReplayCompositorLayout } from './replay-compositor-layout';

/** One player's replay. Players with the same `side` share their half of the view. */
export interface ReplayCompositorPlayer {
  id: string;
  /** A .tarf replay: a path on this site or an HTTPS URL. */
  tarfPath: string;
  side: number;
  name: string;
  avatarUrl?: string;
  /** Accent of the player's name tag, like their team colour. */
  color?: string;
  /** Added to the transport time for this replay, for plays that started a little earlier or later. */
  offsetSeconds?: number;
  settings?: Record<string, string | number | boolean>;
}

export interface ReplayCompositorConfigMessage {
  type: 'beatkhana:replay-compositor-config';
  version: 1;
  players: ReplayCompositorPlayer[];
  /** auto: top and bottom when each side has three players, otherwise left and right. */
  layout?: ReplayCompositorLayout;
  /** Show only this player, filling the view. */
  focus?: string | null;
  /** The player whose song and hitsounds are heard; the focused or first player when left out. */
  audio?: string | null;
  /** 0..1 */
  volume?: number;
  hitsoundVolume?: number;
  showNames?: boolean;
  disableGameUI?: boolean;
}

/** The parent's clock, in song seconds. Send it on every play, pause, seek or rate change; tiles keep in step between messages. */
export interface ReplayCompositorTransportMessage {
  type: 'beatkhana:replay-compositor-transport';
  version: 1;
  playing: boolean;
  time: number;
  rate: number;
}

export type ReplayCompositorTileStatus = 'loading' | 'ready' | 'playing' | 'error';

export interface ReplayCompositorStateMessage {
  type: 'beatkhana:replay-compositor-state';
  version: 1;
  /** Every replay has loaded or failed. */
  ready: boolean;
  time: number;
  /** The longest replay. */
  duration: number;
  players: Array<{ id: string; status: ReplayCompositorTileStatus; error: string; time: number; duration: number }>;
}

export interface ReplayCompositorReadyMessage {
  type: 'beatkhana:replay-compositor-ready';
  version: 1;
}
