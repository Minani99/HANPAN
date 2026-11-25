import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Meeting } from '../../data/types';
import { renderInRouter } from '../../test/renderWithProviders';
import { MeetingRow } from './MeetingRow';

const NOW = new Date('2026-11-23T03:00:00Z');

const LONG_TITLE = '[예시] 퇴근 후 가볍게 즐기는 파티게임 모임, 초보도 환영해요';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm-1',
    hostId: 'h-1',
    hostNickname: '예시모임장',
    categoryId: 'party',
    gameName: '딕싯',
    title: LONG_TITLE,
    description: '설명',
    notice: null,
    startAt: '2026-11-28T10:00:00Z', // KST 11.28 (토) 19:00
    endAt: '2026-11-28T12:00:00Z',
    durationMinutes: 120,
    regionCode: 'dunsan_tanbang',
    venueId: null,
    venueName: null,
    venueNote: null,
    minParticipants: 4,
    maxParticipants: 8,
    confirmedCount: 5,
    pendingCount: 0,
    waitlistCount: 0,
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    cancelReason: null,
    imageUrl: null,
    createdAt: '2026-11-20T00:00:00Z',
    ...overrides,
  };
}

function renderRow(meeting: Meeting) {
  renderInRouter(
    <ul>
      <MeetingRow meeting={meeting} now={NOW} />
    </ul>,
  );
  return screen.getByTestId('meeting-row');
}

describe('MeetingRow', () => {
  it('행 전체가 상세 링크이고 안에 버튼이 없다', () => {
    const row = renderRow(makeMeeting());
    expect(row.tagName).toBe('A');
    expect(row).toHaveAttribute('href', '/meetings/m-1');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('35자 제목을 자르지 않고 렌더하며 2줄 말줄임 클래스를 쓴다', () => {
    expect(LONG_TITLE).toHaveLength(35);
    renderRow(makeMeeting());
    const title = screen.getByTestId('meeting-title');
    expect(title).toHaveTextContent(LONG_TITLE);
    expect(title).toHaveClass('line-clamp-2');
    expect(title.tagName).toBe('H3');
  });

  it('장소가 없으면 "장소 미정", 일시는 KST로 표시한다', () => {
    renderRow(makeMeeting());
    const meta = screen.getByTestId('meeting-meta');
    expect(meta).toHaveTextContent('둔산·탄방 · 장소 미정');
    expect(meta).toHaveTextContent('11.28 (토) · 19:00');
    expect(within(meta).getByText('11.28 (토) · 19:00')).toHaveAttribute('datetime', '2026-11-28T10:00:00Z');
  });

  it('긴 장소명도 그대로 보여준다', () => {
    renderRow(makeMeeting({ venueName: '보드게임 카페 A 둔산점 2층 단체석 안쪽 넓은 테이블' }));
    expect(screen.getByTestId('meeting-meta')).toHaveTextContent('보드게임 카페 A 둔산점 2층 단체석 안쪽 넓은 테이블');
  });

  it('이미지가 없으면 장르 플레이스홀더(장식)를 쓴다', () => {
    const row = renderRow(makeMeeting({ categoryId: 'holdem_social' }));
    expect(row.querySelector('img')).toBeNull();
    const placeholder = row.querySelector('[data-category="holdem_social"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(within(row).getByText('홀덤(비금전)')).toBeInTheDocument();
  });

  it('이미지가 있으면 장식 이미지(alt="")로 보여준다', () => {
    const row = renderRow(makeMeeting({ imageUrl: '/images/sample.jpg' }));
    const img = row.querySelector('img');
    expect(img).toHaveAttribute('src', '/images/sample.jpg');
    expect(img).toHaveAttribute('alt', '');
  });

  it('모집 중: 인원과 남은 자리, 참여 조건을 보여준다', () => {
    renderRow(makeMeeting());
    const availability = screen.getByTestId('meeting-availability');
    expect(availability).toHaveTextContent('5/8명');
    expect(availability).toHaveTextContent('3자리 남음');
    expect(availability).toHaveTextContent('확정 5명, 정원 8명');
    expect(screen.getByText('초보 환영')).toBeInTheDocument();
  });

  it('최소 인원 미달이면 배지를 함께 보여준다', () => {
    renderRow(makeMeeting({ confirmedCount: 2, minParticipants: 4 }));
    const availability = screen.getByTestId('meeting-availability');
    expect(availability).toHaveTextContent('6자리 남음');
    expect(within(availability).getByText('최소 인원 모집 중')).toBeInTheDocument();
  });

  it('정원이 차면 "정원 마감" 배지 (대기 가능 여부 표시)', () => {
    renderRow(makeMeeting({ confirmedCount: 8, allowWaitlist: true }));
    const availability = screen.getByTestId('meeting-availability');
    expect(availability).toHaveAttribute('data-phase', 'full');
    expect(within(availability).getByText('정원 마감')).toBeInTheDocument();
    expect(availability).toHaveTextContent('대기 신청 가능');
    expect(availability).not.toHaveTextContent('자리 남음');
  });

  it('모임장이 마감하면 "모집 마감" 배지', () => {
    renderRow(makeMeeting({ status: 'closed', approvalMode: 'manual' }));
    expect(within(screen.getByTestId('meeting-availability')).getByText('모집 마감')).toBeInTheDocument();
    expect(screen.getByText('초보 환영 · 승인제')).toBeInTheDocument();
  });
});
