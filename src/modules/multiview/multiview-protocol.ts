export interface MultiviewPlayerConfig {
  id: string;
  playerId: string;
  platformIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  masterVolume: number;
  hitsoundVolume: number;
  disableGameUI: boolean;
  hidePlatform?: boolean;
  lights: 'full' | 'static' | 'none';
  backgroundColor?: string;
  waitingColor?: string;
  waitingText?: string;
  settings: Record<string, string | number | boolean>;
  score: unknown;
}

export interface MultiviewConfigMessage {
  type: 'beatkhana:multiview-config';
  version: 1;
  players: MultiviewPlayerConfig[];
  /** Stream each tile's replay score back at this many updates per second (1 to 60). Omitted or 0 sends none. */
  scores?: { rateHz: number };
}

export interface MultiviewStateMessage {
  type: 'beatkhana:multiview-state';
  version: 1;
  time: number;
  beat: number;
  duration: number;
  playing: boolean;
  mapHash: string | null;
  map: { title: string; subtitle: string; author: string; mapper: string } | null;
  players: Array<{
    id: string;
    playerId: string;
    platformIds: string[];
    score: unknown;
    status: string;
    time: number;
  }>;
}

export interface MultiviewReadyMessage {
  type: 'beatkhana:multiview-ready';
  version: 1;
}

export interface MultiviewScoresMessage {
  type: 'beatkhana:multiview-scores';
  version: 1;
  players: Array<{
    id: string;
    playerId: string;
    platformIds: string[];
    /** Read from the replay the tile is drawing; null until its playback reaches the replay. */
    score: Record<string, number> | null;
    time: number;
  }>;
}
