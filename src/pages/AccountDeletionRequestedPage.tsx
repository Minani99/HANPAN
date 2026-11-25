import { InfoState } from '../components/layout/PageStates';
import { ButtonLink } from '../components/ui/Button';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** 탈퇴 요청 직후 안내 (`/account/deletion-requested`). 로그아웃된 상태에서 보여준다. */
export function AccountDeletionRequestedPage() {
  useDocumentTitle('탈퇴 요청 접수');
  return (
    <InfoState
      title="탈퇴 요청이 접수됐어요"
      description="예정된 신청과 주최 중이던 예정 모임은 취소됐어요. 계정 데이터 삭제는 운영자 확인 후 처리돼요. 보관 정보는 개인정보처리방침(초안)에서 확인할 수 있어요."
      actions={
        <>
          <ButtonLink to="/">홈으로 가기</ButtonLink>
          <ButtonLink to="/policies/privacy" variant="secondary" size="lg">
            개인정보처리방침(초안)
          </ButtonLink>
        </>
      }
    />
  );
}
