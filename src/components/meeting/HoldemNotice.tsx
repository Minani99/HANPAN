import { Notice } from '../ui/Notice';

/** 홀덤(비금전) 모임 안내. 금전·경품을 거는 모임은 허용하지 않는다. */
export function HoldemNotice({ className }: { className?: string }) {
  return (
    <Notice tone="info" title="비금전 홀덤 모임이에요" className={className} data-testid="holdem-notice">
      베팅·환전·상금·경품을 걸 수 없어요. 칩은 점수 표시용으로만 써요.
    </Notice>
  );
}
