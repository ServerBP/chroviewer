import { ChevronLeft, ChevronRight, Repeat, StepBack, StepForward, X } from 'lucide-react';
import { useTranslations } from 'use-intl';

import type { AnticheatRules } from '../../core/replay/anticheat';
import { HUMAN_SCALE_NEEDED } from '../../core/replay/note-hitbox';
import type { Inspection } from '../../renderer/replay/anticheat-inspector';
import { number, preciseClock } from './anticheat-format';
import type { PlacedMark } from './anticheat-marks';

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';

interface InspectorCardProps {
  focused: PlacedMark;
  findingTitle: string;
  position: number;
  total: number;
  rules: AnticheatRules | null;
  tolerance: number | null;
  inspection: Inspection | null;
  onStep: (delta: -1 | 1) => void;
  onFrame: (delta: -1 | 1) => void;
  onReplay: () => void;
  onClose: () => void;
}

function Row({ label, value, state }: { label: string; value: string; state?: 'bad' | 'good' | null }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={`m-0 text-right text-xs tabular-nums ${state === 'bad' ? 'font-semibold text-red-400' : state === 'good' ? 'text-emerald-400' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** The cut being looked at: what the game recorded, what the scene measured, and what the game allows */
export function InspectorCard({
  focused,
  findingTitle,
  position,
  total,
  rules,
  tolerance,
  inspection,
  onStep,
  onFrame,
  onReplay,
  onClose,
}: InspectorCardProps) {
  const t = useTranslations('anticheat.inspector');
  const { mark } = focused;
  const cut = mark.cut;
  const hand = mark.hand === 0 ? t('left') : mark.hand === 1 ? t('right') : null;
  const minSpeed = rules?.minBladeSpeed ?? 2;
  const deviation = cut === undefined ? null : Math.abs(cut.deviation);
  const sweep = inspection?.sweep ?? null;
  return (
    <section className="border-border bg-muted/30 grid gap-2 rounded-md border p-3" aria-label={t('title')}>
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium">{findingTitle}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {preciseClock(mark.time)}
            {hand === null ? '' : ` · ${hand}`}
            {total > 1 ? ` · ${t('position', { position, total })}` : ''}
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t('close')} onClick={onClose}>
          <X />
        </Button>
      </div>
      {mark.label !== '' && <p className="m-0 text-sm">{mark.label}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="outline" size="sm" aria-label={t('previous')} disabled={total < 2} onClick={() => onStep(-1)}>
          <ChevronLeft aria-hidden />
          <Kbd>[</Kbd>
        </Button>
        <Button variant="outline" size="sm" aria-label={t('next')} disabled={total < 2} onClick={() => onStep(1)}>
          <Kbd>]</Kbd>
          <ChevronRight aria-hidden />
        </Button>
        <Button variant="outline" size="sm" aria-label={t('frameBack')} onClick={() => onFrame(-1)}>
          <StepBack aria-hidden />
          <Kbd>,</Kbd>
        </Button>
        <Button variant="outline" size="sm" aria-label={t('frameForward')} onClick={() => onFrame(1)}>
          <Kbd>.</Kbd>
          <StepForward aria-hidden />
        </Button>
        <Button variant="outline" size="sm" onClick={onReplay}>
          <Repeat aria-hidden />
          {t('replay')}
          <Kbd>R</Kbd>
        </Button>
      </div>
      {cut !== undefined && (
        <dl className="divide-border m-0 grid divide-y">
          {!cut.recorded && <Row label={t('values')} value={t('notRecorded')} state="bad" />}
          {mark.note !== null && mark.note.direction !== 8 && tolerance !== null && (
            <Row
              label={t('direction')}
              value={t('degreesOf', { value: number(deviation), limit: tolerance })}
              state={deviation !== null && deviation > tolerance + 0.5 ? 'bad' : 'good'}
            />
          )}
          {inspection?.angle != null && (
            <Row label={t('directionDrawn')} value={t('degrees', { value: number(Math.abs(inspection.angle)) })} />
          )}
          <Row
            label={t('speed')}
            value={t('speedOf', { value: number(cut.speed, 2), limit: minSpeed })}
            state={cut.recorded && cut.speed < minSpeed - 0.01 ? 'bad' : 'good'}
          />
          {inspection?.tipSpeed != null && (
            <Row label={t('tipSpeed')} value={t('metresPerSecond', { value: number(inspection.tipSpeed, 2) })} />
          )}
          <Row
            label={t('distance')}
            value={t('distanceOf', { value: number(cut.distance, 2) })}
          />
          {sweep !== null && (
            <Row
              label={t('sweep')}
              value={
                sweep.hits
                  ? inspection?.closer === 'previous'
                    ? t('sweepHitPrevious')
                    : t('sweepHit')
                  : Number.isFinite(sweep.scaleNeeded)
                    ? t('sweepMiss', { scale: number(sweep.scaleNeeded, 2) })
                    : t('sweepFar')
              }
              state={sweep.hits ? 'good' : sweep.scaleNeeded > HUMAN_SCALE_NEEDED ? 'bad' : null}
            />
          )}
          <Row label={t('timing')} value={t('milliseconds', { value: number(cut.timeDeviation * 1000, 0) })} />
          <Row
            label={t('ratings')}
            value={t('ratingsOf', {
              before: number(cut.beforeRating * 100, 0),
              after: number(cut.afterRating * 100, 0),
            })}
          />
          {inspection?.frames != null && (
            <Row
              label={t('frames')}
              value={t('milliseconds', { value: number((inspection.frames[1] - inspection.frames[0]) * 1000, 1) })}
            />
          )}
        </dl>
      )}
      {cut !== undefined && <p className="text-muted-foreground m-0 text-xs leading-relaxed">{t('legend')}</p>}
    </section>
  );
}
