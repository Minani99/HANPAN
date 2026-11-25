import type { ReactElement } from 'react';
import type { CategoryId } from '../../data/types';
import { getCategoryName } from '../../domain/categories';
import { cn } from '../../lib/cn';

/**
 * 사진이 없는 모임의 장르별 중립 플레이스홀더.
 * 외부·AI 생성 이미지를 쓰지 않고, 회색조 인라인 SVG 모티프만 사용한다.
 * 파티=주사위, 추리=돋보기, 전략=육각 타일, 머더미스터리=열쇠, 마작=패, 홀덤=카드
 */
const LIGHT = '#f8f9fa';
const MID = '#e2e6ea';

const MOTIFS: Record<CategoryId, ReactElement> = {
  party: (
    <>
      <g transform="rotate(-12 17 28)">
        <rect x="6" y="17" width="22" height="22" rx="4.5" fill={MID} />
        <circle cx="12" cy="23" r="1.9" fill="currentColor" stroke="none" />
        <circle cx="17" cy="28" r="1.9" fill="currentColor" stroke="none" />
        <circle cx="22" cy="33" r="1.9" fill="currentColor" stroke="none" />
      </g>
      <g transform="rotate(11 33 18)">
        <rect x="23" y="8" width="20" height="20" rx="4.5" fill={LIGHT} />
        <circle cx="28.5" cy="13.5" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="37.5" cy="13.5" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="28.5" cy="22.5" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="37.5" cy="22.5" r="1.7" fill="currentColor" stroke="none" />
      </g>
    </>
  ),
  deduction: (
    <>
      <circle cx="20" cy="20" r="12" fill={LIGHT} strokeWidth="2.6" />
      <path d="M14 16.5a7 7 0 0 1 6-4.5" strokeWidth="1.8" />
      <path d="M29 29l10.5 10.5" strokeWidth="4.2" />
    </>
  ),
  strategy: (
    <>
      <path d="M17 7.5l7 4v8l-7 4-7-4v-8z" fill={MID} />
      <path d="M31 7.5l7 4v8l-7 4-7-4v-8z" fill={LIGHT} />
      <path d="M24 19.5l7 4v8l-7 4-7-4v-8z" fill={LIGHT} />
      <path d="M38 19.5l7 4v8l-7 4-7-4v-8z" fill={MID} />
      <path d="M10 19.5l7 4v8l-7 4-7-4v-8z" fill={MID} opacity="0.65" />
    </>
  ),
  murder_mystery: (
    <>
      <circle cx="14" cy="24" r="8" fill={LIGHT} strokeWidth="2.4" />
      <circle cx="14" cy="24" r="3" fill={MID} />
      <path d="M22 24h20M35 24v6M40 24v5" strokeWidth="2.6" />
    </>
  ),
  mahjong_etc: (
    <>
      <rect x="20" y="9" width="19" height="26" rx="3.5" fill={MID} transform="rotate(9 29.5 22)" />
      <rect x="10" y="12" width="19" height="26" rx="3.5" fill={LIGHT} />
      <circle cx="19.5" cy="19.5" r="3" />
      <circle cx="19.5" cy="30.5" r="3" />
      <path d="M19.5 23.5v3" />
    </>
  ),
  holdem_social: (
    <>
      <rect x="9" y="11" width="18" height="26" rx="3" fill={MID} transform="rotate(-11 18 24)" />
      <rect x="21" y="10" width="18" height="26" rx="3" fill={LIGHT} transform="rotate(8 30 23)" />
      <path d="M30.4 17.5l4.2 5.5-4.2 5.5-4.2-5.5z" fill="currentColor" stroke="none" transform="rotate(8 30 23)" />
    </>
  ),
};

export interface CategoryPlaceholderProps {
  categoryId: CategoryId;
  /** true면 장식(alt="" 상당, aria-hidden). 목록 행처럼 장르가 글로 함께 표시될 때 사용 */
  decorative?: boolean;
  className?: string;
}

export function CategoryPlaceholder({ categoryId, decorative = false, className }: CategoryPlaceholderProps) {
  const label = `${getCategoryName(categoryId)} 모임 기본 이미지`;
  return (
    <div
      className={cn('flex h-full w-full items-center justify-center bg-placeholder-bg text-placeholder-motif', className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-category={categoryId}
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden="true"
        className="h-[46%] max-h-14 w-auto"
      >
        {MOTIFS[categoryId]}
      </svg>
    </div>
  );
}
