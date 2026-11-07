import {
  decodeHitScoreVisualizer,
  hitScoreDisplay,
  type HitScoreDisplay,
  type HitScoreVisualizerConfig,
} from './hit-score-visualizer';
import { parseHitScoreVisualizerProfile } from './hit-score-visualizer-profile';
import { buildReplayScoreTimeline, replayEventIndexAfter, type ReplayScoreTimeline } from './scoring';
import type { Replay } from './types';

export interface ReplayTimeline extends ReplayScoreTimeline {
  hitScoreVisualizer: HitScoreVisualizerConfig | null;
}

export interface FlyingScore {
  id: number;
  age: number;
  kind: 'score' | 'bad-cut' | 'miss';
  lane: number;
  display: HitScoreDisplay;
  opacity: number;
  showCenterIndicator: boolean;
}

interface HitScoreVisualizerSettings {
  overrideHsvProfile: boolean;
  preferReplayHsvProfile: boolean;
  hsvProfile: string;
}

export function hitScoreVisualizerForSettings(settings: HitScoreVisualizerSettings, replay: Replay | null) {
  const replayConfig = decodeHitScoreVisualizer(replay?.hsvConfig);
  if (settings.preferReplayHsvProfile && replayConfig !== null) return replayConfig;
  if (settings.preferReplayHsvProfile && replay?.hsvProfile !== undefined) {
    // TA Standalone sends the Quest player's selected profile file as-is.
    // TARF replays say which platform their profile was written for.
    const profile = parseHitScoreVisualizerProfile(replay.hsvProfile, replay.hsvProfilePlatform ?? 'quest');
    if (profile.isOk()) return profile.value;
  }
  if (settings.overrideHsvProfile) {
    const profile = parseHitScoreVisualizerProfile(settings.hsvProfile);
    if (profile.isOk()) return profile.value;
  }
  return replayConfig;
}

export function buildReplayTimeline(
  replay: Replay,
  hitScoreVisualizer = hitScoreVisualizerForSettings(
    { overrideHsvProfile: false, preferReplayHsvProfile: true, hsvProfile: '' },
    replay,
  ),
): ReplayTimeline {
  return {
    ...buildReplayScoreTimeline(replay),
    hitScoreVisualizer,
  };
}

// A note's display never changes for a given timeline (a new HSV config builds a new one),
// so each is formatted once rather than on every frame for every visible score.
const displayCache = new WeakMap<ReplayTimeline, Map<number, HitScoreDisplay>>();

function cachedDisplay(timeline: ReplayTimeline, index: number) {
  let cache = displayCache.get(timeline);
  if (cache === undefined) {
    cache = new Map();
    displayCache.set(timeline, cache);
  }
  let display = cache.get(index);
  if (display === undefined) {
    const event = timeline.events[index];
    if (event?.note === undefined) return undefined;
    display = hitScoreDisplay(timeline.hitScoreVisualizer, event.note, event.cutScore, event.id);
    cache.set(index, display);
  }
  return display;
}

export function flyingScoresAt(timeline: ReplayTimeline, time: number, duration = 0.7) {
  const end = replayEventIndexAfter(timeline, time);
  const start = replayEventIndexAfter(timeline, time - duration);
  const scores: FlyingScore[] = [];
  for (let index = start; index < end; index++) {
    const event = timeline.events[index];
    if (event?.kind !== 'note' || event.note === undefined || event.note.eventType === 0) continue;
    const display = cachedDisplay(timeline, index);
    if (display === undefined || !display.visible) continue;
    scores.push({
      id: event.id,
      age: Math.max(0, Math.min(1, (time - event.time) / duration)),
      kind: event.cutScore !== undefined ? 'score' : event.note.eventType === 3 ? 'miss' : 'bad-cut',
      lane: event.note.noteId.lineIndex,
      display,
      opacity:
        display.vanilla && event.cutScore !== undefined && event.cutScore.total <= event.cutScore.maximum * 0.9
          ? 0.3
          : 1,
      showCenterIndicator:
        display.vanilla &&
        event.cutScore !== undefined &&
        (timeline.replay.metadata.version === 'ScoreSaberLegacy'
          ? event.cutScore.total === event.cutScore.maximum
          : event.cutScore.accuracy === 15),
    });
  }
  // With a fixed position HSV hides the previous score when a new one appears.
  if (timeline.hitScoreVisualizer?.fixedPosition !== undefined) {
    const latest = scores.findLast((score) => score.kind === 'score');
    return scores.filter((score) => score.kind !== 'score' || score === latest);
  }
  return scores;
}
