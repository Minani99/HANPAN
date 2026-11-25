import { useRef } from 'react';
import type { Region, RegionCode } from '../../data/types';
import { Chip } from '../ui/Chip';
import { Dialog } from '../ui/Dialog';

export interface RegionDialogProps {
  open: boolean;
  onClose: () => void;
  regions: readonly Region[];
  selected?: RegionCode;
  /** undefined = 전체 지역 */
  onSelect: (regionCode: RegionCode | undefined) => void;
}

export function RegionDialog({ open, onClose, regions, selected, onSelect }: RegionDialogProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="지역 선택"
      description="대전 안에서 모임을 찾아볼 권역을 골라주세요."
      size="sm"
      initialFocusRef={selectedRef}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Chip
          fullWidth
          selected={selected === undefined}
          ref={selected === undefined ? selectedRef : undefined}
          onClick={() => onSelect(undefined)}
        >
          전체 지역
        </Chip>
        {regions.map((region) => (
          <Chip
            key={region.code}
            fullWidth
            selected={selected === region.code}
            ref={selected === region.code ? selectedRef : undefined}
            onClick={() => onSelect(region.code)}
          >
            {region.name}
          </Chip>
        ))}
      </div>
    </Dialog>
  );
}
