import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataAdapterError } from '../../data/adapter';
import type { MeetingInput } from '../../data/types';
import { createDefaultMeetingValues, type MeetingFormValues } from '../../domain/meetingSchema';
import { addDaysToDateKey, kstDateTimeToIso, toKstDateKey } from '../../lib/date';
import { renderInRouter } from '../../test/renderWithProviders';
import { MeetingForm } from './MeetingForm';

function renderForm(options: { initial?: Partial<MeetingFormValues>; onSubmit?: (input: MeetingInput) => Promise<void> } = {}) {
  const onSubmit = vi.fn(options.onSubmit ?? (async () => {}));
  // 기본값은 실제 현재 시각 기준(내일 19:00)이라 시작 시각 규칙을 통과한다.
  const initialValues = { ...createDefaultMeetingValues(new Date()), ...options.initial };
  renderInRouter(<MeetingForm mode="create" initialValues={initialValues} onSubmit={onSubmit} cancelTo="/" />);
  return { onSubmit };
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: '전략' }));
  await user.type(screen.getByLabelText('모임 제목'), '카탄 같이 해요');
  await user.selectOptions(screen.getByLabelText('권역'), 'dunsan_tanbang');
}

describe('MeetingForm', () => {
  it('빈 폼 제출 → 필드별 오류(aria-invalid·aria-describedby)와 첫 오류(게임 장르)로 포커스', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await user.click(screen.getByRole('button', { name: '모임 만들기' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('게임 장르를 골라 주세요.')).toBeInTheDocument();
    const title = screen.getByLabelText('모임 제목');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription(expect.stringContaining('모임 제목을 입력해 주세요.'));
    expect(screen.getByLabelText('권역')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('radio', { name: '파티·캐주얼' })).toHaveFocus();
  });

  it('입력하면 해당 필드 오류가 사라진다', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: '모임 만들기' }));
    const title = screen.getByLabelText('모임 제목');
    await user.type(title, '제목');
    expect(title).not.toHaveAttribute('aria-invalid');
  });

  it('홀덤을 고르면 비금전 안내와 필수 동의가 나오고, 미동의면 그 체크로 포커스', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await user.click(screen.getByRole('radio', { name: '홀덤(비금전)' }));
    expect(screen.getByText('홀덤은 비금전 취미 모임만 열 수 있어요')).toBeInTheDocument();
    await user.type(screen.getByLabelText('모임 제목'), '칩만 쓰는 홀덤');
    await user.selectOptions(screen.getByLabelText('권역'), 'noeun_jijok');
    await user.click(screen.getByRole('button', { name: '모임 만들기' }));
    const agree = screen.getByRole('checkbox', { name: /비금전 모임으로 진행해요/ });
    expect(agree).toHaveFocus();
    expect(agree).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(agree);
    await user.click(screen.getByRole('button', { name: '모임 만들기' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ categoryId: 'holdem_social', holdemPolicyAgreed: true });
  });

  it('접힌 "추가 설정"의 필드가 첫 오류면 펼친 뒤 포커스한다', async () => {
    const user = userEvent.setup();
    renderForm({ initial: { minParticipants: '9', maxParticipants: '4' } });
    const toggle = screen.getByRole('button', { name: /추가 설정/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true'); // 기본값과 다른 최소 인원이 있으면 펼쳐서 시작
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: '모임 만들기' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const min = screen.getByLabelText('최소 인원 (모임장 포함)');
    expect(min).toHaveFocus();
    expect(min).toHaveAccessibleDescription(expect.stringContaining('최소 인원은 2명 이상, 정원 이하로 정해 주세요.'));
  });

  it('정상 제출 → KST로 해석한 시작 시각과 정규화된 입력을 보낸다(제출 중 loading)', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const date = addDaysToDateKey(toKstDateKey(new Date()), 10);
    const { onSubmit } = renderForm({
      initial: { date, time: '19:00' },
      onSubmit: () => new Promise<void>((done) => (resolve = done)),
    });
    await fillRequired(user);
    await user.type(screen.getByLabelText('게임명 (선택)'), '  카탄  ');
    await user.click(screen.getByRole('button', { name: '모임 만들기' }));
    const submit = screen.getByTestId('meeting-submit');
    expect(submit).toHaveTextContent('저장 중…');
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      categoryId: 'strategy',
      title: '카탄 같이 해요',
      gameName: '카탄',
      startAt: kstDateTimeToIso(date, '19:00'),
      regionCode: 'dunsan_tanbang',
      venueNote: null,
      maxParticipants: 6,
      minParticipants: 2,
    });
    resolve();
  });

  it('서버 검증 오류(detail=start_at)는 날짜 칸 오류로, 그 외 오류는 폼 상단 알림으로 보여준다', async () => {
    const user = userEvent.setup();
    const failures = [
      new DataAdapterError('VALIDATION_FAILED', { detail: 'start_at' }),
      new DataAdapterError('RATE_LIMITED', { detail: 'create_24h' }),
    ];
    renderForm({
      onSubmit: async () => {
        throw failures.shift();
      },
    });
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: '모임 만들기' }));
    const date = await screen.findByLabelText('날짜');
    await waitFor(() => expect(date).toHaveAttribute('aria-invalid', 'true'));
    expect(date).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '모임 만들기' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('24시간 동안 모임은 5개까지 만들 수 있어요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '모임 만들기' })).toBeEnabled();
  });

  it('정원 안내: 모임장을 포함한 전체 인원', () => {
    renderForm();
    expect(screen.getByLabelText('정원 (모임장 포함)')).toHaveAccessibleDescription('모임장을 포함한 전체 인원이에요.');
  });
});
