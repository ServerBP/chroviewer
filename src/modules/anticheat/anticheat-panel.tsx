import { useMemo } from 'react';

import { Crosshair, Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'use-intl';

import type {
  AnticheatAttachment,
  AnticheatComparison,
  AnticheatFinding,
  AnticheatSeries,
} from '../../core/replay/anticheat';
import { cssColor, findingsOf, PLAYER_COLORS, SEVERITY_COLORS, type PlacedFinding } from './anticheat-marks';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface AnticheatPanelProps {
  attachment: AnticheatAttachment;
  open: boolean;
  time: number;
  selected: string | null;
  hiddenPlayers: ReadonlySet<number>;
  /** Note marks found in the loaded map, of `noteMarks` */
  matchedNotes: number;
  noteMarks: number;
  onSelect: (key: string | null) => void;
  onSeek: (time: number) => void;
  onTogglePlayer: (index: number, visible: boolean) => void;
  onClose: () => void;
}

const clock = (seconds: number) =>
  `${String(Math.floor(Math.max(0, seconds) / 60))}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;

const number = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '–'
    : value.toFixed(Math.abs(value) >= 100 ? 0 : digits);

const HANDS = ['left', 'right', 'head'] as const;

// Past 99% the decimal matters: 99.8% of pairs is not every pair
const closerShare = (share: number) =>
  share >= 0.99 && share < 1 ? Math.min(99.9, share * 100).toFixed(1) : String(Math.round(share * 100));

/** A finding's measure over the play, with the current moment and where most people are */
function SeriesChart({ series, time }: { series: AnticheatSeries; time: number }) {
  const points = series.points.filter((point) => Number.isFinite(point[2]));
  if (points.length < 2) return null;
  const values = points.map((point) => point[2]);
  const times = points.map((point) => point[0]);
  let low = Math.min(...values, series.ordinary?.[0] ?? Infinity);
  let high = Math.max(...values, series.ordinary?.[1] ?? -Infinity);
  if (high - low < 1e-9) [low, high] = [low - 1, high + 1];
  const start = Math.min(...times);
  const end = Math.max(...times);
  const x = (value: number) => ((value - start) / Math.max(end - start, 1e-9)) * 300;
  const y = (value: number) => 56 - ((value - low) / (high - low)) * 52 - 2;
  const cursor = time >= start && time <= end ? x(time) : null;
  return (
    <figure className="m-0 grid gap-1">
      <svg
        viewBox="0 0 300 60"
        preserveAspectRatio="none"
        className="bg-muted/40 h-16 w-full rounded"
        role="img"
        aria-label={series.label}
      >
        {series.ordinary !== null && (
          <rect
            x={0}
            width={300}
            y={y(series.ordinary[1])}
            height={Math.max(1, y(series.ordinary[0]) - y(series.ordinary[1]))}
            fill="currentColor"
            fillOpacity={0.1}
          />
        )}
        {points.map((point, index) => (
          <circle
            key={index}
            cx={x(point[0])}
            cy={y(point[2])}
            r={1.4}
            fill={point[1] === 0 ? 'rgb(255 90 90)' : point[1] === 1 ? 'rgb(90 160 255)' : 'currentColor'}
          />
        ))}
        {cursor !== null && (
          <line x1={cursor} x2={cursor} y1={0} y2={60} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} />
        )}
      </svg>
      <figcaption className="text-muted-foreground text-xs">
        {series.label}
        {series.unit === '' ? '' : ` (${series.unit})`}
      </figcaption>
    </figure>
  );
}

function FindingRow({
  entry,
  playerName,
  selected,
  time,
  onSelect,
  onSeek,
}: {
  entry: PlacedFinding;
  playerName: string | null;
  selected: boolean;
  time: number;
  onSelect: (key: string | null) => void;
  onSeek: (time: number) => void;
}) {
  const t = useTranslations('anticheat');
  const finding: AnticheatFinding = entry.finding;
  const color = cssColor(SEVERITY_COLORS[finding.severity]);
  return (
    <li className={`grid gap-2 rounded-md border p-3 ${selected ? 'border-primary bg-accent/40' : 'border-border'}`}>
      <button
        type="button"
        className="focus-visible:ring-ring/40 flex w-full items-start gap-2 text-left outline-none focus-visible:ring-3"
        aria-pressed={selected}
        onClick={() => {
          onSelect(selected ? null : entry.key);
        }}
      >
        <span className="mt-1 size-2.5 shrink-0 rotate-45" style={{ backgroundColor: color }} aria-hidden />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">{finding.title}</span>
          <span className="text-muted-foreground text-xs">
            {t(`severity.${finding.severity}`)} · {finding.category}
            {playerName === null ? '' : ` · ${playerName}`}
            {finding.marks.length > 0 ? ` · ${t('places', { count: finding.marks.length })}` : ''}
          </span>
        </span>
      </button>
      {selected && (
        <>
          <p className="m-0 text-sm leading-relaxed">{finding.detail}</p>
          {finding.series !== null && <SeriesChart series={finding.series} time={time} />}
          {finding.marks.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {finding.marks.map((mark, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className="border-border hover:border-primary hover:bg-accent focus-visible:ring-ring/40 flex items-baseline gap-1.5 rounded border px-2 py-0.5 text-xs transition-colors outline-none focus-visible:ring-3"
                    onClick={() => {
                      // A moment before the mark, so the note or swing can be watched coming
                      onSeek(Math.max(0, mark.time - 1.5));
                    }}
                    title={t('seekTo', { time: clock(mark.time) })}
                  >
                    <span className="tabular-nums">
                      {mark.end > mark.time + 0.05 ? `${clock(mark.time)}–${clock(mark.end)}` : clock(mark.time)}
                    </span>
                    <span className="text-muted-foreground">
                      {t(`kind.${mark.kind}`)}
                      {mark.hand === null ? '' : ` · ${t(`hand.${HANDS[mark.hand] ?? 'head'}`)}`}
                    </span>
                    {mark.label !== '' && <span>{mark.label}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

function ComparisonSummary({
  comparison,
  hiddenPlayers,
  time,
  onTogglePlayer,
}: {
  comparison: AnticheatComparison;
  hiddenPlayers: ReadonlySet<number>;
  time: number;
  onTogglePlayer: (index: number, visible: boolean) => void;
}) {
  const t = useTranslations('anticheat');
  const nameOf = (index: number) => {
    const player = comparison.players[index];
    return player?.player?.name ?? player?.playerName ?? `#${String(index + 1)}`;
  };
  // Measures where the players sit closest together against how far apart people usually are
  const alike = useMemo(
    () =>
      comparison.measures
        .filter((measure) => measure.kind === 'humanity' || measure.kind === 'style')
        .map((measure) => {
          const values = measure.values.filter((value): value is number => value !== null && Number.isFinite(value));
          const width = measure.ordinary === null ? null : Math.abs(measure.ordinary[1] - measure.ordinary[0]);
          const gap =
            values.length < 2 || width === null || width <= 0
              ? null
              : (Math.max(...values) - Math.min(...values)) / width;
          return { measure, gap };
        })
        .filter((entry) => entry.gap !== null)
        .sort((left, right) => (left.gap ?? 0) - (right.gap ?? 0)),
    [comparison],
  );
  const near = useMemo(() => {
    const index = comparison.notes.findIndex(
      (entry) => (entry.times.find((value) => value !== null) ?? entry.note.time) >= time,
    );
    const from = Math.max(0, (index < 0 ? comparison.notes.length : index) - 2);
    return comparison.notes.slice(from, from + 4);
  }, [comparison, time]);
  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('players')}</h3>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {comparison.players.map((player, index) => (
            <li key={index} className="flex items-center gap-2 text-sm">
              <span
                className="size-3 shrink-0 rounded-full border border-white/40"
                style={{
                  backgroundColor:
                    index === 0
                      ? 'rgb(240 240 240)'
                      : cssColor(PLAYER_COLORS[(index - 1) % PLAYER_COLORS.length] ?? [1, 1, 1]),
                }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{nameOf(index)}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {player.accuracy === null ? '' : `${(player.accuracy * 100).toFixed(2)}%`}
                {player.humanity === null ? '' : ` · ${t('humanity', { score: Math.round(player.humanity) })}`}
              </span>
              {index === 0 ? (
                <span className="text-muted-foreground w-8 text-center text-xs">{t('played')}</span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    hiddenPlayers.has(index)
                      ? t('showPlayer', { name: nameOf(index) })
                      : t('hidePlayer', { name: nameOf(index) })
                  }
                  onClick={() => {
                    onTogglePlayer(index, hiddenPlayers.has(index));
                  }}
                >
                  {hiddenPlayers.has(index) ? <EyeOff /> : <Eye />}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('pairs')}</h3>
        <ul className="m-0 grid list-none gap-2 p-0">
          {comparison.pairs.map((pair) => (
            <li
              key={`${String(pair.a)}-${String(pair.b)}`}
              className="border-border grid gap-0.5 rounded-md border p-2 text-sm"
            >
              <span className="font-medium">
                {nameOf(pair.a)} · {nameOf(pair.b)}
              </span>
              <span className="text-muted-foreground text-xs">
                {pair.closerThan === null
                  ? t('distanceOnly', { distance: number(pair.distance, 2) })
                  : t('closerThan', { share: closerShare(pair.closerThan), pairs: pair.usualPairs })}
              </span>
              {pair.timingCorrelation !== null && (
                <span className="text-muted-foreground text-xs">
                  {t('timing', { correlation: number(pair.timingCorrelation, 2), notes: pair.sharedNotes })}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground m-0 text-xs">{t('pairsHint')}</p>
      </section>
      <section className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('closestMeasures')}</h3>
        <ul className="m-0 grid list-none gap-1 p-0 text-xs">
          {alike.slice(0, 10).map(({ measure }) => (
            <li key={measure.key} className="grid gap-0.5" title={measure.explanation}>
              <span>{measure.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {measure.values.map((value, index) => `${nameOf(index)} ${number(value, 2)}`).join(' · ')}
                {measure.ordinary === null
                  ? ''
                  : ` (${t('ordinary', { low: number(measure.ordinary[0], 2), high: number(measure.ordinary[1], 2) })})`}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('notesHere')}</h3>
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="font-normal">{t('note')}</th>
              {comparison.players.map((_, index) => (
                <th key={index} className="font-normal">
                  {nameOf(index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {near.map((entry, row) => (
              <tr key={row}>
                <td>{clock(entry.note.time)}</td>
                {entry.values.map((values, index) => (
                  <td key={index}>
                    {values === null
                      ? '–'
                      : t('noteValues', {
                          timing: number(values[comparison.noteMeasures.indexOf('timing')]),
                          pre: number(values[comparison.noteMeasures.indexOf('preAngle')], 0),
                          post: number(values[comparison.noteMeasures.indexOf('postAngle')], 0),
                        })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground m-0 text-xs">{t('noteValuesHint')}</p>
      </section>
    </div>
  );
}

export function AnticheatPanel({
  attachment,
  open,
  time,
  selected,
  hiddenPlayers,
  matchedNotes,
  noteMarks,
  onSelect,
  onSeek,
  onTogglePlayer,
  onClose,
}: AnticheatPanelProps) {
  const t = useTranslations('anticheat');
  const findings = useMemo(() => findingsOf(attachment), [attachment]);
  const comparison = attachment.kind === 'comparison' ? attachment.comparison : null;
  const report = attachment.kind === 'report' ? attachment.report : null;
  const title =
    comparison?.title ??
    (report === null ? '' : `${report.replay.song} · ${report.player?.name ?? report.replay.playerName}`);
  const playerName = (index: number) => {
    if (comparison === null) return null;
    const player = comparison.players[index];
    return player?.player?.name ?? player?.playerName ?? null;
  };
  return (
    <Sheet
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent
        showOverlay={false}
        className="w-[92vw] max-w-none gap-0 overflow-hidden p-0 sm:max-w-md"
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <SheetHeader className="shrink-0 px-5 pt-5 pr-12 pb-3">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold">
            <Crosshair className="size-4" aria-hidden />
            {comparison === null ? t('reportTitle') : t('comparisonTitle')}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-xs">{title}</SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 pb-6">
          {report !== null && (
            <p className="m-0 text-sm">
              {report.summary ?? t('nothing')}
              {report.replay.humanity === null
                ? ''
                : ` ${t('humanity', { score: Math.round(report.replay.humanity) })}.`}
            </p>
          )}
          {comparison !== null && (
            <ComparisonSummary
              comparison={comparison}
              hiddenPlayers={hiddenPlayers}
              time={time}
              onTogglePlayer={onTogglePlayer}
            />
          )}
          {noteMarks > 0 && matchedNotes < noteMarks && (
            <p className="text-muted-foreground m-0 text-xs">{t('unmatched', { missing: noteMarks - matchedNotes })}</p>
          )}
          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold">{t('findings', { count: findings.length })}</h3>
              {selected !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSelect(null);
                  }}
                >
                  {t('showAll')}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground m-0 text-xs">{t('findingsHint')}</p>
            {findings.length === 0 ? (
              <p className="text-muted-foreground m-0 text-sm">{t('nothing')}</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {findings.map((entry) => (
                  <FindingRow
                    key={entry.key}
                    entry={entry}
                    playerName={playerName(entry.player)}
                    selected={selected === entry.key}
                    time={time}
                    onSelect={onSelect}
                    onSeek={onSeek}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
