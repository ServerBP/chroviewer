import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BeatmapParser } from '../../core/beatmap/worker/client';
import { MultiviewRendererHost } from '../../renderer/multiview-renderer-host';
import { EmbeddedRealtimeScoreTimeline } from '../live/embedded-realtime-score-sync';
import { LiveMapCache } from '../live/live-map-cache';
import { ViewerShell, type MultiviewPlaybackSnapshot } from '../viewer/viewer-shell';
import type { MultiviewConfigMessage, MultiviewPlayerConfig, MultiviewStateMessage } from './multiview-protocol';

interface NativeCompositorBridge {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
}

declare global {
  interface Window {
    beatKhanaNativeCompositor?: NativeCompositorBridge;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameBaseSite(origin: string) {
  try {
    const normalize = (hostname: string) => {
      const value = hostname.toLowerCase().replace(/^www\./, '');
      if (value === 'localhost' || value.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value;
      return value.split('.').slice(-2).join('.');
    };
    return normalize(new URL(origin).hostname) === normalize(location.hostname);
  } catch {
    return false;
  }
}

function validPlayer(value: unknown): value is MultiviewPlayerConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.playerId === 'string' &&
    /^\d+$/.test(value.playerId) &&
    Array.isArray(value.platformIds) &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key])) &&
    typeof value.visible === 'boolean' &&
    typeof value.masterVolume === 'number' &&
    typeof value.hitsoundVolume === 'number' &&
    typeof value.disableGameUI === 'boolean' &&
    (value.lights === 'full' || value.lights === 'static' || value.lights === 'none') &&
    (value.backgroundColor === undefined || typeof value.backgroundColor === 'string') &&
    (value.waitingColor === undefined || typeof value.waitingColor === 'string') &&
    (value.waitingText === undefined || typeof value.waitingText === 'string') &&
    isRecord(value.settings)
  );
}

interface TilePlaybackState {
  duration: number;
  error: string;
  hasMap: boolean;
  playing: boolean;
  status: MultiviewPlaybackSnapshot['status'];
}

function waitingLabel(player: MultiviewPlayerConfig, playback: TilePlaybackState | undefined) {
  if (
    playback !== undefined &&
    playback.status === 'watching' &&
    playback.playing &&
    playback.hasMap &&
    playback.duration > 0
  )
    return null;
  switch (playback?.status) {
    case 'connecting':
      return 'Connecting to TournamentAssistant';
    case 'reconnecting':
      return 'Reconnecting to TournamentAssistant';
    case 'loading':
      return 'Downloading replay map';
    case 'buffering':
      return 'Preparing replay stream';
    case 'paused':
      return 'Player paused';
    case 'error':
      return playback.error || 'Replay stream unavailable';
    default:
      return player.waitingText || 'Waiting for replay stream';
  }
}

export function MultiviewShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [host, setHost] = useState<MultiviewRendererHost | null>(null);
  const [parser, setParser] = useState<BeatmapParser | null>(null);
  const [players, setPlayers] = useState<MultiviewPlayerConfig[]>([]);
  const [tilePlayback, setTilePlayback] = useState<Map<string, TilePlaybackState>>(() => new Map());
  const mapCache = useMemo(() => new LiveMapCache(), []);
  const parentOriginRef = useRef<string | null>(null);
  const playbackRef = useRef(new Map<string, MultiviewPlaybackSnapshot>());
  const lastCorrectionRef = useRef(new Map<string, number>());
  const scoreTimelinesRef = useRef(new Map<string, EmbeddedRealtimeScoreTimeline>());
  const nativeBridge = typeof window === 'undefined' ? undefined : window.beatKhanaNativeCompositor;

  useEffect(() => {
    const sharedParser = new BeatmapParser();
    setParser(sharedParser);
    return () => sharedParser.dispose();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const rendererHost = new MultiviewRendererHost(canvas);
    setHost(rendererHost);
    return () => {
      setHost(null);
      rendererHost.dispose();
    };
  }, []);

  useEffect(() => {
    function applyConfig(data: unknown) {
      if (!isRecord(data) || data.type !== 'beatkhana:multiview-config' || data.version !== 1) return;
      const next = (data as unknown as MultiviewConfigMessage).players;
      if (!Array.isArray(next) || next.length > 12 || !next.every(validPlayer)) return;
      setPlayers(next);
    }
    if (nativeBridge !== undefined) {
      const removeListener = nativeBridge.onMessage(applyConfig);
      nativeBridge.send({ type: 'beatkhana:multiview-ready', version: 1 });
      return removeListener;
    }
    function receive(event: MessageEvent) {
      if (event.source !== window.parent || !sameBaseSite(event.origin)) return;
      parentOriginRef.current = event.origin;
      applyConfig(event.data);
    }
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'beatkhana:multiview-ready', version: 1 }, '*');
    return () => window.removeEventListener('message', receive);
  }, [nativeBridge]);

  useEffect(() => {
    if (host === null) return;
    const activeIds = new Set(players.map((player) => player.id));
    for (const player of players) {
      host.setTile(player.id, {
        x: player.x,
        y: player.y,
        width: player.width,
        height: player.height,
        visible: player.visible,
      });
      let timeline = scoreTimelinesRef.current.get(player.id);
      if (timeline === undefined) {
        timeline = new EmbeddedRealtimeScoreTimeline();
        scoreTimelinesRef.current.set(player.id, timeline);
      }
      if (isRecord(player.score)) timeline.add(player.score);
    }
    for (const id of playbackRef.current.keys()) {
      if (!activeIds.has(id)) playbackRef.current.delete(id);
    }
    setTilePlayback((current) => {
      if ([...current.keys()].every((id) => activeIds.has(id))) return current;
      return new Map([...current].filter(([id]) => activeIds.has(id)));
    });
    for (const id of scoreTimelinesRef.current.keys()) {
      if (!activeIds.has(id)) scoreTimelinesRef.current.delete(id);
    }
  }, [host, players]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const snapshots = players
        .map((player) => ({ player, playback: playbackRef.current.get(player.id) }))
        .filter(
          (entry): entry is { player: MultiviewPlayerConfig; playback: MultiviewPlaybackSnapshot } =>
            entry.playback !== undefined && entry.playback.duration > 0,
        );
      const primary = snapshots.find((entry) => entry.player.masterVolume > 0) ?? snapshots[0];
      if (primary === undefined) return;
      const now = performance.now();
      for (const entry of snapshots) {
        if (entry.player.id === primary.player.id) continue;
        const sameMap = entry.playback.map?.title === primary.playback.map?.title;
        const drift = Math.abs(entry.playback.time - primary.playback.time);
        const lastCorrection = lastCorrectionRef.current.get(entry.player.id) ?? 0;
        if (sameMap && drift > 0.04 && now - lastCorrection > 500) {
          entry.playback.seek(primary.playback.time);
          lastCorrectionRef.current.set(entry.player.id, now);
        }
      }
      const message: MultiviewStateMessage = {
        type: 'beatkhana:multiview-state',
        version: 1,
        time: primary.playback.time,
        beat: primary.playback.beat,
        duration: primary.playback.duration,
        playing: primary.playback.playing,
        map: primary.playback.map,
        players: players.map((player) => ({
          id: player.id,
          playerId: player.playerId,
          platformIds: player.platformIds,
          score: scoreTimelinesRef.current.get(player.id)?.at(primary.playback.time)?.score ?? player.score,
        })),
      };
      if (nativeBridge !== undefined) nativeBridge.send(message);
      else {
        const origin = parentOriginRef.current;
        if (origin !== null) window.parent.postMessage(message, origin);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [nativeBridge, players]);

  const handlePlayback = useCallback((id: string, snapshot: MultiviewPlaybackSnapshot) => {
    playbackRef.current.set(id, snapshot);
    const next: TilePlaybackState = {
      duration: snapshot.duration,
      error: snapshot.error,
      hasMap: snapshot.map !== null,
      playing: snapshot.playing,
      status: snapshot.status,
    };
    setTilePlayback((current) => {
      const previous = current.get(id);
      if (
        previous !== undefined &&
        previous.duration === next.duration &&
        previous.error === next.error &&
        previous.hasMap === next.hasMap &&
        previous.playing === next.playing &&
        previous.status === next.status
      )
        return current;
      const updated = new Map(current);
      updated.set(id, next);
      return updated;
    });
  }, []);

  const runtimePlayers = useMemo(() => {
    let audioClaimed = false;
    return players
      .filter((player) => player.visible)
      .map((player) => {
        const audible = !audioClaimed && player.masterVolume > 0;
        if (audible) audioClaimed = true;
        return { ...player, masterVolume: audible ? player.masterVolume : 0 };
      });
  }, [players]);

  return (
    <main data-multiview-root className="relative size-full overflow-hidden bg-transparent">
      {runtimePlayers.map((player) => {
        const label = waitingLabel(player, tilePlayback.get(player.id));
        return label === null ? null : (
          <div
            key={`${player.id}:waiting`}
            className="pointer-events-none absolute z-20 grid place-items-center overflow-hidden px-4 text-center font-bold uppercase"
            style={{
              background: player.backgroundColor || '#000000',
              color: player.waitingColor || 'rgba(255,255,255,.72)',
              height: `${Math.max(1, player.height)}px`,
              left: `${player.x}px`,
              top: `${player.y}px`,
              width: `${Math.max(1, player.width)}px`,
            }}
          >
            <span className="flex items-center gap-3 text-[clamp(12px,1.25vw,24px)] leading-tight">
              <i className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
              {label}
            </span>
          </div>
        );
      })}
      <canvas ref={canvasRef} className="absolute inset-0 z-10 size-full" />
      {host !== null && parser !== null &&
        runtimePlayers.map((player) => (
          <ViewerShell
            key={player.id}
            multiview={{
              id: player.id,
              playerId: player.playerId,
              host,
              mapCache,
              masterVolume: player.masterVolume,
              hitsoundVolume: player.hitsoundVolume,
              disableGameUI: player.disableGameUI,
              lights: player.lights,
              settings: player.settings,
              parser,
              onPlayback: (snapshot) => handlePlayback(player.id, snapshot),
            }}
          />
        ))}
    </main>
  );
}
