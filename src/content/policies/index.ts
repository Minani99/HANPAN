/**
 * 정책 문서(이용자 공개용 초안). 원문은 운영 문서 초안에서 이용자에게 필요한 부분만 옮겼다:
 * - terms.md     ← docs/policies/TERMS_DRAFT.md
 * - privacy.md   ← docs/policies/PRIVACY_DRAFT.md (내부 테이블 이름 등은 뺐다)
 * - operations.md← docs/OPERATIONS.md §1~§4 (이용자 대상 운영 규정. 관리자 내부 절차는 제외)
 * 원본 초안을 고치면 이 파일들도 함께 고친다. 정해지지 않은 값(운영 이메일·운영자 정보·시행일)은 '확정 전'으로 둔다.
 * 마크다운은 src/lib/markdown.ts의 작은 부분집합만 쓴다(HTML 해석 없음).
 */
import operations from './operations.md?raw';
import privacy from './privacy.md?raw';
import terms from './terms.md?raw';

export type PolicySlug = 'terms' | 'privacy' | 'operations';

export interface PolicyDocument {
  slug: PolicySlug;
  title: string;
  /** 화면 위 짧은 설명 */
  summary: string;
  source: string;
}

export const POLICIES: readonly PolicyDocument[] = [
  {
    slug: 'terms',
    title: '이용약관(초안)',
    summary: '서비스 이용 조건과 운영자·이용자의 권리와 의무를 정해요.',
    source: terms,
  },
  {
    slug: 'privacy',
    title: '개인정보처리방침(초안)',
    summary: '어떤 정보를 왜 처리하고, 누구에게 보이며, 언제 지우는지 안내해요.',
    source: privacy,
  },
  {
    slug: 'operations',
    title: '운영정책(초안)',
    summary: '안전 수칙, 금지 행위, 신고 처리와 공간 정보 기준을 안내해요.',
    source: operations,
  },
];

export function findPolicy(slug: string | undefined): PolicyDocument | null {
  return POLICIES.find((policy) => policy.slug === slug) ?? null;
}

export const POLICY_DRAFT_NOTICE = '운영자·법률 검토 전 초안이에요. 정식 공개 전에 바뀔 수 있어요.';
