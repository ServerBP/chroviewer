import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Rgb } from '../../core/colors';
import type { AnticheatAttachment, AnticheatCut, AnticheatFinding, AnticheatMark } from '../../core/replay/anticheat';
import { HUMAN_SCALE_NEEDED } from '../../core/replay/note-hitbox';
import type { Replay, ReplayNoteEvent } from '../../core/replay/types';
import type { CutCheck, MapView } from '../../renderer/map-view';
import type { Inspection } from '../../renderer/replay/anticheat-inspector';
import {
  activeFindings,
  figuresOf,
  findingMarkers,
  findingsOf,
  ghostsOf,
  marksInOrder,
  sceneMarks,
  toleranceOf,
  type PlacedMark,
} from './anticheat-marks';
import type { AnticheatViewState, CutCheckState } from './anticheat-panel';

interface Transport {
  time: number;
  playing: boolean;
  playbackRate: number;
  seek: (time: number) => void;
  pause: () => void;
  play: () => void;
  setPlaybackRate: (rate: number) => void;
}

interface ReviewOptions {
  replay: Replay | null;
  view: () => MapView | undefined;
  transport: Transport;
  songBpm: number;
  /** Changes whenever the scene was rebuilt, so the scene gets the marks again */
  sceneKey: unknown;
  ready: boolean;
  /** Song time of a place to focus once the file is loaded (the link's acMark) */
  initialMark?: number;
}

const SABER_COLORS: [Rgb, Rgb] = [
  [1, 0.35, 0.35],
  [0.35, 0.65, 1],
];
const CHECKED_KEY = 'checkedCuts';

function cutOf(event: ReplayNoteEvent): AnticheatCut {
  return {
    saber: event.saberType,
    speed: event.saberSpeed,
    saberDirection: [event.saberDirection.x, event.saberDirection.y, event.saberDirection.z],
    cutPoint: [event.cutPoint.x, event.cutPoint.y, event.cutPoint.z],
    cutNormal: [event.cutNormal.x, event.cutNormal.y, event.cutNormal.z],
    distance: event.cutDistanceToCenter,
    deviation: event.cutDirectionDeviation,
    timeDeviation: event.timeDeviation ?? 0,
    beforeRating: event.beforeCutRating,
    afterRating: event.afterCutRating,
    speedOk: true,
    directionOk: event.directionOk,
    saberTypeOk: true,
    recorded: Math.hypot(event.saberDirection.x, event.saberDirection.y, event.saberDirection.z) > 0.5,
  };
}

/** The every-cut check's misses as a finding of its own, so they can be stepped through like the file's */
function checkedFinding(results: CutCheck[], replay: Replay): AnticheatFinding | null {
  const missed = results
    .filter((result) => result.scaleNeeded > HUMAN_SCALE_NEEDED)
    .sort((left, right) => right.scaleNeeded - left.scaleNeeded);
  if (missed.length === 0) return null;
  const events = new Map(replay.notes.map((event) => [event.time, event]));
  const marks: AnticheatMark[] = missed.slice(0, 400).flatMap((result) => {
    const event = events.get(result.time);
    if (event === undefined) return [];
    return [
      {
        kind: 'note',
        time: result.time,
        end: result.time,
        hand: event.saberType === 0 ? 0 : 1,
        note: {
          time: event.noteId.time,
          line: event.noteId.lineIndex,
          layer: event.noteId.lineLayer,
          color: event.noteId.colorType,
          direction: event.noteId.cutDirection,
        },
        value: result.scaleNeeded,
        expected: 1,
        label: Number.isFinite(result.scaleNeeded)
          ? `the box would need ${result.scaleNeeded.toFixed(2)}× its size`
          : 'blade nowhere near the box',
        cut: cutOf(event),
      },
    ];
  });
  return {
    id: CHECKED_KEY,
    severity: 'notice',
    category: 'viewer',
    title: 'Blade far from the box',
    detail:
      'Good cuts whose blade, swept from the frame before the cut, stayed further from the note’s good-cut box than any person’s good cut in this check (people need the box up to about 4 times its size in this check, because frames and tracking aren’t exact).',
    marks,
    series: null,
    markTotal: missed.length,
  };
}

/** Everything the anticheat panel and the scene need to review a BeatKhana anticheat file */
export function useAnticheatReview({ replay, view, transport, songBpm, sceneKey, ready, initialMark }: ReviewOptions) {
  const base = replay?.anticheat ?? null;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState<PlacedMark | null>(null);
  const [hiddenPlayers, setHiddenPlayers] = useState<ReadonlySet<number>>(new Set());
  const [matchedNotes, setMatchedNotes] = useState(0);
  const [viewState, setViewState] = useState<AnticheatViewState>({
    hitboxes: 'marked',
    figures: false,
    camera: 'close',
  });
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [cutCheck, setCutCheck] = useState<CutCheckState>({ running: false, done: 0, total: 0, results: null });
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    setOpen(base !== null);
    setSelected(null);
    setFocused(null);
    setHiddenPlayers(new Set());
    setViewState({ hitboxes: 'marked', figures: false, camera: 'close' });
    setCutCheck({ running: false, done: 0, total: 0, results: null });
  }, [base]);

  // The file's findings, plus the viewer's own check once it ran
  const anticheat: AnticheatAttachment | null = useMemo(() => {
    if (base === null || replay === null || cutCheck.results === null) return base;
    const extra = checkedFinding(cutCheck.results, replay);
    if (extra === null) return base;
    if (base.kind === 'report')
      return { ...base, report: { ...base.report, findings: [...base.report.findings, extra] } };
    const [first, ...rest] = base.comparison.players;
    if (first === undefined) return base;
    return {
      ...base,
      comparison: { ...base.comparison, players: [{ ...first, findings: [...first.findings, extra] }, ...rest] },
    };
  }, [base, cutCheck.results, replay]);

  const findings = useMemo(() => (anticheat === null ? [] : findingsOf(anticheat)), [anticheat]);
  const active = useMemo(() => activeFindings(findings, selected), [findings, selected]);
  const ordered = useMemo(() => marksInOrder(active), [active]);
  const scene = useMemo(() => sceneMarks(active, focused), [active, focused]);
  const ghosts = useMemo(() => (anticheat === null ? [] : ghostsOf(anticheat)), [anticheat]);
  const tolerance = anticheat === null ? null : toleranceOf(anticheat, replay);

  useEffect(() => {
    const current = view();
    if (current === undefined || !ready) return;
    current.setAnticheatMarks(scene.highlights, scene.paths);
    current.setAnticheatGhosts(ghosts);
    for (let index = 0; index < ghosts.length; index++)
      current.setAnticheatGhostVisible(index, !hiddenPlayers.has(index + 1));
    setMatchedNotes(current.matchedAnticheatNotes);
  }, [scene, ghosts, hiddenPlayers, ready, sceneKey, view, replay]);

  useEffect(() => {
    const current = view();
    if (current === undefined || !ready) return;
    current.setHitboxMode(anticheat === null ? 'off' : viewState.hitboxes);
    current.setAnticheatFigures(
      viewState.figures && anticheat !== null,
      anticheat === null ? [] : figuresOf(anticheat, replay),
    );
    for (let index = 0; index < ghosts.length; index++)
      current.setAnticheatGhostVisible(index, !hiddenPlayers.has(index + 1));
  }, [viewState, anticheat, replay, ready, sceneKey, view, ghosts, hiddenPlayers]);

  useEffect(() => {
    const current = view();
    if (current === undefined || !ready) return;
    current.setAnticheatFocus(
      focused === null ? null : { mark: focused.mark, tolerance, color: SABER_COLORS[focused.mark.hand === 0 ? 0 : 1] },
    );
    setInspection(null);
  }, [focused, tolerance, ready, sceneKey, view]);

  useEffect(() => {
    const current = view();
    if (current === undefined || !ready) return;
    current.setAnticheatInspectView(focused === null ? 'player' : viewState.camera);
  }, [focused, viewState.camera, ready, sceneKey, view]);

  // What the scene measured about the focused cut appears once the note has been drawn at the cut
  useEffect(() => {
    if (focused === null) return;
    const timer = window.setInterval(() => {
      const next = view()?.anticheatInspection ?? null;
      setInspection((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next === null ? null : { ...next },
      );
    }, 200);
    return () => {
      window.clearInterval(timer);
    };
  }, [focused, view]);

  const { time, seek, pause, play, setPlaybackRate, playing } = transport;
  useEffect(() => {
    if (stopAt.current !== null && time >= stopAt.current) {
      stopAt.current = null;
      pause();
    }
  }, [time, pause]);

  const focus = useCallback(
    (mark: PlacedMark | null) => {
      setFocused(mark);
      if (mark === null) return;
      stopAt.current = null;
      pause();
      seek(mark.mark.time);
    },
    [pause, seek],
  );

  const position =
    focused === null
      ? 0
      : ordered.findIndex((entry) => entry.finding === focused.finding && entry.index === focused.index) + 1;

  const step = useCallback(
    (delta: -1 | 1) => {
      if (ordered.length === 0) return;
      let index =
        focused === null
          ? -1
          : ordered.findIndex((entry) => entry.finding === focused.finding && entry.index === focused.index);
      if (index < 0) {
        // From the playhead: the next or previous mark in time
        index =
          delta > 0
            ? ordered.findIndex((entry) => entry.mark.time > time + 1e-3)
            : ordered.findLastIndex((entry) => entry.mark.time < time - 1e-3);
        if (index < 0) index = delta > 0 ? 0 : ordered.length - 1;
      } else {
        index = (index + delta + ordered.length) % ordered.length;
      }
      const next = ordered[index];
      if (next !== undefined) focus(next);
    },
    [ordered, focused, focus, time],
  );

  const frame = useCallback(
    (delta: -1 | 1) => {
      const poses = replay?.poses ?? [];
      if (poses.length === 0) return;
      let low = 0;
      let high = poses.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if ((poses[middle]?.time ?? 0) < time - 1e-5) low = middle + 1;
        else high = middle;
      }
      const at = Math.abs((poses[low]?.time ?? 0) - time) < 1e-4 ? low : delta > 0 ? low - 1 : low;
      const target = poses[Math.max(0, Math.min(poses.length - 1, at + delta))];
      stopAt.current = null;
      pause();
      if (target !== undefined) seek(target.time);
    },
    [replay, time, pause, seek],
  );

  const replayCut = useCallback(() => {
    const mark = focused?.mark;
    if (mark === undefined) return;
    seek(Math.max(0, mark.time - 1.2));
    setPlaybackRate(0.25);
    stopAt.current = mark.time + 0.4;
    play();
  }, [focused, seek, setPlaybackRate, play]);

  const checkCuts = useCallback(async () => {
    const current = view();
    if (current === undefined) return;
    const wasPlaying = playing;
    pause();
    const resume = time;
    setCutCheck({ running: true, done: 0, total: 0, results: null });
    const results = await current.checkEveryCut((done, total) => {
      setCutCheck((state) => ({ ...state, done, total }));
    });
    seek(resume);
    if (wasPlaying) play();
    setCutCheck({ running: false, done: results.length, total: results.length, results });
    if (import.meta.env.DEV) (window as unknown as { anticheatCutCheck?: CutCheck[] }).anticheatCutCheck = results;
  }, [view, playing, pause, time, seek, play]);

  useEffect(() => {
    if (anticheat === null) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)))
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '[') step(-1);
      else if (event.key === ']') step(1);
      else if (event.key === ',') frame(-1);
      else if (event.key === '.') frame(1);
      else if (event.key === 'r' || event.key === 'R') replayCut();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [anticheat, step, frame, replayCut]);

  // A link can name a place: focus the mark nearest that song time once the scene is ready, once per file
  const linkedFor = useRef<unknown>(null);
  useEffect(() => {
    if (initialMark === undefined || !ready || base === null || linkedFor.current === base) return;
    const all = marksInOrder(findings);
    let best: PlacedMark | null = null;
    for (const entry of all)
      if (best === null || Math.abs(entry.mark.time - initialMark) < Math.abs(best.mark.time - initialMark))
        best = entry;
    linkedFor.current = base;
    if (best === null || Math.abs(best.mark.time - initialMark) > 0.05) return;
    setSelected(best.finding);
    focus(best);
  }, [initialMark, ready, base, findings, focus]);

  const markers = useMemo(() => findingMarkers(active, songBpm), [active, songBpm]);

  return {
    anticheat,
    open,
    setOpen,
    markers,
    panel:
      anticheat === null
        ? null
        : {
            attachment: anticheat,
            selected,
            focused,
            focusedPosition: position,
            markCount: ordered.length,
            tolerance,
            inspection,
            hiddenPlayers,
            matchedNotes,
            noteMarks: new Set(scene.highlights.map((highlight) => JSON.stringify([highlight.note, highlight.time])))
              .size,
            view: viewState,
            cutCheck,
            onSelect: (key: string | null) => {
              setSelected(key);
              if (key !== null && focused !== null && focused.finding !== key) setFocused(null);
            },
            onFocus: focus,
            onStep: step,
            onFrame: frame,
            onReplayCut: replayCut,
            onTogglePlayer: (index: number, visible: boolean) => {
              setHiddenPlayers((current) => {
                const next = new Set(current);
                if (visible) next.delete(index);
                else next.add(index);
                return next;
              });
            },
            onView: (next: Partial<AnticheatViewState>) => {
              setViewState((current) => ({ ...current, ...next }));
            },
            onCheckCuts: () => {
              void checkCuts();
            },
          },
  };
}
