import { useMemo } from 'react';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'use-intl';

import type { AnticheatComparison } from '../../core/replay/anticheat';
import { clock, closerShare, number } from './anticheat-format';
import { cssColor, playerColor } from './anticheat-marks';

import { Button } from '@/components/ui/button';

export function ComparisonSummary({
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
                style={{ backgroundColor: cssColor(playerColor(index)) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{nameOf(index)}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {player.accuracy == null
                  ? ''
                  : `${(player.accuracy > 1 ? player.accuracy : player.accuracy * 100).toFixed(2)}%`}
                {player.humanity == null ? '' : ` · ${t('humanity', { score: Math.round(player.humanity) })}`}
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
      {comparison.pairs.length > 0 && (
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
      )}
      {alike.length > 0 && (
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
      )}
      {comparison.notes.length > 0 && (
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
      )}
    </div>
  );
}
