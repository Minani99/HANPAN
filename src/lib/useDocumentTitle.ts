import { useEffect } from 'react';

export const SITE_NAME = 'HANPAN.';

/** 문서 제목을 '페이지 | HANPAN.' 형식으로 설정한다. title이 없으면 기본 제목. */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} — 대전 보드게임 모임`;
  }, [title]);
}
