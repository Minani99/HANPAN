import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { MeetingInput, Venue } from '../../data/types';
import { CATEGORIES } from '../../domain/categories';
import { getErrorMessage } from '../../domain/errorMessages';
import { MEETING_LIMITS as L, charLength } from '../../domain/limits';
import {
  ADVANCED_MEETING_FIELDS,
  HOLDEM_CATEGORY_ID,
  durationOptions,
  firstErrorField,
  mapServerErrorToField,
  participantOptions,
  selectableDateRange,
  startMsFromForm,
  timeOptions,
  validateMeetingForm,
  type MeetingFormErrors,
  type MeetingFormField,
  type MeetingFormValues,
} from '../../domain/meetingSchema';
import { REGIONS } from '../../domain/regions';
import { SKILL_LEVEL_LABEL } from '../../domain/skillLevels';
import { VENUE_TYPE_LABEL } from '../../domain/venues';
import { formatDuration } from '../../lib/date';
import { focusFormField } from '../../lib/focusField';
import { Button, ButtonLink } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { ChoiceGroup, type ChoiceOption } from '../ui/ChoiceGroup';
import { Icon } from '../ui/Icon';
import { Notice } from '../ui/Notice';
import { Select } from '../ui/Select';
import { TextField } from '../ui/TextField';
import { Textarea } from '../ui/Textarea';
import type { ApprovalMode, CategoryId, RegionCode, SkillLevel } from '../../data/types';

const CATEGORY_OPTIONS: readonly ChoiceOption<CategoryId>[] = CATEGORIES.map((category) => ({
  value: category.id,
  label: category.name,
}));

const SKILL_OPTIONS: readonly ChoiceOption<SkillLevel>[] = (
  ['beginner_welcome', 'anyone', 'experienced'] as const
).map((value) => ({ value, label: SKILL_LEVEL_LABEL[value] }));

const APPROVAL_OPTIONS: readonly ChoiceOption<ApprovalMode>[] = [
  { value: 'auto', label: '바로 확정', description: '신청하면 바로 참가가 확정돼요.' },
  { value: 'manual', label: '승인제', description: '신청을 받은 뒤 내가 확인하고 확정해요.' },
];

const DURATION_OPTIONS = durationOptions();
const PARTICIPANT_OPTIONS = participantOptions();

export interface MeetingFormProps {
  mode: 'create' | 'edit';
  initialValues: MeetingFormValues;
  /** 수정: 원래 시작 시각(바뀐 경우에만 30분~90일 규칙) */
  originalStartAt?: string;
  /** 수정: 현재 확정 인원(모임장 포함) */
  confirmedCount?: number;
  /** 수정: 원래 연결된 공간 이름(비공개로 바뀌었으면 null) */
  venueName?: string | null;
  /** 공개 공간 목록(listVenues). 선택한 권역의 공간만 선택지로 보여준다 */
  venues?: readonly Venue[];
  /** 공간 목록을 불러오지 못했을 때(장소 미정·장소 메모만 쓸 수 있다고 안내) */
  venuesUnavailable?: boolean;
  /** 활성 카테고리(listCategories). 비활성 카테고리는 새로 고를 수 없다(기존 값은 유지). 없으면 전체 */
  activeCategoryIds?: ReadonlySet<string>;
  /** 서버 요청. 실패하면 throw → 필드/폼 오류로 보여준다 */
  onSubmit: (input: MeetingInput) => Promise<void>;
  /** 취소 링크 경로 */
  cancelTo: string;
  /** 폼 위 안내(수정 화면의 알림 안내 등) */
  intro?: ReactNode;
}

function Section({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={first ? 'pt-2' : 'mt-9 border-t border-border pt-7'}>
      <h2 id={id} className="text-lg leading-snug font-heavy text-ink">
        {title}
      </h2>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

function counter(value: string, max: number): string {
  return `${charLength(value.trim())}/${max}자`;
}

/**
 * 모임 만들기·수정 공용 폼. 상세 화면과 같은 버튼·입력 컴포넌트를 쓴다.
 * - 필수 항목을 먼저, 최소 인원·대기 허용·유의사항은 '추가 설정'(접힘)
 * - 제출 시 클라이언트 검증(Zod, 서버와 같은 규칙) → 첫 오류 필드로 포커스
 * - 서버 오류 코드는 해당 필드 오류 또는 폼 오류로 바꿔 보여준다
 */
export function MeetingForm({
  mode,
  initialValues,
  originalStartAt,
  confirmedCount,
  venueName,
  venues = [],
  venuesUnavailable = false,
  activeCategoryIds,
  onSubmit,
  cancelTo,
  intro,
}: MeetingFormProps) {
  const [values, setValues] = useState<MeetingFormValues>(initialValues);
  // 수정: 원래 연결된 공간(공개 목록에 없으면 비공개로 바뀐 공간 — 그대로 두는 것은 서버도 허용)
  const originalVenue =
    mode === 'edit' && initialValues.venueId && initialValues.regionCode
      ? { venueId: initialValues.venueId, regionCode: initialValues.regionCode }
      : undefined;
  const categoryOptions = activeCategoryIds
    ? CATEGORY_OPTIONS.filter((option) => activeCategoryIds.has(option.value) || option.value === initialValues.categoryId)
    : CATEGORY_OPTIONS;
  const [errors, setErrors] = useState<MeetingFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(
    () => initialValues.notice.trim() !== '' || initialValues.minParticipants !== '2' || !initialValues.allowWaitlist,
  );
  const [mountedAt] = useState(() => new Date());
  const dateRange = selectableDateRange(mountedAt);
  const advancedId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const RELATED: Partial<Record<MeetingFormField, MeetingFormField[]>> = {
    date: ['time'],
    time: ['date'],
    minParticipants: ['maxParticipants'],
    maxParticipants: ['minParticipants'],
    categoryId: ['holdemPolicyAgreed'],
  };

  const set = <K extends MeetingFormField>(field: K, value: MeetingFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const related = [field, ...(RELATED[field] ?? [])];
      if (!related.some((key) => prev[key])) return prev;
      const next = { ...prev };
      for (const key of related) delete next[key];
      return next;
    });
  };

  const focusField = (field: MeetingFormField) => {
    if (ADVANCED_MEETING_FIELDS.has(field) && !advancedOpen) {
      flushSync(() => setAdvancedOpen(true));
    }
    focusFormField(formRef.current, field);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    const context = {
      now: new Date(),
      ...(originalStartAt ? { originalStartAt } : {}),
      ...(confirmedCount !== undefined ? { confirmedCount } : {}),
      venueSelection: { venues, ...(originalVenue ? { original: originalVenue } : {}) },
    };
    const result = validateMeetingForm(values, context);
    if (!result.ok) {
      flushSync(() => setErrors(result.errors));
      const first = firstErrorField(result.errors);
      if (first) focusField(first);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit(result.input);
    } catch (error) {
      const mapped = mapServerErrorToField(error, confirmedCount);
      if (mapped) {
        flushSync(() => setErrors({ [mapped.field]: mapped.message }));
        focusField(mapped.field);
      } else {
        flushSync(() => setFormError(getErrorMessage(error)));
        formErrorRef.current?.focus();
      }
      setSubmitting(false);
    }
  };

  /** 권역을 바꾸면 그 권역에 없는 공간 선택은 풀어 준다(서버 규칙: 공간-권역 일치) */
  const changeRegion = (regionCode: RegionCode | '') => {
    set('regionCode', regionCode);
    setValues((prev) => {
      if (!prev.venueId) return prev;
      const venue = venues.find((item) => item.id === prev.venueId);
      const keepsOriginal = originalVenue?.venueId === prev.venueId && originalVenue.regionCode === regionCode;
      if ((venue && venue.regionCode === regionCode) || keepsOriginal) return prev;
      return { ...prev, venueId: null };
    });
    setErrors((prev) => {
      if (!prev.venueId) return prev;
      const next = { ...prev };
      delete next.venueId;
      return next;
    });
  };

  const regionVenues = values.regionCode ? venues.filter((venue) => venue.regionCode === values.regionCode) : [];
  const showOriginalVenueOption =
    originalVenue !== undefined && !venues.some((venue) => venue.id === originalVenue.venueId) && values.regionCode === originalVenue.regionCode;
  const selectedVenue = venues.find((venue) => venue.id === values.venueId) ?? null;

  const isHoldem = values.categoryId === HOLDEM_CATEGORY_ID;
  const startMs = startMsFromForm(values.date, values.time);
  const startChanged =
    mode === 'edit' && originalStartAt !== undefined && startMs !== null && startMs !== Date.parse(originalStartAt);

  return (
    <form ref={formRef} noValidate onSubmit={handleSubmit} className="max-w-2xl" data-testid="meeting-form">
      {intro}

      {formError ? (
        <div ref={formErrorRef} tabIndex={-1} className="mb-6 focus-visible:outline-none">
          <Notice tone="danger" role="alert" title="저장하지 못했어요">
            {formError}
          </Notice>
        </div>
      ) : null}

      <Section title="무엇을 하나요" first>
        <ChoiceGroup
          legend="게임 장르"
          name="categoryId"
          options={categoryOptions}
          value={values.categoryId}
          onChange={(value) => set('categoryId', value)}
          error={errors.categoryId}
          fieldName="categoryId"
          required
        />
        {isHoldem ? (
          <div className="space-y-3">
            <Notice tone="info" title="홀덤은 비금전 취미 모임만 열 수 있어요">
              베팅·환전·상금·경품을 걸 수 없어요. 칩은 점수 표시용으로만 써 주세요. 위반하면 운영 정책에 따라 모임이 숨김
              처리될 수 있어요.
            </Notice>
            <Checkbox
              data-field="holdemPolicyAgreed"
              label="베팅·환전·상금·경품이 없는 비금전 모임으로 진행해요 (필수)"
              checked={values.holdemPolicyAgreed}
              onChange={(event) => set('holdemPolicyAgreed', event.target.checked)}
              error={errors.holdemPolicyAgreed}
            />
          </div>
        ) : null}
        <TextField
          data-field="gameName"
          label="게임명 (선택)"
          value={values.gameName}
          onChange={(event) => set('gameName', event.target.value)}
          maxLength={L.gameNameMax}
          placeholder="예: 아발론, 코드네임"
          hint={`${counter(values.gameName, L.gameNameMax)} · 정하지 않았다면 비워 두세요.`}
          error={errors.gameName}
          autoComplete="off"
        />
        <TextField
          data-field="title"
          label="모임 제목"
          value={values.title}
          onChange={(event) => set('title', event.target.value)}
          maxLength={L.titleMax}
          placeholder="예: 토요일 저녁 아발론 한 판"
          hint={counter(values.title, L.titleMax)}
          error={errors.title}
          autoComplete="off"
          required
        />
      </Section>

      <Section title="언제 하나요">
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">
          <TextField
            data-field="date"
            type="date"
            label="날짜"
            value={values.date}
            min={dateRange.min}
            max={dateRange.max}
            onChange={(event) => set('date', event.target.value)}
            error={errors.date}
            required
          />
          <Select
            data-field="time"
            label="시작 시간"
            value={values.time}
            onChange={(event) => set('time', event.target.value)}
            error={errors.time}
            required
          >
            {timeOptions(initialValues.time).map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </Select>
        </div>
        <p className="-mt-2 text-sm text-muted">한국 시간 기준이에요. 지금부터 30분 뒤부터 90일 안까지 정할 수 있어요.</p>
        {startChanged ? (
          <Notice tone="warning" data-testid="start-changed-notice">
            시작 시각을 바꿔도 참가자에게 자동 알림이 가지 않아요. 바뀐 일정은 참가자에게 따로 알려 주세요.
          </Notice>
        ) : null}
        <Select
          data-field="durationMinutes"
          label="예상 소요 시간"
          value={values.durationMinutes}
          onChange={(event) => set('durationMinutes', event.target.value)}
          error={errors.durationMinutes}
          required
        >
          {DURATION_OPTIONS.map((minutes) => (
            <option key={minutes} value={String(minutes)}>
              {formatDuration(minutes)}
            </option>
          ))}
        </Select>
      </Section>

      <Section title="어디서 하나요">
        <Select
          data-field="regionCode"
          label="권역"
          value={values.regionCode}
          onChange={(event) => changeRegion(event.target.value as RegionCode | '')}
          error={errors.regionCode}
          required
        >
          <option value="">권역을 골라 주세요</option>
          {REGIONS.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </Select>
        <Select
          data-field="venueId"
          label="공간 (선택)"
          value={values.venueId ?? ''}
          onChange={(event) => set('venueId', event.target.value === '' ? null : event.target.value)}
          disabled={!values.regionCode}
          hint={
            !values.regionCode
              ? '권역을 먼저 고르면 그 권역에 등록된 공간을 고를 수 있어요.'
              : venuesUnavailable
                ? '공간 목록을 불러오지 못했어요. 장소 미정으로 두고 장소 메모를 써 주세요.'
                : selectedVenue
                  ? `${VENUE_TYPE_LABEL[selectedVenue.venueType]} · ${selectedVenue.address}`
                  : regionVenues.length === 0
                    ? '이 권역에 등록된 공간이 아직 없어요. 장소 미정으로 두고 장소 메모를 써 주세요.'
                    : '운영자가 확인한 공개 공간만 고를 수 있어요. 예약은 공간에 직접 해 주세요.'
          }
          error={errors.venueId}
        >
          <option value="">장소 미정</option>
          {showOriginalVenueOption && originalVenue ? (
            <option value={originalVenue.venueId}>{venueName ?? '등록된 공간'} (현재 연결된 공간)</option>
          ) : null}
          {regionVenues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </Select>
        <TextField
          data-field="venueNote"
          label="장소 메모 (선택)"
          value={values.venueNote}
          onChange={(event) => set('venueNote', event.target.value)}
          maxLength={L.venueNoteMax}
          placeholder="예: 둔산동 보드게임 카페 중 한 곳"
          hint={`${counter(values.venueNote, L.venueNoteMax)} · 비워 두면 '장소 미정'으로 보여요.`}
          error={errors.venueNote}
          autoComplete="off"
        />
      </Section>

      <Section title="누구와 하나요">
        <Select
          data-field="maxParticipants"
          label="정원 (모임장 포함)"
          value={values.maxParticipants}
          onChange={(event) => set('maxParticipants', event.target.value)}
          hint={
            confirmedCount !== undefined
              ? `모임장을 포함한 전체 인원이에요. 현재 확정 인원 ${confirmedCount}명보다 적게 줄일 수 없어요.`
              : '모임장을 포함한 전체 인원이에요.'
          }
          error={errors.maxParticipants}
          required
        >
          {PARTICIPANT_OPTIONS.map((count) => (
            <option key={count} value={String(count)}>
              {count}명
            </option>
          ))}
        </Select>
        <ChoiceGroup
          legend="진행 수준"
          name="skillLevel"
          options={SKILL_OPTIONS}
          value={values.skillLevel}
          onChange={(value) => set('skillLevel', value)}
          error={errors.skillLevel}
          fieldName="skillLevel"
        />
        <ChoiceGroup
          legend="참가 승인 방식"
          name="approvalMode"
          layout="list"
          options={APPROVAL_OPTIONS}
          value={values.approvalMode}
          onChange={(value) => set('approvalMode', value)}
          hint={mode === 'edit' ? '방식을 바꿔도 이미 받은 신청의 상태는 그대로예요.' : undefined}
          error={errors.approvalMode}
          fieldName="approvalMode"
        />
      </Section>

      <Section title="모임 소개">
        <Textarea
          data-field="description"
          label="소개 (선택)"
          rows={6}
          value={values.description}
          onChange={(event) => set('description', event.target.value)}
          maxLength={L.descriptionMax}
          placeholder="어떤 분위기로 진행하는지, 준비물이 있는지 적어 주세요."
          hint={`${counter(values.description, L.descriptionMax)} · 연락처는 적지 마세요. 링크는 글자로만 보여요.`}
          error={errors.description}
          className="min-h-30"
        />
      </Section>

      <div className="mt-9 border-t border-border pt-4">
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-controls={advancedId}
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex min-h-touch w-full items-center justify-between gap-3 rounded-lg text-left text-lg font-heavy text-ink hover:bg-soft"
        >
          <span>
            추가 설정
            <span className="ml-2 text-sm font-semibold text-muted">최소 인원 · 대기 신청 · 유의사항</span>
          </span>
          <Icon name="chevron-down" size="1.1em" className={advancedOpen ? 'rotate-180' : undefined} />
        </button>
        <div id={advancedId} hidden={!advancedOpen} className="mt-4 space-y-5">
          <Select
            data-field="minParticipants"
            label="최소 인원 (모임장 포함)"
            value={values.minParticipants}
            onChange={(event) => set('minParticipants', event.target.value)}
            hint="이 인원이 모이지 않아도 모임이 자동으로 취소되지는 않아요."
            error={errors.minParticipants}
          >
            {PARTICIPANT_OPTIONS.map((count) => (
              <option key={count} value={String(count)}>
                {count}명
              </option>
            ))}
          </Select>
          <Checkbox
            data-field="allowWaitlist"
            label="정원이 차면 대기 신청 받기"
            checked={values.allowWaitlist}
            onChange={(event) => set('allowWaitlist', event.target.checked)}
            hint="자리가 나면 모임장이 직접 확정해요. 자동으로 확정되지 않아요."
            error={errors.allowWaitlist}
          />
          <Textarea
            data-field="notice"
            label="유의사항 (선택)"
            rows={4}
            value={values.notice}
            onChange={(event) => set('notice', event.target.value)}
            maxLength={L.noticeMax}
            placeholder="예: 시작 10분 전까지 와 주세요."
            hint={counter(values.notice, L.noticeMax)}
            error={errors.notice}
          />
        </div>
      </div>

      <div className="mt-10 flex flex-col-reverse gap-2 border-t border-border pt-6 sm:flex-row sm:justify-end">
        <ButtonLink to={cancelTo} variant="secondary" size="lg">
          취소
        </ButtonLink>
        <Button type="submit" loading={submitting} loadingLabel="저장하는 중" data-testid="meeting-submit">
          {submitting ? '저장 중…' : mode === 'create' ? '모임 만들기' : '수정 내용 저장'}
        </Button>
      </div>
    </form>
  );
}
