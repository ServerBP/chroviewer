import { useMemo } from 'react';

import { Crosshair, ScanSearch } from 'lucide-react';
import { useTranslations } from 'use-intl';

import type { AnticheatAttachment, AnticheatSeries, AnticheatSeverity } from '../../core/replay/anticheat';
import { HUMAN_SCALE_NEEDED } from '../../core/replay/note-hitbox';
import type { CutCheck } from '../../renderer/map-view';
import type { HitboxMode } from '../../renderer/map/map-object-renderer';
import type { Inspection } from '../../renderer/replay/anticheat-inspector';
import type { InspectView } from '../../renderer/replay/replay-camera';
import { ComparisonSummary } from './anticheat-comparison';
import { clock, number, preciseClock } from './anticheat-format';
import { InspectorCard } from './anticheat-inspector-card';
import { cssColor, findingsOf, rulesOf, SEVERITY_COLORS, type PlacedFinding, type PlacedMark } from './anticheat-marks';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export interface AnticheatViewState {
  hitboxes: HitboxMode;
  figures: boolean;
  /** The camera's view of the focused cut */
  camera: InspectView;
}

export interface CutCheckState {
  running: boolean;
  done: number;
  total: number;
  results: CutCheck[] | null;
}

interface AnticheatPanelProps {
  attachment: AnticheatAttachment;
  open: boolean;
  time: number;
  selected: string | null;
  focused: PlacedMark | null;
  /** Position of the focused mark among the active findings' marks, from 1 */
  focusedPosition: number;
  markCount: number;
  tolerance: number | null;
  inspection: Inspection | null;
  hiddenPlayers: ReadonlySet<number>;
  /** Note marks found in the loaded map, of `noteMarks` */
  matchedNotes: number;
  noteMarks: number;
  view: AnticheatViewState;
  playbackRate: number;
  cutCheck: CutCheckState;
  onSelect: (key: string | null) => void;
  onFocus: (mark: PlacedMark | null) => void;
  onStep: (delta: -1 | 1) => void;
  onFrame: (delta: -1 | 1) => void;
  onReplayCut: () => void;
  onTogglePlayer: (index: number, visible: boolean) => void;
  onView: (view: Partial<AnticheatViewState>) => void;
  onPlaybackRate: (rate: number) => void;
  onCheckCuts: () => void;
  onClose: () => void;
}

const HANDS = ['left', 'right', 'head'] as const;
const RATES = [1, 0.5, 0.25, 0.1];
const CAMERAS: InspectView[] = ['player', 'close', 'side', 'top'];
const SEVERITIES: AnticheatSeverity[] = ['critical', 'warning', 'notice', 'info'];

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
  focused,
  time,
  onSelect,
  onFocus,
}: {
  entry: PlacedFinding;
  playerName: string | null;
  selected: boolean;
  focused: PlacedMark | null;
  time: number;
  onSelect: (key: string | null) => void;
  onFocus: (mark: PlacedMark) => void;
}) {
  const t = useTranslations('anticheat');
  const { finding } = entry;
  const color = cssColor(SEVERITY_COLORS[finding.severity]);
  const total = finding.markTotal ?? finding.marks.length;
  return (
    <li className={`grid gap-2 rounded-md border p-2.5 ${selected ? 'border-primary bg-accent/40' : 'border-border'}`}>
      <button
        type="button"
        className="focus-visible:ring-ring/40 flex w-full items-start gap-2 text-left outline-none focus-visible:ring-3"
        aria-expanded={selected}
        onClick={() => {
          onSelect(selected ? null : entry.key);
        }}
      >
        <span className="mt-1 size-2.5 shrink-0 rotate-45" style={{ backgroundColor: color }} aria-hidden />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium">{finding.title}</span>
          <span className="text-muted-foreground text-xs">
            {finding.aid === true ? t('aid') : t(`severity.${finding.severity}`)}
            {playerName === null ? '' : ` · ${playerName}`}
          </span>
        </span>
        {total > 0 && (
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs tabular-nums">
            {total}
          </span>
        )}
      </button>
      {selected && (
        <>
          <p className="m-0 text-sm leading-relaxed">{finding.detail}</p>
          {finding.series !== null && <SeriesChart series={finding.series} time={time} />}
          {finding.marks.length > 0 && (
            <ol className="m-0 grid max-h-64 list-none gap-0.5 overflow-y-auto p-0">
              {finding.marks.map((mark, index) => {
                const active = focused?.finding === entry.key && focused.index === index;
                return (
                  <li key={index}>
                    <button
                      type="button"
                      aria-current={active}
                      className={`focus-visible:ring-ring/40 grid w-full grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 rounded px-2 py-1 text-left text-xs transition-colors outline-none focus-visible:ring-3 ${active ? 'bg-primary/20' : 'hover:bg-accent'}`}
                      onClick={() => {
                        onFocus({ finding: entry.key, index, mark });
                      }}
                    >
                      <span className="tabular-nums">
                        {mark.end > mark.time + 0.05
                          ? `${clock(mark.time)}–${clock(mark.end)}`
                          : preciseClock(mark.time)}
                      </span>
                      <span className="truncate">
                        <span className="text-muted-foreground">
                          {t(`kind.${mark.kind}`)}
                          {mark.hand === null ? '' : ` · ${t(`hand.${HANDS[mark.hand] ?? 'head'}`)}`}
                        </span>
                        {mark.label === '' ? '' : ` · ${mark.label}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {total > finding.marks.length && (
            <p className="text-muted-foreground m-0 text-xs">
              {t('moreMarks', { shown: finding.marks.length, total })}
            </p>
          )}
        </>
      )}
    </li>
  );
}

function CheckSummary({ check }: { check: CutCheckState }) {
  const t = useTranslations('anticheat.check');
  if (check.running)
    return (
      <p className="text-muted-foreground m-0 text-xs">{t('running', { done: check.done, total: check.total })}</p>
    );
  const results = check.results;
  if (results === null) return null;
  const missed = results.filter((result) => result.scaleNeeded > HUMAN_SCALE_NEEDED);
  const sorted = results.map((result) => result.scaleNeeded).sort((left, right) => left - right);
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * (sorted.length - 1)))] ?? Number.NaN;
  return (
    <div className="grid gap-1 text-xs">
      <p className="m-0">{t('result', { checked: results.length, missed: missed.length })}</p>
      <p className="text-muted-foreground m-0 tabular-nums">
        {t('spread', { median: number(at(0.5), 2), high: number(at(0.99), 2), max: number(sorted.at(-1), 2) })}
      </p>
    </div>
  );
}

export function AnticheatPanel({
  attachment,
  open,
  time,
  selected,
  focused,
  focusedPosition,
  markCount,
  tolerance,
  inspection,
  hiddenPlayers,
  matchedNotes,
  noteMarks,
  view,
  playbackRate,
  cutCheck,
  onSelect,
  onFocus,
  onStep,
  onFrame,
  onReplayCut,
  onTogglePlayer,
  onView,
  onPlaybackRate,
  onCheckCuts,
  onClose,
}: AnticheatPanelProps) {
  const t = useTranslations('anticheat');
  const findings = useMemo(() => findingsOf(attachment), [attachment]);
  const comparison = attachment.kind === 'comparison' ? attachment.comparison : null;
  const report = attachment.kind === 'report' ? attachment.report : null;
  const rules = rulesOf(attachment);
  const title =
    comparison?.title ??
    (report === null ? '' : `${report.replay.song} · ${report.player?.name ?? report.replay.playerName}`);
  const playerName = (index: number) => {
    if (comparison === null) return null;
    const player = comparison.players[index];
    return player?.player?.name ?? player?.playerName ?? null;
  };
  const counts = SEVERITIES.map((severity) => ({
    severity,
    count: findings.filter((entry) => entry.finding.aid !== true && entry.finding.severity === severity).length,
  })).filter((entry) => entry.count > 0);
  const flagged = findings.filter((entry) => entry.finding.aid !== true);
  const aids = findings.filter((entry) => entry.finding.aid === true);
  const focusedFinding = focused === null ? null : findings.find((entry) => entry.key === focused.finding);
  const ruleChips = [
    tolerance === null ? t('rules.noArrows') : t('rules.tolerance', { degrees: tolerance }),
    ...(rules?.smallNotes === true ? [t('rules.smallNotes')] : []),
    ...(rules?.proMode === true ? [t('rules.proMode')] : []),
    ...(rules?.modifiers.filter((modifier) => !['SA', 'SC', 'PM', 'NA'].includes(modifier)) ?? []),
  ];
  const rowsOf = (entries: PlacedFinding[]) => (
    <ul className="m-0 grid list-none gap-1.5 p-0">
      {entries.map((entry) => (
        <FindingRow
          key={entry.key}
          entry={entry}
          playerName={playerName(entry.player)}
          selected={selected === entry.key}
          focused={focused}
          time={time}
          onSelect={onSelect}
          onFocus={onFocus}
        />
      ))}
    </ul>
  );
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
        <SheetHeader className="shrink-0 gap-1.5 px-4 pt-4 pr-12 pb-3">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold">
            <Crosshair className="size-4" aria-hidden />
            {comparison === null ? t('reportTitle') : t('comparisonTitle')}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-xs">{title}</SheetDescription>
          {counts.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {counts.map(({ severity, count }) => (
                <span
                  key={severity}
                  className="rounded px-1.5 py-0.5 text-xs font-semibold"
                  style={{
                    color: cssColor(SEVERITY_COLORS[severity]),
                    backgroundColor: `color-mix(in srgb, ${cssColor(SEVERITY_COLORS[severity])} 15%, transparent)`,
                  }}
                >
                  {t('severityCount', { severity: t(`severity.${severity}`), count })}
                </span>
              ))}
            </div>
          )}
        </SheetHeader>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 pb-6">
          <section className="grid gap-1.5">
            <div className="flex flex-wrap gap-1">
              {ruleChips.map((chip) => (
                <span key={chip} className="border-border rounded border px-1.5 py-0.5 text-xs">
                  {chip}
                </span>
              ))}
            </div>
            {rules !== null && !rules.checked && rules.reason !== null && (
              <p className="text-muted-foreground m-0 text-xs">{t('rules.unchecked', { reason: rules.reason })}</p>
            )}
          </section>

          <section className="grid gap-2" aria-label={t('view.title')}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <span className="text-muted-foreground text-xs">{t('view.hitboxes')}</span>
              <ToggleGroup
                type="single"
                value={view.hitboxes}
                aria-label={t('view.hitboxes')}
                onValueChange={(value) => {
                  if (value === 'off' || value === 'marked' || value === 'all') onView({ hitboxes: value });
                }}
              >
                <ToggleGroupItem value="off">{t('view.off')}</ToggleGroupItem>
                <ToggleGroupItem value="marked">{t('view.marked')}</ToggleGroupItem>
                <ToggleGroupItem value="all">{t('view.all')}</ToggleGroupItem>
              </ToggleGroup>
              <span className="text-muted-foreground text-xs">{t('view.speed')}</span>
              <ToggleGroup
                type="single"
                value={String(playbackRate)}
                aria-label={t('view.speed')}
                onValueChange={(value) => {
                  const rate = Number(value);
                  if (RATES.includes(rate)) onPlaybackRate(rate);
                }}
              >
                {RATES.map((rate) => (
                  <ToggleGroupItem key={rate} value={String(rate)} className="tabular-nums">
                    {rate}×
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className="text-muted-foreground text-xs">{t('view.camera')}</span>
              <ToggleGroup
                type="single"
                value={view.camera}
                aria-label={t('view.camera')}
                onValueChange={(value) => {
                  const camera = CAMERAS.find((entry) => entry === value);
                  if (camera !== undefined) onView({ camera });
                }}
              >
                {CAMERAS.map((camera) => (
                  <ToggleGroupItem key={camera} value={camera} disabled={camera !== 'player' && focused === null}>
                    {t(`view.cameras.${camera}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <label htmlFor="anticheat-figures" className="text-muted-foreground text-xs">
                {t('view.figures')}
              </label>
              <div className="flex items-center gap-2">
                <Switch
                  id="anticheat-figures"
                  checked={view.figures}
                  onCheckedChange={(figures) => {
                    onView({ figures });
                  }}
                />
                <span className="text-muted-foreground text-xs">{t('view.figuresHint')}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={cutCheck.running} onClick={onCheckCuts}>
                <ScanSearch aria-hidden />
                {t('check.button')}
              </Button>
              <CheckSummary check={cutCheck} />
            </div>
          </section>

          {focused !== null && focusedFinding !== undefined && focusedFinding !== null && (
            <InspectorCard
              focused={focused}
              findingTitle={focusedFinding.finding.title}
              position={focusedPosition}
              total={markCount}
              rules={rulesOf(attachment, focusedFinding.player)}
              tolerance={tolerance}
              inspection={inspection}
              onStep={onStep}
              onFrame={onFrame}
              onReplay={onReplayCut}
              onClose={() => {
                onFocus(null);
              }}
            />
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
              <h3 className="m-0 text-sm font-semibold">{t('findings', { count: flagged.length })}</h3>
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
            {flagged.length === 0 ? (
              <p className="text-muted-foreground m-0 text-sm">{report?.summary ?? t('nothing')}</p>
            ) : (
              rowsOf(flagged)
            )}
          </section>
          {aids.length > 0 && (
            <section className="grid gap-2">
              <h3 className="m-0 text-sm font-semibold">{t('aids')}</h3>
              {rowsOf(aids)}
            </section>
          )}
          <p className="text-muted-foreground m-0 text-xs">{t('keys')}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
