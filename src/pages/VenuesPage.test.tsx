import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createMockAdapter } from '../data/mock/adapter';
import { createSeedDb } from '../data/mock/seed';
import { renderRoutes } from '../test/renderWithProviders';
import { VenueDetailPage } from './VenueDetailPage';
import { VenuesPage } from './VenuesPage';

const NOW = new Date('2026-11-23T03:00:00Z');

const routes: RouteObject[] = [
  { path: '/venues', Component: VenuesPage },
  { path: '/venues/:id', Component: VenueDetailPage },
  { path: '/meetings/:id', element: <p>모임 상세</p> },
  { path: '/meetings/new', element: <p>모임 만들기</p> },
];

function render(path: string, db = createSeedDb(NOW)) {
  const adapter = createMockAdapter({ delayMs: 0, persist: false, db, now: () => NOW });
  return renderRoutes(routes, { initialEntries: [path], adapter });
}

describe('VenuesPage', () => {
  it('공개 공간만 구분선 행으로(유형·권역·주소·정보 확인일), 고정 안내, 비공개 공간 없음', async () => {
    render('/venues');
    const list = await screen.findByTestId('venue-list');
    const rows = within(list).getAllByTestId('venue-row');
    expect(rows).toHaveLength(10);
    expect(list).not.toHaveTextContent('비공개 예시 공간 J');
    const first = rows[0]!;
    expect(first).toHaveAttribute('href', '/venues/seed-venue-01');
    expect(within(first).getByTestId('venue-type')).toHaveTextContent('보드게임 카페');
    expect(within(first).getByTestId('venue-address')).toHaveTextContent('둔산·탄방 · 대전 서구 예시로 12 (가상 주소)');
    expect(within(first).getByTestId('venue-verified')).toHaveTextContent('정보 확인일 2026.11.20');
    expect(screen.getAllByTestId('venue-verified').some((cell) => cell.textContent === '확인일 없음')).toBe(true);
    expect(screen.getByTestId('venue-notice')).toHaveTextContent('HANPAN은 예약·결제를 대행하지 않아요.');
    expect(screen.getByTestId('venue-count')).toHaveTextContent('10곳');
  });

  it('필터 줄마다 보이는 라벨(권역·유형)이 있고, 칩 그룹은 aria-labelledby로 그 라벨을 이름으로 쓴다', async () => {
    render('/venues');
    await screen.findByTestId('venue-list');
    for (const [id, name] of [
      ['venue-filter-region', '권역'],
      ['venue-filter-type', '유형'],
    ] as const) {
      const label = document.getElementById(id);
      expect(label).toHaveTextContent(name);
      // 모바일에서도 보인다(예전의 hidden md:inline 아님)
      expect(label).not.toHaveClass('hidden');
      const group = screen.getByRole('group', { name });
      expect(group).toHaveAttribute('aria-labelledby', id);
      expect(group).not.toHaveAttribute('aria-label');
    }
  });

  it('권역·유형 칩 → URL 쿼리(region, type), 쿼리로 직접 들어와도 같은 상태', async () => {
    const user = userEvent.setup();
    const { router } = render('/venues');
    await screen.findByTestId('venue-list');
    await user.click(within(screen.getByRole('group', { name: '권역' })).getByRole('button', { name: '노은·지족' }));
    await waitFor(() => expect(router.state.location.search).toBe('?region=noeun_jijok'));
    await user.click(within(screen.getByRole('group', { name: '유형' })).getByRole('button', { name: '파티룸' }));
    await waitFor(() => expect(router.state.location.search).toBe('?region=noeun_jijok&type=party_room'));
    await waitFor(() => expect(screen.getAllByTestId('venue-row').map((row) => within(row).getByTestId('venue-name').textContent)).toEqual(['파티룸 G']));
    expect(within(screen.getByRole('group', { name: '권역' })).getByRole('button', { name: '노은·지족' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('조건에 맞는 공간이 없으면 필터 초기화, 공간이 하나도 없으면 안내만(가짜 링크 없음)', async () => {
    const user = userEvent.setup();
    render('/venues?region=gwanjeo_gasuwon&type=other');
    expect(await screen.findByText('조건에 맞는 공간이 아직 없어요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(await screen.findByTestId('venue-list')).toBeInTheDocument();

    const empty = { ...createSeedDb(NOW), venues: [] };
    const result = render('/venues', empty);
    expect(await screen.findByText('아직 등록된 공간이 없어요.')).toBeInTheDocument();
    expect(screen.getByText('운영 중인 공간을 알려 주시는 방법은 아직 준비 중이에요.')).toBeInTheDocument();
    expect(within(result.container).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('VenueDetailPage', () => {
  it('상세: 외부 링크(https만, 새 창, rel), 정보 확인일, 고정 안내, 예정 모임 목록', async () => {
    render('/venues/seed-venue-01');
    expect(await screen.findByRole('heading', { level: 1, name: '보드게임 카페 A' })).toBeInTheDocument();
    const website = screen.getByTestId('venue-website');
    expect(website).toHaveAccessibleName(/공식 홈페이지\(외부\)/);
    expect(website).toHaveAttribute('href', 'https://example.com/venues/a');
    for (const link of [website, screen.getByTestId('venue-booking')]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.getByTestId('venue-info')).toHaveTextContent('정보 확인일2026.11.20');
    expect(screen.getByTestId('venue-notice')).toHaveTextContent('영업시간·좌석·가격은 공간에 직접 확인해 주세요.');
    expect(screen.queryByText(/영업 중|예약 가능 시간|빈자리/)).not.toBeInTheDocument();
    const meetings = await screen.findByTestId('meeting-list');
    expect(within(meetings).getAllByTestId('meeting-row').length).toBeGreaterThanOrEqual(1);
    expect(meetings).toHaveTextContent('[예시] 퇴근하고 코드네임 한 판');
  });

  it('javascript:·http: 링크는 렌더하지 않는다(데이터가 잘못 들어와도)', async () => {
    const db = createSeedDb(NOW);
    const venue = db.venues.find((item) => item.id === 'seed-venue-01')!;
    venue.websiteUrl = 'javascript:alert(1)';
    venue.bookingUrl = 'http://example.com/booking';
    render('/venues/seed-venue-01', db);
    await screen.findByRole('heading', { level: 1, name: '보드게임 카페 A' });
    expect(screen.queryByTestId('venue-website')).not.toBeInTheDocument();
    expect(screen.queryByTestId('venue-booking')).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('비공개·없는 공간은 "공간을 찾을 수 없어요"', async () => {
    render('/venues/seed-venue-11');
    expect(await screen.findByRole('heading', { level: 1, name: '공간을 찾을 수 없어요.' })).toBeInTheDocument();
  });
});
