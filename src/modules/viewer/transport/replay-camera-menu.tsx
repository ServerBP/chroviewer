import { Camera } from 'lucide-react';
import { useTranslations } from 'use-intl';

import type { ViewerSettings } from '../../../core/viewer-settings';
import { TransportMenu } from './transport-menu';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

interface ReplayCameraMenuProps {
  open: boolean;
  camera: ViewerSettings['replayCamera'];
  onOpenChange: (open: boolean) => void;
  onHoverChange: (hovered: boolean) => void;
  onCameraChange: (camera: ViewerSettings['replayCamera']) => void;
}

export function ReplayCameraMenu({ open, camera, onOpenChange, onHoverChange, onCameraChange }: ReplayCameraMenuProps) {
  const t = useTranslations('viewer.transport');
  const tc = useTranslations('common');

  function selectCamera(value: string) {
    switch (value) {
      case 'static':
      case 'follow':
      case 'first-person':
        onCameraChange(value);
    }
  }

  return (
    <TransportMenu
      open={open}
      label={t('replayCamera')}
      icon={Camera}
      triggerClassName="max-sm:hidden"
      className="w-36 p-1"
      onOpenChange={onOpenChange}
      onHoverChange={onHoverChange}
    >
      <ToggleGroup
        className="flex w-full flex-col"
        type="single"
        orientation="vertical"
        value={camera}
        aria-label={t('replayCamera')}
        onValueChange={selectCamera}
      >
        <ToggleGroupItem className="w-full" value="static">
          {tc('static')}
        </ToggleGroupItem>
        <ToggleGroupItem className="w-full" value="follow">
          {tc('follow')}
        </ToggleGroupItem>
        <ToggleGroupItem className="w-full" value="first-person">
          {tc('firstPerson')}
        </ToggleGroupItem>
      </ToggleGroup>
    </TransportMenu>
  );
}
