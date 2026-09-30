import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BeatmapParser } from '../../core/beatmap/worker/client';
import { MultiviewRendererHost } from '../../renderer/multiview-renderer-host';
import { EmbeddedRealtimeScoreTimeline } from '../live/embedded-realtime-score-sync';
import { LiveMapCache } from '../live/live-map-cache';
import { ViewerShell, type MultiviewPlaybackSnapshot } from '../viewer/viewer-shell';
import type { MultiviewConfigMessage, MultiviewPlayerConfig, MultiviewStateMessage } from './multiview-protocol';
import {
  advanceMultiviewCorrection,
  MultiviewTimeline,
  multiviewAudioOwner,
  type MultiviewCorrectionState,
} from './multiview-timeline';

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

function trustedParentOrigin(origin: string) {
  if (sameBaseSite(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    return (
      (protocol === 'http:' &&
        (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]')) ||
      (protocol === 'https:' && (hostname === 'beatkhana.com' || hostname.endsWith('.beatkhana.com')))
    );
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

function samePlayerConfiguration(current: MultiviewPlayerConfig[], next: MultiviewPlayerConfig[]) {
  if (current.length !== next.length) return false;
  return current.every((player, index) => {
    const candidate = next[index];
    if (candidate === undefined) return false;
    const { score: _currentScore, ...currentConfig } = player;
    const { score: _nextScore, ...nextConfig } = candidate;
    return JSON.stringify(currentConfig) === JSON.stringify(nextConfig);
  });
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
  const timeline = useMemo(() => new MultiviewTimeline(), []);
  const parentOriginRef = useRef<string | null>(null);
  const playbackRef = useRef(new Map<string, MultiviewPlaybackSnapshot>());
  const correctionStateRef = useRef(new Map<string, MultiviewCorrectionState>());
  const scoreTimelinesRef = useRef(new Map<string, EmbeddedRealtimeScoreTimeline>());
  const lastStatePublishRef = useRef(Number.NEGATIVE_INFINITY);
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
      for (const player of next) {
        let scoreTimeline = scoreTimelinesRef.current.get(player.id);
        if (scoreTimeline === undefined) {
          scoreTimeline = new EmbeddedRealtimeScoreTimeline();
          scoreTimelinesRef.current.set(player.id, scoreTimeline);
        }
        if (isRecord(player.score)) scoreTimeline.add(player.score);
      }
      // Scores update continuously. Keep them in the timeline without turning
      // every packet into a React rerender of every POV.
      setPlayers((current) => (samePlayerConfiguration(current, next) ? current : next));
    }
    if (nativeBridge !== undefined) {
      const removeListener = nativeBridge.onMessage(applyConfig);
      nativeBridge.send({ type: 'beatkhana:multiview-ready', version: 1 });
      return removeListener;
    }
    function receive(event: MessageEvent) {
      if (event.source !== window.parent || !trustedParentOrigin(event.origin)) return;
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
    const visiblePlayers = players.filter((player) => player.visible);
    timeline.configure(visiblePlayers);
    for (const player of players) {
      host.setTile(player.id, {
        x: player.x,
        y: player.y,
        width: player.width,
        height: player.height,
        visible: player.visible,
      });
    }
    host.retainTiles(activeIds);
    for (const id of playbackRef.current.keys()) {
      if (!activeIds.has(id)) playbackRef.current.delete(id);
    }
    for (const id of correctionStateRef.current.keys()) {
      if (!activeIds.has(id)) correctionStateRef.current.delete(id);
    }
    setTilePlayback((current) => {
      if ([...current.keys()].every((id) => activeIds.has(id))) return current;
      return new Map([...current].filter(([id]) => activeIds.has(id)));
    });
    for (const id of scoreTimelinesRef.current.keys()) {
      if (!activeIds.has(id)) scoreTimelinesRef.current.delete(id);
    }
  }, [host, players, timeline]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const snapshots = players
        .map((player) => ({ player, playback: playbackRef.current.get(player.id) }))
        .filter(
          (entry): entry is { player: MultiviewPlayerConfig; playback: MultiviewPlaybackSnapshot } =>
            entry.playback !== undefined && entry.playback.duration > 0,
        );
      const now = performance.now();
      const primarySample = timeline.primary(now);
      if (primarySample === null) return;
      const primary = snapshots.find((entry) => entry.player.id === primarySample.id);
      if (primary === undefined) return;
      for (const entry of snapshots) {
        if (entry.player.id === primary.player.id) {
          correctionStateRef.current.delete(entry.player.id);
          continue;
        }
        const sameMap =
          entry.playback.mapHash !== null && primary.playback.mapHash !== null
            ? entry.playback.mapHash === primary.playback.mapHash
            : entry.playback.map?.title === primary.playback.map?.title;
        const ownSample = timeline.ownSample(entry.player.id, now);
        const syncReady = entry.playback.status === 'watching' && entry.playback.playing;
        const aheadBy = ownSample === null ? 0 : ownSample.time - primarySample.time;
        if (!sameMap || !syncReady) {
          correctionStateRef.current.delete(entry.player.id);
          continue;
        }
        const correction = advanceMultiviewCorrection(
          correctionStateRef.current.get(entry.player.id),
          aheadBy,
          now,
        );
        correctionStateRef.current.set(entry.player.id, correction.state);
        if (correction.correct) {
          entry.playback.seek(primarySample.time);
        }
      }
      // Parent overlay state drives a large Svelte scene tree. Five updates per
      // second are enough for score/progress consumers while keeping that work
      // away from the WebGL frame loop. Drift observation remains at 10 Hz.
      if (now - lastStatePublishRef.current < 200) return;
      lastStatePublishRef.current = now;
      const message: MultiviewStateMessage = {
        type: 'beatkhana:multiview-state',
        version: 1,
        time: primarySample.time,
        beat: primarySample.beat,
        duration: primarySample.duration,
        playing: primarySample.playing,
        mapHash: primarySample.mapHash,
        map: primary.playback.map,
        players: players.map((player) => ({
          id: player.id,
          playerId: player.playerId,
          platformIds: player.platformIds,
          score: scoreTimelinesRef.current.get(player.id)?.at(primarySample.time)?.score ?? player.score,
          status: playbackRef.current.get(player.id)?.status ?? 'waiting',
          time: timeline.sampleFor(player.id, now)?.time ?? 0,
        })),
      };
      if (nativeBridge !== undefined) nativeBridge.send(message);
      else {
        const origin = parentOriginRef.current;
        if (origin !== null) window.parent.postMessage(message, origin);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [nativeBridge, players, timeline]);

  const handlePlayback = useCallback((id: string, snapshot: MultiviewPlaybackSnapshot) => {
    playbackRef.current.set(id, snapshot);
    timeline.update(id, {
      beat: snapshot.beat,
      bpm: snapshot.bpm,
      duration: snapshot.duration,
      mapHash: snapshot.mapHash,
      mapTitle: snapshot.map?.title ?? null,
      playbackRate: snapshot.playbackRate,
      playing: snapshot.playing,
      syncReady: snapshot.status === 'watching',
      time: snapshot.time,
    });
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
  }, [timeline]);

  const runtimePlayers = useMemo(() => {
    const visible = players.filter((player) => player.visible);
    const audioOwner = multiviewAudioOwner(visible);
    return visible.map((player) => ({
      ...player,
      masterVolume: player.id === audioOwner ? player.masterVolume : 0,
    }));
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
              timeline,
              settings: player.settings,
              parser,
              onPlayback: (snapshot) => handlePlayback(player.id, snapshot),
            }}
          />
        ))}
    </main>
  );
}
