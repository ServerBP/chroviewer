import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MultiviewRendererHost } from '../../renderer/multiview-renderer-host';
import { EmbeddedRealtimeScoreTimeline } from '../live/embedded-realtime-score-sync';
import { ViewerShell, type MultiviewPlaybackSnapshot } from '../viewer/viewer-shell';
import type { MultiviewConfigMessage, MultiviewPlayerConfig, MultiviewStateMessage } from './multiview-protocol';

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
    isRecord(value.settings)
  );
}

export function MultiviewShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [host, setHost] = useState<MultiviewRendererHost | null>(null);
  const [players, setPlayers] = useState<MultiviewPlayerConfig[]>([]);
  const parentOriginRef = useRef<string | null>(null);
  const playbackRef = useRef(new Map<string, MultiviewPlaybackSnapshot>());
  const lastCorrectionRef = useRef(new Map<string, number>());
  const scoreTimelinesRef = useRef(new Map<string, EmbeddedRealtimeScoreTimeline>());

  useEffect(() => {
    const previousHtmlBackground = document.documentElement.style.background;
    const previousBodyBackground = document.body.style.background;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = previousHtmlBackground;
      document.body.style.background = previousBodyBackground;
    };
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
    function receive(event: MessageEvent) {
      if (event.source !== window.parent || !sameBaseSite(event.origin) || !isRecord(event.data)) return;
      if (event.data.type !== 'beatkhana:multiview-config' || event.data.version !== 1) return;
      const next = (event.data as unknown as MultiviewConfigMessage).players;
      if (!Array.isArray(next) || next.length > 12 || !next.every(validPlayer)) return;
      parentOriginRef.current = event.origin;
      setPlayers(next);
    }
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'beatkhana:multiview-ready', version: 1 }, '*');
    return () => window.removeEventListener('message', receive);
  }, []);

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
      const origin = parentOriginRef.current;
      if (origin === null) return;
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
      window.parent.postMessage(message, origin);
    }, 50);
    return () => window.clearInterval(timer);
  }, [players]);

  const handlePlayback = useCallback((id: string, snapshot: MultiviewPlaybackSnapshot) => {
    playbackRef.current.set(id, snapshot);
  }, []);

  const runtimePlayers = useMemo(() => {
    let audioClaimed = false;
    return players.map((player) => {
      const audible = !audioClaimed && player.masterVolume > 0;
      if (audible) audioClaimed = true;
      return { ...player, masterVolume: audible ? player.masterVolume : 0 };
    });
  }, [players]);

  return (
    <main className="relative size-full overflow-hidden bg-transparent">
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      {host !== null &&
        runtimePlayers.map((player) => (
          <ViewerShell
            key={player.id}
            multiview={{
              id: player.id,
              playerId: player.playerId,
              host,
              masterVolume: player.masterVolume,
              hitsoundVolume: player.hitsoundVolume,
              disableGameUI: player.disableGameUI,
              lights: player.lights,
              settings: player.settings,
              onPlayback: (snapshot) => handlePlayback(player.id, snapshot),
            }}
          />
        ))}
    </main>
  );
}
