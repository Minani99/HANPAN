import type { ReactNode } from 'react';

/** 화면 제목(h1): 모바일 22px / 데스크톱 28px 750 — 상세 제목과 같은 타이포 */
export function PageTitle({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="mt-2 mb-6 md:mt-4 md:mb-8">
      <h1 className="text-3xl leading-tight font-heavy tracking-detail text-ink text-wrap-ko md:text-4xl">{title}</h1>
      {description ? <p className="mt-2 text-base leading-relaxed text-muted text-wrap-ko">{description}</p> : null}
    </header>
  );
}
