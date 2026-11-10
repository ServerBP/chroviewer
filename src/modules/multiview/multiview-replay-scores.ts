import type { ReplayScoreState } from '../../core/replay/scoring';
import type { Replay } from '../../core/replay/types';

/** Rates the parent may request, in updates per second. */
export const multiviewScoreRates = [2, 5, 10, 30, 60] as const;

export function multiviewScoreRate(value: unknown) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(60, Math.max(1, Math.round(rate)));
}

/** Counts a stream joined mid-song did not see: the parent's realtime score at the replay's first frame. */
export interface MultiviewScoreHistory {
  replay: Replay;
  misses: number;
  badCuts: number;
  bombHits: number;
  wallHits: number;
  maxCombo: number;
}

function count(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function multiviewScoreHistory(replay: Replay, before: Record<string, unknown> | null): MultiviewScoreHistory {
  return {
    replay,
    misses: count(before?.notesMissed),
    badCuts: count(before?.badCuts),
    bombHits: count(before?.bombHits),
    wallHits: count(before?.wallHits),
    maxCombo: count(before?.maxCombo),
  };
}

/**
 * The replay's score in the field names of TournamentAssistant realtime scores. TournamentAssistant streams the
 * score with modifiers applied, so only the modified score fields are reported; the parent derives the raw score.
 */
export function multiviewReplayScore(state: ReplayScoreState, time: number, history: MultiviewScoreHistory | null) {
  return {
    scoreWithModifiers: state.score,
    maxScoreWithModifiers: state.maximumScore,
    accuracy: state.accuracy,
    combo: state.combo,
    maxCombo: Math.max(state.maxCombo, history?.maxCombo ?? 0),
    notesMissed: state.misses + (history?.misses ?? 0),
    badCuts: state.badCuts + (history?.badCuts ?? 0),
    bombHits: state.bombCuts + (history?.bombHits ?? 0),
    wallHits: state.wallsHit + (history?.wallHits ?? 0),
    playerHealth: state.energy,
    songPosition: time,
  };
}
