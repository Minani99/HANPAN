import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setMockFailure, createMockAdapter } from '../data/mock/adapter';
import { createSeedDb, DEV_ACCOUNT_IDS } from '../data/mock/seed';
import { createUnconfiguredAdapter } from '../data/unconfigured';
import { RETURN_TO_STORAGE_KEY } from '../lib/returnTo';
import { renderRoutes } from '../test/renderWithProviders';
import { MeetingDetailPage } from './MeetingDetailPage';

const routes: RouteObject[] = [
  { path: '/', element: <p>홈 화면</p> },
  { path: '/login', element: <p>로그인 화면</p> },
  { path: '/profile', element: <p>프로필 화면</p> },
  { path: '/meetings/:id', Component: MeetingDetailPage },
  { path: '/meetings/:id/participants', element: <p>참가자 관리 화면</p> },
  { path: '/meetings/:id/edit', element: <p>수정 화면</p> },
];

function renderDetail(id: string, sessionUserId: string | null = null, adapter = createMockAdapter({ delayMs: 0, persist: false, sessionUserId })) {
  const result = renderRoutes(routes, { initialEntries: [`/meetings/${id}`], adapter });
  return { ...result, adapter };
}

async function findCta() {
  return screen.findByTestId('detail-cta-content');
}

afterEach(() => {
  __setMockFailure(null);
  window.sessionStorage.clear();
});

describe('MeetingDetailPage CTA 상태', () => {
  it('비로그인: 내용은 공개, "로그인하고 신청하기"를 누르면 returnTo를 저장하고 /login', async () => {
    const user = userEvent.setup();
    const { router } = renderDetail('seed-meeting-01');
    expect(await screen.findByRole('heading', { level: 1, name: '[예시] 퇴근하고 코드네임 한 판' })).toBeInTheDocument();
    expect(screen.getByTestId('meeting-info')).toHaveTextContent('둔산·탄방 · 보드게임 카페 A');
    expect(screen.getByTestId('meeting-description')).toHaveTextContent('코드네임');
    const cta = await findCta();
    expect(cta).toHaveAttribute('data-kind', 'login');
    await user.click(within(cta).getByRole('link', { name: '로그인하고 신청하기' }));
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/meetings/seed-meeting-01');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('신청 가능: 바로 확정 / 승인제 문구', async () => {
    renderDetail('seed-meeting-01', DEV_ACCOUNT_IDS.userB);
    const cta = await findCta();
    expect(within(cta).getByRole('button', { name: '참가 신청하기' })).toBeEnabled();
    expect(cta).toHaveTextContent('신청하면 바로 참가가 확정돼요.');
  });

  it('신청 가능(승인제)', async () => {
    renderDetail('seed-meeting-13', DEV_ACCOUNT_IDS.userB);
    const cta = await findCta();
    expect(within(cta).getByRole('button', { name: '참가 신청하기 (승인제)' })).toBeInTheDocument();
    expect(cta).toHaveTextContent('모임장이 확인한 뒤 확정돼요.');
  });

  it('확정: 상태 "참가 확정" + 보조 "신청 취소"', async () => {
    renderDetail('seed-meeting-02', DEV_ACCOUNT_IDS.hostA);
    const cta = await findCta();
    expect(within(cta).getByTestId('cta-status')).toHaveTextContent('참가 확정');
    expect(within(cta).getByRole('button', { name: '신청 취소' })).toBeInTheDocument();
    expect(within(cta).queryByRole('button', { name: /참가 신청/ })).not.toBeInTheDocument();
  });

  it('대기 중: 자동 확정을 약속하지 않는다', async () => {
    renderDetail('seed-meeting-03', DEV_ACCOUNT_IDS.hostA);
    const cta = await findCta();
    expect(within(cta).getByTestId('cta-status')).toHaveTextContent('대기 중');
    expect(cta).toHaveTextContent('자리가 나면 모임장이 확인 후 확정해요. 자동으로 확정되지 않아요.');
  });

  it('모집 마감: 비활성(포커스 유지) + 사유를 aria-describedby로 연결', async () => {
    renderDetail('seed-meeting-09', DEV_ACCOUNT_IDS.userB);
    const cta = await findCta();
    const button = within(cta).getByRole('button', { name: '모집 마감' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription('모임장이 모집을 마감했어요.');
  });

  it('정원 마감(대기 불가)', async () => {
    const db = createSeedDb(new Date());
    db.meetings = db.meetings.map((m) => (m.id === 'seed-meeting-05' ? { ...m, maxParticipants: 1 } : m));
    renderDetail('seed-meeting-05', DEV_ACCOUNT_IDS.userB, createMockAdapter({ delayMs: 0, persist: false, db, sessionUserId: DEV_ACCOUNT_IDS.userB }));
    const cta = await findCta();
    expect(within(cta).getByRole('button', { name: '모집 마감' })).toHaveAccessibleDescription('자리가 모두 찼어요.');
  });

  it('취소된 모임: 비활성 + 취소 사유', async () => {
    renderDetail('seed-meeting-10', DEV_ACCOUNT_IDS.userB);
    const cta = await findCta();
    expect(within(cta).getByRole('button', { name: '취소된 모임' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('cancelled-notice')).toHaveTextContent('취소 사유: 모임장 사정으로 취소되었어요.');
  });

  it('본인 모임: "참가자 관리" + "모임 수정", 신고 버튼 없음', async () => {
    renderDetail('seed-meeting-13', DEV_ACCOUNT_IDS.hostA);
    const cta = await findCta();
    expect(within(cta).getByRole('link', { name: '참가자 관리' })).toHaveAttribute('href', '/meetings/seed-meeting-13/participants');
    expect(within(cta).getByRole('link', { name: '모임 수정' })).toHaveAttribute('href', '/meetings/seed-meeting-13/edit');
    expect(screen.queryByRole('button', { name: '신고하기' })).not.toBeInTheDocument();
  });

  it('최초 설정 전: "닉네임 설정하고 신청하기"', async () => {
    renderDetail('seed-meeting-01', DEV_ACCOUNT_IDS.newcomer);
    const cta = await findCta();
    expect(within(cta).getByRole('link', { name: '닉네임 설정하고 신청하기' })).toHaveAttribute('href', '/profile?onboarding=1');
  });

  it('없는 모임은 404 안내, 서비스 설정 전에도 가짜 데이터 없이 404', async () => {
    renderDetail('no-such-meeting', DEV_ACCOUNT_IDS.userB);
    expect(await screen.findByRole('heading', { level: 1, name: '모임을 찾을 수 없어요.' })).toBeInTheDocument();
  });

  it('서비스 설정 전(unconfigured)에는 모임이 없다', async () => {
    renderDetail('seed-meeting-01', null, createUnconfiguredAdapter() as never);
    expect(await screen.findByRole('heading', { level: 1, name: '모임을 찾을 수 없어요.' })).toBeInTheDocument();
  });

  it('홀덤 모임은 비금전 안내를 보여주고, 소개·유의사항은 줄바꿈을 보존하며 링크로 바꾸지 않는다', async () => {
    const db = createSeedDb(new Date());
    db.meetings = db.meetings.map((m) =>
      m.id === 'seed-meeting-06' ? { ...m, description: '첫 줄\nhttps://example.com 참고', notice: '<b>굵게</b>' } : m,
    );
    renderDetail('seed-meeting-06', null, createMockAdapter({ delayMs: 0, persist: false, db }));
    expect(await screen.findByTestId('holdem-notice')).toHaveTextContent('베팅·환전·상금·경품을 걸 수 없어요.');
    const description = screen.getByTestId('meeting-description');
    expect(description).toHaveClass('whitespace-pre-wrap');
    expect(description.textContent).toBe('첫 줄\nhttps://example.com 참고');
    expect(within(description).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('meeting-notice').textContent).toBe('<b>굵게</b>');
    expect(screen.getByTestId('meeting-notice').querySelector('b')).toBeNull();
  });

  it('사진이 없으면 큰 배너 대신 목록과 같은 작은 장르 플레이스홀더(장식)를 제목 옆에 둔다', async () => {
    renderDetail('seed-meeting-06');
    const thumbnail = await screen.findByTestId('detail-thumbnail');
    expect(thumbnail).toHaveClass('h-[96px]', 'w-[86px]', 'md:h-[105px]', 'md:w-[183px]');
    const placeholder = thumbnail.querySelector('[data-category="holdem_social"]');
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img', { name: /기본 이미지/ })).not.toBeInTheDocument();
    expect(document.querySelector('[class*="aspect-[16/"]')).toBeNull();
  });

  it('모임장 계정이 삭제된 모임(hostId null): 모임장 행에 "탈퇴한 사용자", 신청 대신 마감 안내', async () => {
    const db = createSeedDb(new Date());
    db.meetings = db.meetings.map((m) => (m.id === 'seed-meeting-01' ? { ...m, hostId: null, hostNickname: null } : m));
    renderDetail('seed-meeting-01', DEV_ACCOUNT_IDS.userB, createMockAdapter({ delayMs: 0, persist: false, db, sessionUserId: DEV_ACCOUNT_IDS.userB }));
    const cta = await findCta();
    expect(screen.getByTestId('meeting-info')).toHaveTextContent('모임장탈퇴한 사용자');
    expect(cta).toHaveAttribute('data-kind', 'closed');
    expect(within(cta).getByRole('button', { name: '모집 마감' })).toHaveAccessibleDescription('모임장이 탈퇴해 신청을 받지 않아요.');
  });
});

describe('MeetingDetailPage 신청·취소', () => {
  it('신청 성공 → 상태가 "참가 확정"으로 바뀌고 안내 토스트', async () => {
    const user = userEvent.setup();
    renderDetail('seed-meeting-01', DEV_ACCOUNT_IDS.userB);
    await user.click(within(await findCta()).getByRole('button', { name: '참가 신청하기' }));
    const dialog = screen.getByRole('dialog', { name: '참가 신청' });
    await user.type(within(dialog).getByLabelText('모임장에게 남길 말 (선택)'), '잘 부탁드려요');
    await user.click(within(dialog).getByRole('button', { name: '신청하기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(await findCta()).getByTestId('cta-status')).toHaveTextContent('참가 확정');
    expect(screen.getByRole('status')).toHaveTextContent('참가가 확정됐어요.');
    expect(screen.getByTestId('people-summary')).toHaveTextContent('3/6명');
  });

  it('신청 실패 → 오류 문구, CTA는 원래 상태로 유지, 다시 시도하면 성공', async () => {
    const user = userEvent.setup();
    renderDetail('seed-meeting-01', DEV_ACCOUNT_IDS.userB);
    __setMockFailure({ methods: ['applyToMeeting'], times: 1, code: 'NETWORK_ERROR' });
    await user.click(within(await findCta()).getByRole('button', { name: '참가 신청하기' }));
    const dialog = screen.getByRole('dialog', { name: '참가 신청' });
    await user.click(within(dialog).getByRole('button', { name: '신청하기' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('연결이 불안정해요. 잠시 후 다시 시도해 주세요.');
    const submit = within(dialog).getByRole('button', { name: '신청하기' });
    expect(submit).toBeEnabled();
    expect(submit).not.toHaveAttribute('aria-busy');

    await user.click(within(dialog).getAllByRole('button', { name: '닫기' })[0]!);
    const cta = await findCta();
    expect(cta).toHaveAttribute('data-kind', 'apply');
    expect(screen.getByTestId('people-summary')).toHaveTextContent('2/6명');

    await user.click(within(cta).getByRole('button', { name: '참가 신청하기' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '신청하기' }));
    await waitFor(() => expect(screen.getByTestId('detail-cta-content')).toHaveAttribute('data-kind', 'confirmed'));
  });

  it('규칙 오류(MEETING_FULL)도 코드별 문구로 안내한다', async () => {
    const user = userEvent.setup();
    renderDetail('seed-meeting-01', DEV_ACCOUNT_IDS.userB);
    __setMockFailure({ methods: ['applyToMeeting'], times: 1, code: 'MEETING_FULL' });
    await user.click(within(await findCta()).getByRole('button', { name: '참가 신청하기' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '신청하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('자리가 모두 찼어요.');
  });

  it('신청하기 더블클릭 → 요청은 1회만', async () => {
    const user = userEvent.setup();
    const adapter = createMockAdapter({ delayMs: 20, persist: false, sessionUserId: DEV_ACCOUNT_IDS.userB });
    const spy = vi.spyOn(adapter, 'applyToMeeting');
    renderDetail('seed-meeting-01', DEV_ACCOUNT_IDS.userB, adapter);
    await user.click(within(await findCta()).getByRole('button', { name: '참가 신청하기' }));
    const submit = within(screen.getByRole('dialog')).getByTestId('apply-submit');
    await user.dblClick(submit);
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(submit).toHaveTextContent('신청 중…');
    await waitFor(() => expect(screen.getByTestId('detail-cta-content')).toHaveAttribute('data-kind', 'confirmed'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('신청 취소: 확인 대화상자 → 다시 신청 가능 상태', async () => {
    const user = userEvent.setup();
    renderDetail('seed-meeting-02', DEV_ACCOUNT_IDS.hostA);
    await user.click(within(await findCta()).getByRole('button', { name: '신청 취소' }));
    const dialog = screen.getByRole('dialog', { name: '신청을 취소할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '신청 취소하기' }));
    await waitFor(() => expect(screen.getByTestId('detail-cta-content')).toHaveAttribute('data-kind', 'apply'));
    expect(screen.getByRole('status')).toHaveTextContent('신청을 취소했어요.');
  });

  it('공유: Web Share API가 없으면 링크를 복사하고 안내한다', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDetail('seed-meeting-01');
    await user.click(await screen.findByRole('button', { name: '공유하기' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/meetings/seed-meeting-01`);
    expect(screen.getByRole('status')).toHaveTextContent('링크를 복사했어요.');
  });

  it('신고: 대상(이 모임/모임장) 선택 → 사유 → 접수되면 토스트, 같은 대상 재신고는 중복 안내', async () => {
    const user = userEvent.setup();
    const { adapter } = renderDetail('seed-meeting-01', DEV_ACCOUNT_IDS.userB);
    await user.click(await screen.findByRole('button', { name: '신고하기' }));
    let dialog = screen.getByRole('dialog', { name: '신고하기' });
    expect(dialog).toHaveTextContent('신고는 운영자가 직접 검토해요. 신고만으로 자동 제재되지 않아요.');
    expect(within(dialog).getByRole('radio', { name: '이 모임' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: '모임장 예시모임장A' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: '스팸·광고' }));
    await user.click(within(dialog).getByRole('button', { name: '신고하기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('신고가 접수됐어요');
    expect((adapter as ReturnType<typeof createMockAdapter>).snapshot().reports.filter((r) => r.reporterId === DEV_ACCOUNT_IDS.userB)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '신고하기' }));
    dialog = screen.getByRole('dialog', { name: '신고하기' });
    await user.click(within(dialog).getByRole('radio', { name: '부적절한 내용' }));
    await user.click(within(dialog).getByRole('button', { name: '신고하기' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('이미 접수된 신고가 있어요.');
  });

  it('신고: 비로그인이면 returnTo를 저장하고 로그인으로', async () => {
    const user = userEvent.setup();
    const { router } = renderDetail('seed-meeting-01');
    await user.click(await screen.findByRole('button', { name: '신고하기' }));
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/meetings/seed-meeting-01');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('공간: 공개 공간에 연결된 모임은 장소명이 공간 상세 링크, 예약 링크는 bookingUrl이 있을 때만(외부·새 창)', async () => {
    renderDetail('seed-meeting-01');
    const venueLink = await screen.findByTestId('meeting-venue-link');
    expect(venueLink).toHaveAttribute('href', '/venues/seed-venue-01');
    const booking = screen.getByTestId('meeting-venue-booking');
    expect(booking).toHaveAttribute('href', 'https://example.com/venues/a/booking');
    expect(booking).toHaveAttribute('target', '_blank');
    expect(booking).toHaveAttribute('rel', 'noopener noreferrer');
    expect(booking).toHaveTextContent('예약 페이지(외부)');
  });

  it('공간: bookingUrl이 없는 공간이면 예약 링크를 만들지 않는다', async () => {
    renderDetail('seed-meeting-02');
    expect(await screen.findByTestId('meeting-venue')).toHaveTextContent('보드게임 카페 B');
    expect(screen.queryByTestId('meeting-venue-booking')).not.toBeInTheDocument();
  });
});
