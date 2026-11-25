import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { getErrorCode, isDataAdapterError } from '../../data/adapter';
import { useDataAdapter } from '../../data';
import type { RegionCode, Venue, VenueType } from '../../data/types';
import { useAsyncData } from '../../data/useAsyncData';
import { charLength } from '../../domain/limits';
import { REGIONS, getRegionName } from '../../domain/regions';
import {
  VENUE_FIELD_MESSAGES,
  VENUE_LIMITS,
  VENUE_SERVER_FIELD_MAP,
  VENUE_TYPES,
  VENUE_TYPE_LABEL,
  emptyVenueFormValues,
  formatVerifiedDate,
  validateVenueForm,
  venuePath,
  venueToFormValues,
  type VenueFormErrors,
  type VenueFormField,
  type VenueFormValues,
} from '../../domain/venues';
import { toKstDateKey } from '../../lib/date';
import { focusFormField } from '../../lib/focusField';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { ChoiceGroup } from '../ui/ChoiceGroup';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Notice } from '../ui/Notice';
import { Select } from '../ui/Select';
import { Skeleton } from '../ui/Skeleton';
import { TextField } from '../ui/TextField';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';
import { adminErrorMessage } from './adminShared';

type Editing = { id: string | null; values: VenueFormValues } | null;

/**
 * 관리자 · 공간: 목록(비공개 포함) + 등록·수정 폼 + 공개/비공개 전환(삭제 대신).
 * 쓰기는 venues 테이블 직접 쓰기(RLS is_admin) — created_by·updated_at은 DB 트리거가, 감사 기록은 after 트리거가 남긴다.
 */
export function AdminVenuesTab() {
  const adapter = useDataAdapter();
  const toast = useToast();
  const { userKey } = useAuth();
  const [editing, setEditing] = useState<Editing>(null);
  const [toggle, setToggle] = useState<Venue | null>(null);
  const venues = useAsyncData(`admin-venues:${userKey}`, () => adapter.adminListVenues());

  const confirmToggle = async () => {
    if (!toggle) return;
    await adapter.adminSetVenuePublic(toggle.id, !toggle.isPublic);
    toast.show(toggle.isPublic ? '공간을 비공개로 바꿨어요.' : '공간을 공개했어요.', { tone: 'success' });
    setToggle(null);
    await venues.refresh().catch(() => venues.retry());
  };

  return (
    <div data-testid="admin-venues">
      <Notice tone="info">
        공식 홈페이지·공식 예약 페이지·공식 SNS에서 확인한 정보만 등록하고, 확인한 날짜를 정보 확인일로 적어 주세요. 링크는
        https 주소만 쓸 수 있어요. 공간은 삭제하지 않고 비공개로 바꿔요(연결된 모임은 유지돼요).
      </Notice>

      {editing ? (
        <VenueEditor
          key={editing.id ?? 'new'}
          editing={editing}
          onCancel={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            toast.show(message, { tone: 'success' });
            await venues.refresh().catch(() => venues.retry());
          }}
        />
      ) : (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => setEditing({ id: null, values: emptyVenueFormValues() })}>
            새 공간 등록
          </Button>
        </div>
      )}

      {venues.status === 'loading' ? (
        <div aria-busy="true" className="mt-4 space-y-3">
          <p role="status" className="sr-only">
            공간 목록을 불러오는 중이에요.
          </p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {venues.status === 'error' ? (
        <ErrorState title="공간 목록을 불러오지 못했어요." description={adminErrorMessage(venues.error)} onRetry={venues.retry} />
      ) : null}
      {venues.status === 'success' && venues.data ? (
        venues.data.length === 0 ? (
          <EmptyState title="등록된 공간이 없어요." description="'새 공간 등록'으로 첫 공간을 등록해 주세요." />
        ) : (
          <ul role="list" className="mt-6 border-t border-border" data-testid="admin-venue-list">
            {venues.data.map((venue) => (
              <li key={venue.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-4" data-testid="admin-venue">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge tone={venue.isPublic ? 'success' : 'status'}>{venue.isPublic ? '공개' : '비공개'}</Badge>
                    <Badge tone="genre">{VENUE_TYPE_LABEL[venue.venueType]}</Badge>
                  </p>
                  {venue.isPublic ? (
                    <Link
                      to={venuePath(venue.id)}
                      className="mt-1.5 block text-base leading-snug font-bold text-ink text-wrap-ko underline-offset-4 hover:underline"
                    >
                      {venue.name}
                    </Link>
                  ) : (
                    <p className="mt-1.5 text-base leading-snug font-bold text-ink text-wrap-ko">{venue.name}</p>
                  )}
                  <p className="mt-0.5 text-sm text-muted text-wrap-ko">
                    {getRegionName(venue.regionCode)} · {venue.address} · {formatVerifiedDate(venue.infoVerifiedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditing({ id: venue.id, values: venueToFormValues(venue) })}
                    aria-label={`${venue.name} 수정`}
                  >
                    수정
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setToggle(venue)}
                    aria-haspopup="dialog"
                    aria-label={`${venue.name} ${venue.isPublic ? '비공개로 전환' : '공개로 전환'}`}
                  >
                    {venue.isPublic ? '비공개로 전환' : '공개로 전환'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <ConfirmDialog
        open={toggle !== null}
        onClose={() => setToggle(null)}
        title={toggle?.isPublic ? '비공개로 바꿀까요?' : '공개할까요?'}
        description={toggle?.name}
        confirmLabel={toggle?.isPublic ? '비공개로 전환' : '공개로 전환'}
        confirmLoadingLabel="처리하는 중"
        cancelLabel="그대로 두기"
        onConfirm={confirmToggle}
        errorMessage={adminErrorMessage}
      >
        <p>
          {toggle?.isPublic
            ? '공간 목록·상세와 모임 만들기의 공간 선택에서 빠져요. 이미 연결된 모임은 그대로지만 공간 이름이 보이지 않아요.'
            : '공간 목록·상세에 보이고 모임을 만들 때 고를 수 있어요.'}
        </p>
      </ConfirmDialog>
    </div>
  );
}

function VenueEditor({
  editing,
  onCancel,
  onSaved,
}: {
  editing: NonNullable<Editing>;
  onCancel: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const adapter = useDataAdapter();
  const [values, setValues] = useState<VenueFormValues>(editing.values);
  const [errors, setErrors] = useState<VenueFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const today = toKstDateKey(new Date());

  const set = <K extends VenueFormField>(field: K, value: VenueFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const result = validateVenueForm(values, new Date());
    if (!result.ok) {
      flushSync(() => setErrors(result.errors));
      const first = (Object.keys(values) as VenueFormField[]).find((field) => result.errors[field]);
      if (first) focusFormField(formRef.current, first);
      return;
    }
    setBusy(true);
    try {
      await adapter.adminSaveVenue(editing.id, result.input);
      await onSaved(editing.id ? '공간 정보를 저장했어요.' : '공간을 등록했어요.');
    } catch (error) {
      const field =
        getErrorCode(error) === 'VALIDATION_FAILED' && isDataAdapterError(error) && error.detail
          ? VENUE_SERVER_FIELD_MAP[error.detail]
          : undefined;
      if (field) {
        flushSync(() => setErrors({ [field]: serverFieldMessage(field) }));
        focusFormField(formRef.current, field);
      } else {
        setFormError(adminErrorMessage(error));
      }
      setBusy(false);
    }
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={submit}
      aria-labelledby="venue-editor-title"
      className="mt-6 rounded-lg border border-border px-4 py-5 md:px-6"
      data-testid="venue-editor"
    >
      {/* 관리자 화면은 h1(관리자 도구) 아래 h2가 없으므로 h2 — 제목 단계를 건너뛰지 않게(axe heading-order). 모양은 className 그대로 */}
      <h2 id="venue-editor-title" className="text-lg font-heavy text-ink">
        {editing.id ? '공간 정보 수정' : '새 공간 등록'}
      </h2>
      {formError ? (
        <Notice tone="danger" role="alert" title="저장하지 못했어요" className="mt-4">
          {formError}
        </Notice>
      ) : null}
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <TextField
          data-field="name"
          label="공간 이름"
          value={values.name}
          onChange={(event) => set('name', event.target.value)}
          maxLength={VENUE_LIMITS.nameMax}
          hint={`${charLength(values.name.trim())}/${VENUE_LIMITS.nameMax}자 · 공식 상호를 그대로 적어 주세요.`}
          error={errors.name}
          required
        />
        <Select
          data-field="regionCode"
          label="권역"
          value={values.regionCode}
          onChange={(event) => set('regionCode', event.target.value as RegionCode | '')}
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
        <TextField
          data-field="address"
          label="주소"
          value={values.address}
          onChange={(event) => set('address', event.target.value)}
          maxLength={VENUE_LIMITS.addressMax}
          containerClassName="md:col-span-2"
          error={errors.address}
          required
        />
        <ChoiceGroup
          legend="공간 유형"
          name="venueType"
          options={VENUE_TYPES.map((type) => ({ value: type, label: VENUE_TYPE_LABEL[type] }))}
          value={values.venueType}
          onChange={(value: VenueType) => set('venueType', value)}
          error={errors.venueType}
          fieldName="venueType"
          className="md:col-span-2"
          required
        />
        <TextField
          data-field="websiteUrl"
          type="url"
          inputMode="url"
          label="공식 홈페이지 (선택)"
          placeholder="https://"
          value={values.websiteUrl}
          onChange={(event) => set('websiteUrl', event.target.value)}
          maxLength={VENUE_LIMITS.urlMax}
          hint="https:// 주소만 쓸 수 있어요."
          error={errors.websiteUrl}
        />
        <TextField
          data-field="bookingUrl"
          type="url"
          inputMode="url"
          label="공식 예약 페이지 (선택)"
          placeholder="https://"
          value={values.bookingUrl}
          onChange={(event) => set('bookingUrl', event.target.value)}
          maxLength={VENUE_LIMITS.urlMax}
          hint="확인된 공식 예약 페이지만 적어 주세요."
          error={errors.bookingUrl}
        />
        <Textarea
          data-field="description"
          label="소개 (선택)"
          rows={4}
          value={values.description}
          onChange={(event) => set('description', event.target.value)}
          maxLength={VENUE_LIMITS.descriptionMax}
          containerClassName="md:col-span-2"
          hint={`${charLength(values.description.trim())}/${VENUE_LIMITS.descriptionMax}자 · 다른 서비스의 소개문·리뷰를 복사하지 마세요. 영업시간·가격은 적지 않아요.`}
          error={errors.description}
        />
        <TextField
          data-field="infoVerifiedOn"
          type="date"
          label="정보 확인일 (선택)"
          value={values.infoVerifiedOn}
          max={today}
          onChange={(event) => set('infoVerifiedOn', event.target.value)}
          hint="공식 출처에서 정보를 확인한 날(한국 시간)이에요."
          error={errors.infoVerifiedOn}
        />
        <Checkbox
          data-field="isPublic"
          label="공개 (공간 목록과 모임 만들기에 보여요)"
          checked={values.isPublic}
          onChange={(event) => set('isPublic', event.target.checked)}
          containerClassName="self-end"
        />
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          취소
        </Button>
        <Button type="submit" variant="primary" loading={busy} loadingLabel="저장하는 중" data-testid="venue-save">
          {editing.id ? '저장' : '등록'}
        </Button>
      </div>
    </form>
  );
}

function serverFieldMessage(field: VenueFormField): string {
  switch (field) {
    case 'name':
      return VENUE_FIELD_MESSAGES.name;
    case 'address':
      return VENUE_FIELD_MESSAGES.address;
    case 'regionCode':
      return VENUE_FIELD_MESSAGES.regionCode;
    case 'venueType':
      return VENUE_FIELD_MESSAGES.venueType;
    case 'websiteUrl':
    case 'bookingUrl':
      return VENUE_FIELD_MESSAGES.url;
    case 'description':
      return VENUE_FIELD_MESSAGES.description;
    case 'infoVerifiedOn':
      return VENUE_FIELD_MESSAGES.infoVerifiedOn;
    default:
      return '입력한 내용을 다시 확인해 주세요.';
  }
}
