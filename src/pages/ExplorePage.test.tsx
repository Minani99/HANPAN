import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteObject } from 'react-router';
import { __setMockFailure, createMockAdapter } from '../data/mock/adapter';
import { createUnconfiguredAdapter } from '../data/unconfigured';
import { renderRoutes } from '../test/renderWithProviders';
import { ExplorePage } from './ExplorePage';

const routes: RouteObject[] = [
  { path: '/', Component: ExplorePage },
  { path: '/meetings', Component: ExplorePage },
  { path: '/meetings/new', element: <p>모임 만들기 화면</p> },
  { path: '/meetings/:id', element: <p>상세 화면</p> },
  { path: '/venues', element: <p>공간 화면</p> },
];

afterEach(() => {
  __setMockFailure(null);
});

/** 빈 상태 제목에서 EmptyState 컨테이너를 찾는다 */
function emptyState(title: HTMLElement): HTMLElement {
  const container = title.parentElement;
  if (!container) throw new Error('empty state container not found');
  return container;
}

function rows() {
  return screen.queryAllByTestId('meeting-row');
}

describe('ExplorePage', () => {
  it('로딩(스켈레톤) → 목록', async () => {
    renderRoutes(routes);
    expect(screen.getByTestId('meeting-list-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('모임 목록을 불러오는 중이에요.')).toHaveAttribute('role', 'status');

    await waitFor(() => expect(rows()).toHaveLength(12));
    expect(screen.queryByTestId('meeting-list-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('meeting-count')).toHaveTextContent('12개');
    expect(screen.getByRole('heading', { level: 1, name: '이번 주, 같이 한 판.' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '곧 열리는 모임.' })).toBeInTheDocument();
  });

  it('오류 → 다시 시도로 복구', async () => {
    const user = userEvent.setup();
    __setMockFailure({ methods: ['listMeetings'], times: 1 });
    renderRoutes(routes);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('모임 목록을 불러오지 못했어요.');
    await user.click(within(alert).getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(rows()).toHaveLength(12));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('빈 결과 → 필터 초기화로 전체 목록 복귀', async () => {
    const user = userEvent.setup();
    const { router } = renderRoutes(routes, { initialEntries: ['/?q=없는검색어&sort=newest'] });

    const empty = emptyState(await screen.findByText('조건에 맞는 모임이 아직 없어요.'));
    expect(within(empty).getByText('다른 날짜를 선택하거나 직접 첫 모임을 만들어보세요.')).toBeInTheDocument();
    expect(within(empty).getByRole('link', { name: '모임 만들기' })).toHaveAttribute('href', '/meetings/new');
    expect(within(empty).getByText('관심 알림은 아직 준비 중이에요.')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '모임 검색' })).toHaveValue('없는검색어');

    await user.click(screen.getByRole('button', { name: '필터 초기화' }));
    await waitFor(() => expect(rows()).toHaveLength(12));
    expect(router.state.location.search).toBe('?sort=newest'); // 정렬은 유지
    expect(screen.getByRole('searchbox', { name: '모임 검색' })).toHaveValue('');
  });

  it('필터가 없는 빈 상태에는 필터 초기화 버튼이 없다 (unconfigured: 가짜 데이터 없음)', async () => {
    renderRoutes(routes, { adapter: createUnconfiguredAdapter() });
    const empty = emptyState(await screen.findByText('조건에 맞는 모임이 아직 없어요.'));
    expect(within(empty).queryByRole('button', { name: '필터 초기화' })).not.toBeInTheDocument();
    expect(within(empty).getByRole('link', { name: '모임 만들기' })).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
  });

  it('URL 쿼리로 초기 필터를 반영한다 (/meetings도 같은 화면)', async () => {
    const adapter = createMockAdapter({ delayMs: 0 });
    const spy = vi.spyOn(adapter, 'listMeetings');
    renderRoutes(routes, {
      adapter,
      initialEntries: ['/meetings?category=strategy&recruiting=1&q=%ED%85%8C%EB%9D%BC&region=bogus'],
    });

    expect(screen.getByRole('button', { name: '전략' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '모집 중만' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox', { name: '모임 검색' })).toHaveValue('테라');
    expect(spy).toHaveBeenCalledWith({ category: 'strategy', recruiting: true, q: '테라' }, { limit: 20, offset: 0 });

    // 전략 + 모집 중 + '테라' → 03(정원 마감)·09(모집 마감) 제외로 결과 없음
    expect(await screen.findByText('조건에 맞는 모임이 아직 없어요.')).toBeInTheDocument();
  });

  it('칩을 누르면 URL을 replace로 갱신한다', async () => {
    const user = userEvent.setup();
    const { router } = renderRoutes(routes);
    await waitFor(() => expect(rows()).toHaveLength(12));

    await user.click(screen.getByRole('button', { name: '파티·캐주얼' }));
    expect(router.state.location.search).toBe('?category=party');
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByRole('button', { name: '파티·캐주얼' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '모집 중만' }));
    expect(router.state.location.search).toBe('?category=party&recruiting=1');

    await user.click(screen.getByRole('button', { name: '전체' }));
    expect(router.state.location.search).toBe('?recruiting=1');
  });

  it('검색어는 250ms 디바운스 후 URL에 반영된다', async () => {
    const user = userEvent.setup();
    const { router } = renderRoutes(routes);
    await waitFor(() => expect(rows()).toHaveLength(12));

    await user.type(screen.getByRole('searchbox', { name: '모임 검색' }), '카탄');
    expect(router.state.location.search).toBe('');
    await waitFor(() => expect(router.state.location.search).toBe(`?q=${encodeURIComponent('카탄')}`));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByRole('searchbox', { name: '모임 검색' })).toHaveValue('카탄');
  });

  it('범위 밖 날짜는 필터로 적용하고 해제 칩을 보여준다', async () => {
    const user = userEvent.setup();
    const { router } = renderRoutes(routes, { initialEntries: ['/?date=2030-01-05'] });

    const clearChip = screen.getByRole('button', { name: '날짜: 01.05 (1월 5일 토요일) 필터 해제' });
    expect(clearChip).toHaveTextContent('날짜: 01.05');
    expect(screen.getByRole('button', { name: '날짜 전체' })).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByText('조건에 맞는 모임이 아직 없어요.')).toBeInTheDocument();

    await user.click(clearChip);
    expect(router.state.location.search).toBe('');
    await waitFor(() => expect(rows()).toHaveLength(12));
    expect(screen.getByRole('button', { name: '날짜 전체' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('날짜 칸은 전체 + 7일 = 8개이고 오늘을 표시한다', async () => {
    renderRoutes(routes);
    const group = screen.getByRole('group', { name: '날짜 선택' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(8);
    // 이름은 보이는 글자(요일·날짜)로 시작하고 숨긴 설명이 뒤에 붙는다(WCAG 2.5.3 Label in Name — aria-label로 덮지 않음)
    expect(buttons[0]).toHaveAccessibleName('날짜 전체');
    expect(buttons[1]).not.toHaveAttribute('aria-label');
    expect(buttons[1]).toHaveAccessibleName(/^[일월화수목금토] \d{2}\.\d{2}, \d{1,2}월 \d{1,2}일 [일월화수목금토]요일, 오늘$/);
    expect(buttons[2]).not.toHaveAccessibleName(/오늘/);
    await waitFor(() => expect(rows()).toHaveLength(12));
  });

  it('정렬 토글은 현재 상태를 aria-label에 담고 sort=newest를 쓴다', async () => {
    const user = userEvent.setup();
    const { router } = renderRoutes(routes);
    const toggle = screen.getByTestId('sort-toggle');
    expect(toggle).toHaveAccessibleName('정렬: 가까운 순. 누르면 최근 등록순으로 바뀝니다.');
    await user.click(toggle);
    expect(router.state.location.search).toBe('?sort=newest');
    expect(toggle).toHaveAccessibleName('정렬: 최근 등록순. 누르면 가까운 순으로 바뀝니다.');
    await waitFor(() => expect(rows()[0]).toHaveAttribute('href', '/meetings/seed-meeting-07'));
  });

  it('20개씩 불러오고 "모임 더 보기"로 이어 붙인다', async () => {
    const user = userEvent.setup();
    const base = createMockAdapter({ delayMs: 0 });
    const page = await base.listMeetings({}, { limit: 50, offset: 0 });
    // 25개 목록을 만들기 위해 seed를 복제
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...page.items[index % page.items.length]!,
      id: `bulk-${String(index).padStart(2, '0')}`,
    }));
    const adapter = createMockAdapter({ delayMs: 0, records: many });
    renderRoutes(routes, { adapter });

    await waitFor(() => expect(rows()).toHaveLength(20));
    expect(screen.getByTestId('meeting-count')).toHaveTextContent('25개');
    await user.click(screen.getByRole('button', { name: '모임 더 보기' }));
    await waitFor(() => expect(rows()).toHaveLength(25));
    expect(screen.queryByRole('button', { name: '모임 더 보기' })).not.toBeInTheDocument();
  });

  it('더 보기 실패 시 안내하고 다시 시도할 수 있다', async () => {
    const user = userEvent.setup();
    const base = createMockAdapter({ delayMs: 0 });
    const page = await base.listMeetings({}, { limit: 50, offset: 0 });
    const many = Array.from({ length: 22 }, (_, index) => ({
      ...page.items[index % page.items.length]!,
      id: `bulk-${String(index).padStart(2, '0')}`,
    }));
    renderRoutes(routes, { adapter: createMockAdapter({ delayMs: 0, records: many }) });
    await waitFor(() => expect(rows()).toHaveLength(20));

    __setMockFailure({ methods: ['listMeetings'], times: 1 });
    await user.click(screen.getByRole('button', { name: '모임 더 보기' }));
    expect(await screen.findByText('모임을 더 불러오지 못했어요. 다시 시도해 주세요.')).toBeInTheDocument();
    expect(rows()).toHaveLength(20);

    await user.click(screen.getByRole('button', { name: '모임 더 보기' }));
    await waitFor(() => expect(rows()).toHaveLength(22));
  });

  it('행을 누르면 상세로 이동한다', async () => {
    const user = userEvent.setup();
    const { router } = renderRoutes(routes);
    await waitFor(() => expect(rows()).toHaveLength(12));
    const first = rows()[0]!;
    const href = first.getAttribute('href');
    await user.click(first);
    expect(router.state.location.pathname).toBe(href);
    expect(await screen.findByText('상세 화면')).toBeInTheDocument();
  });
});
