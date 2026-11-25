import { useState, type Ref } from 'react';

import { useTranslations } from 'use-intl';

import type { ViewerSettings } from '../../../core/viewer-settings';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { cn } from '@/lib/utils';

interface ReplayOrthoOverlayProps {
  overlayRef: Ref<HTMLButtonElement>;
  view: ViewerSettings['orthoCameraView'];
  onViewChange: (view: ViewerSettings['orthoCameraView']) => void;
  /** Drawn large, for looking closely at one cut */
  large?: boolean;
  onLargeChange?: (large: boolean) => void;
}

export function ReplayOrthoOverlay({ overlayRef, view, onViewChange, large = false, onLargeChange }: ReplayOrthoOverlayProps) {
  const t = useTranslations('settings.camera');
  const [controlsVisible, setControlsVisible] = useState(false);

  return (
    <section
      className={cn(
        'pointer-events-auto fixed top-16 right-3 z-20 max-sm:top-14 max-sm:right-2',
        large
          ? 'w-[min(52rem,calc(100vw-1.5rem))] max-sm:w-[calc(100vw-1rem)]'
          : 'w-[min(24rem,calc(100vw-1.5rem))] max-sm:w-[min(18rem,calc(100vw-1rem))]',
      )}
      onPointerEnter={() => {
        if (window.matchMedia('(hover: hover)').matches) setControlsVisible(true);
      }}
      onPointerLeave={() => {
        if (window.matchMedia('(hover: hover)').matches) setControlsVisible(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setControlsVisible(false);
      }}
    >
      <button
        ref={overlayRef}
        className="block aspect-4/3 w-full border-0 bg-transparent p-0"
        type="button"
        aria-label={t('orthoCamera')}
        aria-expanded={controlsVisible}
        onClick={(event) => {
          if (event.detail === 0 || window.matchMedia('(hover: none)').matches) {
            setControlsVisible((visible) => !visible);
          }
        }}
      />
      <div className={cn('mt-2 flex justify-center', controlsVisible ? 'visible' : 'pointer-events-none invisible')}>
        <ToggleGroup
          className="bg-card/88 border-border w-fit rounded-lg border p-1 shadow-lg backdrop-blur-xl"
          type="single"
          value={view}
          aria-label={t('orthographicViewLabel')}
          onValueChange={(value) => {
            switch (value) {
              case 'back':
              case 'left':
              case 'right':
                onViewChange(value);
            }
          }}
        >
          <ToggleGroupItem value="left">{t('leftView')}</ToggleGroupItem>
          <ToggleGroupItem value="back">{t('backView')}</ToggleGroupItem>
          <ToggleGroupItem value="right">{t('rightView')}</ToggleGroupItem>
        </ToggleGroup>
        {onLargeChange !== undefined && (
          <button
            type="button"
            className="bg-card/88 border-border ml-2 rounded-lg border px-3 text-sm shadow-lg backdrop-blur-xl"
            aria-pressed={large}
            onClick={() => {
              onLargeChange(!large);
            }}
          >
            {large ? t('orthoSmaller') : t('orthoLarger')}
          </button>
        )}
      </div>
    </section>
  );
}
