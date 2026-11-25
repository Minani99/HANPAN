import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../ui/Icon';
import { PageContainer } from './PageContainer';

/**
 * 이용 제한·탈퇴 요청 계정에만 보이는 상단 안내 (UI_SPEC §5). 쓰기 버튼은 각 화면에서 비활성화한다.
 * 이름 붙은 랜드마크(aside)로 감싼다(axe region — 개발용 안내 띠와 같은 처리). 모양은 이전 div와 같다.
 */
export function AccountStatusBanner() {
  const { user } = useAuth();
  if (!user || user.status === 'active') return null;
  const message =
    user.status === 'restricted'
      ? '이용이 제한된 계정이에요. 모임 신청과 만들기를 할 수 없어요.'
      : '탈퇴 요청된 계정이에요. 모임 신청과 만들기를 할 수 없어요.';
  return (
    <aside aria-label="계정 상태 안내" className="border-b border-border bg-warning-soft">
      <PageContainer
        role="note"
        className="flex items-start gap-1.5 py-2 text-sm leading-snug font-semibold text-warning"
        data-testid="account-status-banner"
      >
        <Icon name="alert-circle" size="1.1em" className="mt-[0.12em]" />
        <span>{message}</span>
      </PageContainer>
    </aside>
  );
}
