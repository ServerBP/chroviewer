import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BeatmapParser } from '../../core/beatmap/worker/client';
import { MultiviewRendererHost } from '../../renderer/multiview-renderer-host';
import { broadcastSettingsForPlayerCount } from '../../renderer/render-performance';
import { LiveMapCache } from '../live/live-map-cache';
import { trustedParentOrigin } from '../multiview/multiview-shell';
import { MultiviewStartBarrier } from '../multiview/multiview-start-barrier';
import { MultiviewTimeline } from '../multiview/multiview-timeline';
import { ViewerShell, type MultiviewPlaybackSnapshot } from '../viewer/viewer-shell';
import { layoutReplayTiles } from './replay-compositor-layout';
import type {
  ReplayCompositorConfigMessage,
  ReplayCompositorPlayer,
  ReplayCompositorStateMessage,
  ReplayCompositorTileStatus,
} from './replay-compositor-protocol';
import { planTileSync, transportTimeAt, type CompositorTransport } from './replay-compositor-sync';

const MAX_PLAYERS = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPlayer(value: unknown): value is ReplayCompositorPlayer {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.tarfPath === 'string' &&
    value.tarfPath.length > 0 &&
    Number.isInteger(value.side) &&
    typeof value.name === 'string' &&
    (value.avatarUrl === undefined || typeof value.avatarUrl === 'string') &&
    (value.color === undefined || typeof value.color === 'string') &&
    (value.offsetSeconds === undefined || Number.isFinite(value.offsetSeconds)) &&
    (value.settings === undefined || isRecord(value.settings))
  );
}

function validConfig(value: unknown): value is ReplayCompositorConfigMessage {
  return (
    isRecord(value) &&
    value.type === 'beatkhana:replay-compositor-config' &&
    value.version === 1 &&
    Array.isArray(value.players) &&
    value.players.length <= MAX_PLAYERS &&
    value.players.every(validPlayer) &&
    new Set(value.players.map((player) => player.id)).size === value.players.length
  );
}

function tileStatus(snapshot: MultiviewPlaybackSnapshot | undefined): ReplayCompositorTileStatus {
  if (snapshot === undefined) return 'loading';
  if (snapshot.error) return 'error';
  if (snapshot.map === null || snapshot.duration <= 0) return 'loading';
  return snapshot.playing ? 'playing' : 'ready';
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

/**
 * Plays the TARF replays of one map side by side in a single renderer, driven by the parent page's
 * clock like a video: the parent sends the players and its transport (play, pause, seek, rate) and
 * every tile follows it. Each side of the match gets its half of the view.
 */
export function ReplayCompositorShell() {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [host, setHost] = useState<MultiviewRendererHost | null>(null);
  const [parser, setParser] = useState<BeatmapParser | null>(null);
  const [config, setConfig] = useState<ReplayCompositorConfigMessage | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [statuses, setStatuses] = useState<Map<string, { status: ReplayCompositorTileStatus; error: string }>>(
    () => new Map(),
  );
  const mapCache = useMemo(() => new LiveMapCache(), []);
  const timeline = useMemo(() => new MultiviewTimeline(), []);
  const startBarrier = useMemo(() => new MultiviewStartBarrier(), []);
  useEffect(() => () => startBarrier.dispose(), [startBarrier]);
  const transportRef = useRef<CompositorTransport>({ playing: false, time: 0, rate: 1, at: 0 });
  const playbackRef = useRef(new Map<string, MultiviewPlaybackSnapshot>());
  const parentOriginRef = useRef<string | null>(null);
  const lastPublishRef = useRef(Number.NEGATIVE_INFINITY);

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
    const root = rootRef.current;
    if (root === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setSize((current) =>
        current.width === Math.round(width) && current.height === Math.round(height)
          ? current
          : { width: Math.round(width), height: Math.round(height) },
      );
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== window.parent || !trustedParentOrigin(event.origin)) return;
      parentOriginRef.current = event.origin;
      const data: unknown = event.data;
      if (validConfig(data)) {
        setConfig((current) => (current !== null && JSON.stringify(current) === JSON.stringify(data) ? current : data));
        return;
      }
      if (
        isRecord(data) &&
        data.type === 'beatkhana:replay-compositor-transport' &&
        data.version === 1 &&
        typeof data.playing === 'boolean' &&
        Number.isFinite(data.time) &&
        Number.isFinite(data.rate) &&
        Number(data.rate) > 0
      ) {
        transportRef.current = {
          playing: data.playing,
          time: Number(data.time),
          rate: Number(data.rate),
          at: performance.now(),
        };
      }
    }
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'beatkhana:replay-compositor-ready', version: 1 }, '*');
    return () => window.removeEventListener('message', receive);
  }, []);

  const players = useMemo(() => config?.players ?? [], [config]);
  const tiles = useMemo(
    () => layoutReplayTiles(players, size.width, size.height, { layout: config?.layout, focus: config?.focus }),
    [players, size.width, size.height, config?.layout, config?.focus],
  );
  const visiblePlayers = players.filter((player) => tiles.has(player.id));

  useEffect(() => {
    if (host === null) return;
    for (const player of players) {
      const tile = tiles.get(player.id);
      host.setTile(
        player.id,
        tile === undefined ? { x: 0, y: 0, width: 1, height: 1, visible: false } : { ...tile, visible: true },
      );
    }
    host.retainTiles(players.map((player) => player.id));
    for (const id of playbackRef.current.keys()) {
      if (!players.some((player) => player.id === id)) playbackRef.current.delete(id);
    }
  }, [host, players, tiles]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      const transport = transportRef.current;
      const time = transportTimeAt(transport, now);
      for (const player of players) {
        const snapshot = playbackRef.current.get(player.id);
        if (snapshot === undefined) continue;
        const action = planTileSync(
          {
            ready: tileStatus(snapshot) === 'ready' || tileStatus(snapshot) === 'playing',
            time: snapshot.time,
            duration: snapshot.duration,
            playing: snapshot.playing,
            playbackRate: snapshot.playbackRate,
          },
          time + (player.offsetSeconds ?? 0),
          transport,
        );
        if (action.rate !== undefined) snapshot.setPlaybackRate(action.rate);
        if (action.seek !== undefined) snapshot.seek(action.seek);
        if (action.correct !== undefined) snapshot.correctDrift(action.correct);
        if (action.pause) snapshot.pause();
        if (action.play) snapshot.play();
      }
      if (now - lastPublishRef.current < 200) return;
      lastPublishRef.current = now;
      const origin = parentOriginRef.current;
      if (origin === null) return;
      const states = players.map((player) => {
        const snapshot = playbackRef.current.get(player.id);
        return {
          id: player.id,
          status: tileStatus(snapshot),
          error: snapshot?.error ?? '',
          time: snapshot?.time ?? 0,
          duration: snapshot?.duration ?? 0,
        };
      });
      const message: ReplayCompositorStateMessage = {
        type: 'beatkhana:replay-compositor-state',
        version: 1,
        ready: states.every((state) => state.status !== 'loading'),
        time,
        duration: Math.max(0, ...states.map((state) => state.duration)),
        players: states,
      };
      window.parent.postMessage(message, origin);
    }, 100);
    return () => window.clearInterval(timer);
  }, [players]);

  const handlePlayback = useCallback(
    (id: string, snapshot: MultiviewPlaybackSnapshot) => {
      playbackRef.current.set(id, snapshot);
      timeline.update(id, {
        beat: snapshot.beat,
        bpm: snapshot.bpm,
        duration: snapshot.duration,
        mapHash: snapshot.mapHash,
        mapTitle: snapshot.map?.title ?? null,
        playbackRate: snapshot.playbackRate,
        playing: snapshot.playing,
        syncReady: true,
        time: snapshot.time,
      });
      const next = { status: tileStatus(snapshot), error: snapshot.error };
      setStatuses((current) => {
        const previous = current.get(id);
        if (previous?.status === next.status && previous.error === next.error) return current;
        return new Map(current).set(id, next);
      });
    },
    [timeline],
  );

  const audioId = config?.audio ?? config?.focus ?? visiblePlayers[0]?.id ?? null;
  const defaults = broadcastSettingsForPlayerCount(visiblePlayers.length);
  const showNames = config?.showNames ?? true;

  return (
    <main ref={rootRef} data-replay-compositor-root className="relative size-full overflow-hidden bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 z-10 size-full" />
      {visiblePlayers.map((player) => {
        const tile = tiles.get(player.id)!;
        const state = statuses.get(player.id);
        const waiting = state === undefined || state.status === 'loading' || state.status === 'error';
        return (
          <div
            key={`${player.id}:overlay`}
            className="pointer-events-none absolute z-20"
            style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height }}
          >
            {waiting && (
              <div className="absolute inset-0 grid place-items-center bg-black px-4 text-center text-sm text-white/70">
                <span className="flex items-center gap-2">
                  {state?.status !== 'error' && (
                    <i className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
                  )}
                  {state?.status === 'error' ? state.error || 'This replay could not be loaded' : 'Loading replay'}
                </span>
              </div>
            )}
            {showNames && (
              <div
                className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-md border border-white/10 bg-black/65 py-1 pr-2.5 pl-1 text-[13px] font-semibold text-white"
                style={{ borderLeft: `3px solid ${player.color ?? 'rgba(255,255,255,.4)'}` }}
              >
                {player.avatarUrl ? (
                  <img
                    src={player.avatarUrl}
                    alt=""
                    className="size-6 shrink-0 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-[10px]">
                    {initials(player.name)}
                  </span>
                )}
                <span className="truncate">{player.name}</span>
              </div>
            )}
          </div>
        );
      })}
      {host !== null &&
        parser !== null &&
        visiblePlayers.map((player) => (
          <ViewerShell
            key={`${player.id}:${player.tarfPath}`}
            multiview={{
              id: player.id,
              playerId: '0',
              tarfPath: player.tarfPath,
              host,
              mapCache,
              masterVolume: player.id === audioId ? Math.min(1, Math.max(0, config?.volume ?? 1)) : 0,
              hitsoundVolume: Math.min(1, Math.max(0, config?.hitsoundVolume ?? 1)),
              disableGameUI: config?.disableGameUI ?? false,
              hidePlatform: false,
              lights: 'static',
              timeline,
              startBarrier,
              settings: { ...defaults, ...player.settings },
              parser,
              onPlayback: (snapshot) => handlePlayback(player.id, snapshot),
            }}
          />
        ))}
    </main>
  );
}
