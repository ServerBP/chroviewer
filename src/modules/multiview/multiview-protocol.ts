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
  lights: 'full' | 'static' | 'none';
  settings: Record<string, string | number | boolean>;
  score: unknown;
}

export interface MultiviewConfigMessage {
  type: 'beatkhana:multiview-config';
  version: 1;
  players: MultiviewPlayerConfig[];
}

export interface MultiviewStateMessage {
  type: 'beatkhana:multiview-state';
  version: 1;
  time: number;
  beat: number;
  duration: number;
  playing: boolean;
  map: { title: string; subtitle: string; author: string; mapper: string } | null;
  players: Array<{ id: string; playerId: string; platformIds: string[]; score: unknown }>;
}

export interface MultiviewReadyMessage {
  type: 'beatkhana:multiview-ready';
  version: 1;
}
