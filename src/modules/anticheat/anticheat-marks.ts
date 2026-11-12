import { secondsToSongBpmTime } from '../../core/beatmap/bpm';
import type { Rgb } from '../../core/colors';
import type { AnticheatAttachment, AnticheatFinding, AnticheatSeverity } from '../../core/replay/anticheat';
import type { NoteHighlight } from '../../renderer/map/map-object-renderer';
import type { Ghost, SwingPath } from '../../renderer/replay/anticheat-overlay';
import type { TimelineMarker } from '../viewer/timeline-markers';

export const SEVERITY_COLORS: Record<AnticheatSeverity, Rgb> = {
  critical: [1, 0.2, 0.25],
  warning: [1, 0.68, 0.1],
  notice: [0.3, 0.75, 1],
  info: [0.75, 0.75, 0.8],
};

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

export const cssColor = ([red, green, blue]: Rgb) =>
  `rgb(${String(Math.round(red * 255))} ${String(Math.round(green * 255))} ${String(Math.round(blue * 255))})`;

/** A finding with where it came from: index 0 is the played replay, later ones other players of a comparison */
export interface PlacedFinding {
  key: string;
  player: number;
  finding: AnticheatFinding;
}

export function findingsOf(attachment: AnticheatAttachment): PlacedFinding[] {
  if (attachment.kind === 'report') {
    return attachment.report.findings.map((finding, index) => ({ key: `0:${String(index)}`, player: 0, finding }));
  }
  return attachment.comparison.players.flatMap((player, playerIndex) =>
    player.findings.map((finding, index) => ({
      key: `${String(playerIndex)}:${String(index)}`,
      player: playerIndex,
      finding,
    })),
  );
}

/** Findings shown when none is chosen: everything that isn't only for information */
const shownByDefault = (finding: AnticheatFinding) => finding.severity !== 'info';

/** The findings whose marks are drawn: the chosen one, or every finding worth a look */
export function activeFindings(findings: PlacedFinding[], selected: string | null) {
  return selected === null
    ? findings.filter((entry) => shownByDefault(entry.finding))
    : findings.filter((entry) => entry.key === selected);
}

/** Notes to ring and swings to trace for the active findings. Swings are only traced on the played replay's own sabers. */
export function sceneMarks(active: PlacedFinding[]): { highlights: NoteHighlight[]; paths: SwingPath[] } {
  const highlights: NoteHighlight[] = [];
  const paths: SwingPath[] = [];
  for (const { player, finding } of active) {
    const color = SEVERITY_COLORS[finding.severity];
    for (const mark of finding.marks) {
      if (mark.kind === 'note' && mark.note !== null) highlights.push({ note: mark.note, color });
      if (player !== 0 || (mark.hand !== 0 && mark.hand !== 1)) continue;
      if (mark.kind === 'swing')
        paths.push({ hand: mark.hand, from: mark.time, to: Math.max(mark.end, mark.time + 0.05), color });
      // A turn-around is the moment between two swings; the path around it shows the turn
      if (mark.kind === 'turn') paths.push({ hand: mark.hand, from: mark.time - 0.18, to: mark.time + 0.18, color });
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

export function ghostsOf(attachment: AnticheatAttachment): Ghost[] {
  if (attachment.kind !== 'comparison') return [];
  return attachment.others.map((replay, index) => ({
    replay,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length] ?? [1, 1, 1],
  }));
}
