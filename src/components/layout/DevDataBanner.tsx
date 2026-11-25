import { useDataAdapter } from '../../data';
import { Icon } from '../ui/Icon';
import { PageContainer } from './PageContainer';

/**
 * mock 모드에서만 보이는 안내 띠. 예시 데이터를 실제 모임처럼 오해하지 않도록 한다.
 * 이름 붙은 랜드마크(aside)로 감싸 모든 내용이 랜드마크 안에 있게 한다(axe region). 모양은 이전 div와 같다.
 */
export function DevDataBanner() {
  const adapter = useDataAdapter();
  if (adapter.mode !== 'mock') return null;
  return (
    <aside aria-label="개발 환경 안내" className="border-b border-border bg-soft" data-testid="dev-data-banner">
      <PageContainer role="note" className="flex items-start gap-1.5 py-1.75 text-sm leading-snug text-text">
        <Icon name="info" size="1.1em" className="mt-[0.12em] text-muted" />
        <span>개발용 예시 데이터입니다. 실제 모임이 아닙니다.</span>
      </PageContainer>
    </aside>
  );
}
