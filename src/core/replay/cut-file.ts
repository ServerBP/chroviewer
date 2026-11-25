import type { AnticheatAttachment, AnticheatCut } from './anticheat';
import type { Replay, ReplayNoteEvent } from './types';

// A .bkacf (BeatKhana anticheat flag file) is one cut BeatKhana's live anticheat flagged: a TARF replay of the second
// around it, holding only that note's event, with a map that holds only that note. It opens as a review of that cut: the
// note focused with its box, the swing into and out of it looping.

export interface CutReview {
  /** Song seconds of the cut */
  time: number;
  /** The clip's first and last frame */
  start: number;
  end: number;
}

export const isCutFileName = (name: string) => /\.bkacf$/i.test(name);

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

/**
 * Makes a replay from a `.bkacf` a review of its cut: marks the clip as a loop and, unless it came with a report, gives it
 * one with that cut as its only mark, so the review panel focuses it and draws it against the note's box
 */
export function attachCutReview(replay: Replay) {
  const event = replay.notes.find((note) => note.eventType === 1 || note.eventType === 2) ?? replay.notes[0];
  if (event === undefined) return;
  const first = replay.poses[0]?.time ?? event.time - 1;
  const last = replay.poses.at(-1)?.time ?? event.time + 0.6;
  replay.cutReview = { time: event.time, start: first, end: last };
  if (replay.anticheat !== undefined) return;
  const modifiers = replay.metadata.modifiers;
  replay.anticheat = {
    kind: 'report',
    report: {
      kind: 'replay-report',
      replay: {
        source: 'live',
        scoreId: '',
        playerId: '',
        playerName: '',
        song: '',
        difficulty: '',
        mode: replay.metadata.characteristic,
        accuracy: null,
        playedAt: null,
        hmd: null,
        platform: replay.metadata.platform ?? null,
        fps: null,
      },
      player: null,
      summary: null,
      findings: [
        {
          id: 'flaggedCut',
          severity: 'warning',
          category: 'rules',
          title: 'Flagged cut',
          detail: "The cut BeatKhana's live anticheat flagged, with the swing into and out of it.",
          marks: [
            {
              kind: 'note',
              time: event.time,
              end: event.time,
              hand: event.saberType === 1 ? 1 : 0,
              note: {
                time: event.noteId.time,
                line: event.noteId.lineIndex,
                layer: event.noteId.lineLayer,
                color: event.noteId.colorType,
                direction: event.noteId.cutDirection,
              },
              value: null,
              expected: null,
              label: 'the flagged cut',
              cut: cutOf(event),
            },
          ],
          series: null,
        },
      ],
      rules: {
        modifiers,
        directionTolerance: modifiers.includes('SA') ? 40 : 60,
        minBladeSpeed: 2,
        hitboxLimit: 1.25,
        exactHitbox: true,
        smallNotes: modifiers.includes('SC'),
        proMode: modifiers.includes('PM'),
        noArrows: modifiers.includes('NA'),
        checked: true,
        reason: null,
      },
    },
  } satisfies AnticheatAttachment;
}
