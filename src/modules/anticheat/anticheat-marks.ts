import { secondsToSongBpmTime } from '../../core/beatmap/bpm';
import type { Rgb } from '../../core/colors';
import type {
  AnticheatAttachment,
  AnticheatFinding,
  AnticheatMark,
  AnticheatRules,
  AnticheatSeverity,
} from '../../core/replay/anticheat';
import { directionTolerance } from '../../core/replay/note-hitbox';
import type { Replay } from '../../core/replay/types';
import type { NoteHighlight } from '../../renderer/map/map-object-renderer';
import type { Figure } from '../../renderer/replay/anticheat-figures';
import type { Ghost, SwingPath } from '../../renderer/replay/anticheat-overlay';
import type { TimelineMarker } from '../viewer/timeline-markers';

export const SEVERITY_COLORS: Record<AnticheatSeverity, Rgb> = {
  critical: [1, 0.2, 0.25],
  warning: [1, 0.68, 0.1],
  notice: [0.3, 0.75, 1],
  info: [0.75, 0.75, 0.8],
};

const SEVERITY_ORDER: Record<AnticheatSeverity, number> = { critical: 0, warning: 1, notice: 2, info: 3 };

/** Colours of the other players in a comparison, after the replay's own sabers */
export const PLAYER_COLORS: Rgb[] = [
  [0.35, 1, 0.45],
  [0.85, 0.45, 1],
  [1, 0.9, 0.3],
  [0.3, 1, 0.95],
  [1, 0.5, 0.75],
  [0.6, 0.75, 1],
  [1, 0.6, 0.3],
];

/** The played replay's own colour when players are drawn as markers */
export const OWN_COLOR: Rgb = [0.95, 0.95, 0.95];

export const playerColor = (index: number): Rgb =>
  index === 0 ? OWN_COLOR : (PLAYER_COLORS[(index - 1) % PLAYER_COLORS.length] ?? [1, 1, 1]);

export const cssColor = ([red, green, blue]: Rgb) =>
  `rgb(${String(Math.round(red * 255))} ${String(Math.round(green * 255))} ${String(Math.round(blue * 255))})`;

/** A finding with where it came from: index 0 is the played replay, later ones other players of a comparison */
export interface PlacedFinding {
  key: string;
  player: number;
  finding: AnticheatFinding;
}

/** One mark of a finding, addressable from the panel and the keyboard */
export interface PlacedMark {
  finding: string;
  index: number;
  mark: AnticheatMark;
}

/** Findings worst first, review aids last, in the order the file listed them otherwise */
export function findingsOf(attachment: AnticheatAttachment): PlacedFinding[] {
  const placed =
    attachment.kind === 'report'
      ? attachment.report.findings.map((finding, index) => ({ key: `0:${String(index)}`, player: 0, finding }))
      : attachment.comparison.players.flatMap((player, playerIndex) =>
          player.findings.map((finding, index) => ({
            key: `${String(playerIndex)}:${String(index)}`,
            player: playerIndex,
            finding,
          })),
        );
  return placed
    .map((entry, order) => ({ entry, order }))
    .sort(
      (left, right) =>
        Number(left.entry.finding.aid === true) - Number(right.entry.finding.aid === true) ||
        SEVERITY_ORDER[left.entry.finding.severity] - SEVERITY_ORDER[right.entry.finding.severity] ||
        left.order - right.order,
    )
    .map(({ entry }) => entry);
}

/** The rules of the play a finding is about: the report's, or the compared player's */
export function rulesOf(attachment: AnticheatAttachment, player = 0): AnticheatRules | null {
  if (attachment.kind === 'report') return attachment.report.rules ?? null;
  return attachment.comparison.players[player]?.rules ?? null;
}

export function toleranceOf(attachment: AnticheatAttachment, replay: Replay | null, player = 0) {
  const rules = rulesOf(attachment, player);
  if (rules?.noArrows === true) return null;
  return directionTolerance(replay?.metadata.modifiers, rules);
}

/** Findings shown when none is chosen: everything that isn't only for information */
const shownByDefault = (finding: AnticheatFinding) => finding.severity !== 'info';

/** The findings whose marks are drawn: the chosen one, or every finding worth a look */
export function activeFindings(findings: PlacedFinding[], selected: string | null) {
  return selected === null
    ? findings.filter((entry) => shownByDefault(entry.finding))
    : findings.filter((entry) => entry.key === selected);
}

/** Paths of the saber tip are drawn for at most this many marks, so a finding with hundreds stays readable */
const MAX_PATHS = 60;

/**
 * Notes to ring and swings to trace for the active findings. Swings are only traced on the played replay's own sabers;
 * a note mark traces the cutting saber's tip through the cut.
 */
export function sceneMarks(
  active: PlacedFinding[],
  focused: PlacedMark | null = null,
): { highlights: NoteHighlight[]; paths: SwingPath[] } {
  const highlights: NoteHighlight[] = [];
  const paths: SwingPath[] = [];
  const pathFor = (mark: AnticheatMark, color: Rgb) => {
    if (mark.hand !== 0 && mark.hand !== 1) return;
    if (mark.kind === 'swing')
      paths.push({ hand: mark.hand, from: mark.time, to: Math.max(mark.end, mark.time + 0.05), color });
    // A turn-around is the moment between two swings; the path around it shows the turn
    if (mark.kind === 'turn') paths.push({ hand: mark.hand, from: mark.time - 0.18, to: mark.time + 0.18, color });
    if (mark.kind === 'note' && mark.cut !== undefined)
      paths.push({ hand: mark.hand, from: mark.time - 0.25, to: mark.time + 0.2, color });
  };
  // Looking at one place: only its swing; the inspector draws its note's boxes, so nothing else crowds the scene
  if (focused !== null) {
    pathFor(focused.mark, [1, 1, 1]);
    return { highlights, paths };
  }
  const marks = active.reduce((count, entry) => count + entry.finding.marks.length, 0);
  for (const { player, finding } of active) {
    const color = SEVERITY_COLORS[finding.severity];
    for (const mark of finding.marks) {
      if (mark.kind === 'note' && mark.note !== null) highlights.push({ note: mark.note, color, time: mark.time });
      if (player === 0 && marks <= MAX_PATHS) pathFor(mark, color);
    }
  }
  return { highlights, paths };
}

export function findingMarkers(active: PlacedFinding[], songBpm: number): TimelineMarker[] {
  return active.flatMap(({ key, finding }) =>
    finding.marks.map((mark, index) => ({
      id: `finding-${key}-${String(index)}`,
      kind: 'finding' as const,
      time: mark.time,
      beat: secondsToSongBpmTime(mark.time, songBpm),
      duration: mark.end > mark.time + 0.05 ? mark.end - mark.time : undefined,
      lane: mark.note === null ? undefined : mark.note.line + 1,
      text: mark.label === '' ? finding.title : `${finding.title}: ${mark.label}`,
      color: cssColor(SEVERITY_COLORS[finding.severity]),
    })),
  );
}

/** Every mark of the given findings in time order, for stepping through them */
export function marksInOrder(findings: PlacedFinding[]): PlacedMark[] {
  return findings
    .flatMap((entry) => entry.finding.marks.map((mark, index) => ({ finding: entry.key, index, mark })))
    .sort((left, right) => left.mark.time - right.mark.time);
}

export function ghostsOf(attachment: AnticheatAttachment): Ghost[] {
  if (attachment.kind !== 'comparison') return [];
  return attachment.others.map((replay, index) => ({ replay, color: playerColor(index + 1) }));
}

/** Everyone in the file as markers: the played replay first, then the compared players */
export function figuresOf(attachment: AnticheatAttachment, replay: Replay | null): Figure[] {
  const own: Figure[] = replay === null ? [] : [{ replay, color: playerColor(0) }];
  if (attachment.kind !== 'comparison') return own;
  return [...own, ...attachment.others.map((other, index) => ({ replay: other, color: playerColor(index + 1) }))];
}
