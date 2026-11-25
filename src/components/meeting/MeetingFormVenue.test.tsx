import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MeetingInput, Venue } from '../../data/types';
import { createDefaultMeetingValues, type MeetingFormValues } from '../../domain/meetingSchema';
import { renderInRouter } from '../../test/renderWithProviders';
import { MeetingForm } from './MeetingForm';

function venue(id: string, name: string, regionCode: Venue['regionCode']): Venue {
  return {
    id,
    name,
    regionCode,
    address: `${name} 예시 주소`,
    venueType: 'board_game_cafe',
    websiteUrl: null,
    bookingUrl: null,
    description: '',
    isPublic: true,
    infoVerifiedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

const VENUES = [venue('v-a', '둔산 카페', 'dunsan_tanbang'), venue('v-b', '궁동 카페', 'gung_bongmyeong')];

function renderForm(
  options: {
    mode?: 'create' | 'edit';
    initial?: Partial<MeetingFormValues>;
    venueName?: string | null;
    activeCategoryIds?: ReadonlySet<string>;
  } = {},
) {
  const onSubmit = vi.fn(async (_input: MeetingInput) => {});
  const initialValues = { ...createDefaultMeetingValues(new Date()), ...options.initial };
  renderInRouter(
    <MeetingForm
      mode={options.mode ?? 'create'}
      initialValues={initialValues}
      venues={VENUES}
      venueName={options.venueName}
      activeCategoryIds={options.activeCategoryIds}
      onSubmit={onSubmit}
      cancelTo="/"
    />,
  );
  return { onSubmit };
}

describe('MeetingForm 공간 선택', () => {
  it('권역을 고르기 전에는 비활성, 고르면 그 권역의 공개 공간만 선택지(기본 "장소 미정")', async () => {
    const user = userEvent.setup();
    renderForm();
    const select = screen.getByLabelText('공간 (선택)');
    expect(select).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('권역'), 'dunsan_tanbang');
    expect(select).toBeEnabled();
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['장소 미정', '둔산 카페']);
    expect(select).toHaveValue('');
  });

  it('공간을 고르고 제출하면 venueId가 들어가고, 권역을 바꾸면 선택이 풀린다(권역 일치 규칙)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await user.click(screen.getByRole('radio', { name: '전략' }));
    await user.type(screen.getByLabelText('모임 제목'), '카탄 같이 해요');
    await user.selectOptions(screen.getByLabelText('권역'), 'dunsan_tanbang');
    await user.selectOptions(screen.getByLabelText('공간 (선택)'), 'v-a');
    expect(screen.getByLabelText('공간 (선택)')).toHaveAccessibleDescription(expect.stringContaining('둔산 카페 예시 주소'));

    await user.selectOptions(screen.getByLabelText('권역'), 'gung_bongmyeong');
    expect(screen.getByLabelText('공간 (선택)')).toHaveValue('');
    await user.selectOptions(screen.getByLabelText('공간 (선택)'), 'v-b');
    await user.click(screen.getByRole('button', { name: '모임 만들기' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ regionCode: 'gung_bongmyeong', venueId: 'v-b' });
  });

  it('목록에 없는 공간(비공개 등)을 새로 고른 값은 제출 전에 막는다', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm({
      initial: { categoryId: 'strategy', title: '제목 있음', regionCode: 'dunsan_tanbang', venueId: 'v-gone' },
    });
    await user.click(screen.getByRole('button', { name: '모임 만들기' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/선택한 공간을 지금은 고를 수 없어요/)).toBeInTheDocument();
  });

  it('수정: 비공개로 바뀐 원래 공간은 "현재 연결된 공간"으로 그대로 둘 수 있다', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm({
      mode: 'edit',
      venueName: null,
      initial: { categoryId: 'strategy', title: '제목 있음', regionCode: 'dunsan_tanbang', venueId: 'v-private' },
    });
    const select = screen.getByLabelText('공간 (선택)');
    expect(select).toHaveValue('v-private');
    expect(within(select).getByRole('option', { name: '등록된 공간 (현재 연결된 공간)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '수정 내용 저장' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ venueId: 'v-private' });
  });

  it('비활성 카테고리는 새로 고를 수 없다(수정 중인 모임의 기존 카테고리는 남긴다)', () => {
    renderForm({ activeCategoryIds: new Set(['party', 'strategy']) });
    expect(screen.getByRole('radio', { name: '파티·캐주얼' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '마작·기타' })).not.toBeInTheDocument();
  });
});
