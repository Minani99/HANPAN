import { useId, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useSignOut } from '../auth/useSignOut';
import { PageContainer } from '../components/layout/PageContainer';
import { PageErrorState, PageSkeleton } from '../components/layout/PageStates';
import { PageTitle } from '../components/layout/PageTitle';
import { Button, ButtonLink } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { Chip } from '../components/ui/Chip';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { FieldMessages } from '../components/ui/field';
import { Notice } from '../components/ui/Notice';
import { Select } from '../components/ui/Select';
import { TextField } from '../components/ui/TextField';
import { Textarea } from '../components/ui/Textarea';
import { useToast } from '../components/ui/Toast';
import { VisuallyHidden } from '../components/ui/VisuallyHidden';
import { useDataAdapter } from '../data';
import type { CategoryId, MyProfile, RegionCode } from '../data/types';
import { useAsyncData } from '../data/useAsyncData';
import { CATEGORIES } from '../domain/categories';
import { getErrorMessage } from '../domain/errorMessages';
import { PROFILE_LIMITS, charLength } from '../domain/limits';
import {
  PROFILE_FIELD_ORDER,
  mapProfileServerError,
  validateProfileForm,
  type ProfileFormErrors,
  type ProfileFormField,
  type ProfileFormValues,
} from '../domain/profileSchema';
import { REGIONS } from '../domain/regions';
import { focusFormField } from '../lib/focusField';
import { consumeReturnTo } from '../lib/returnTo';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export const DELETION_REQUESTED_PATH = '/account/deletion-requested';

/**
 * 프로필 (`/profile`, 로그인 필요 — 최초 설정 전에도 열린다).
 * - 최초 설정(약관 동의 전): 닉네임 · 선호 권역 · 관심 장르 · 필수 동의 2개 → 저장 후 returnTo
 * - 일반: 내 정보 수정, 로그아웃, 탈퇴 요청
 * 실명·본인확인 배지는 없고, 이메일 등 비공개 정보는 보여주지 않는다.
 */
export function ProfilePage() {
  const adapter = useDataAdapter();
  const { userKey } = useAuth();
  const profile = useAsyncData(`profile:${userKey}`, () => adapter.getMyProfile());
  const onboarding = profile.data ? profile.data.termsAgreedAt === null : false;
  useDocumentTitle(onboarding ? '처음 설정' : '마이');

  if (profile.status === 'loading') return <PageSkeleton label="프로필을 불러오는 중이에요." />;
  if (profile.status === 'error' || !profile.data) {
    return <PageErrorState title="프로필을 불러오지 못했어요." onRetry={profile.retry} />;
  }

  return (
    <PageContainer className="pt-2 pb-12 md:pt-4 md:pb-20">
      <div className="max-w-xl">
        {onboarding ? (
          <PageTitle
            title="처음 설정"
            description="모임에 참가 신청하거나 모임을 열기 전에 한 번만 설정해요. 다른 이용자에게는 닉네임만 보여요."
          />
        ) : (
          <PageTitle title="마이" />
        )}
        <ProfileForm key={`${profile.data.id}:${onboarding}`} profile={profile.data} onboarding={onboarding} onSaved={profile.refresh} />
        {!onboarding && profile.data.isAdmin ? <AdminToolsSection /> : null}
        {onboarding ? null : <AccountSection />}
      </div>
    </PageContainer>
  );
}

function toFormValues(profile: MyProfile): ProfileFormValues {
  return {
    nickname: profile.nickname,
    regionCode: profile.regionCode ?? '',
    bio: profile.bio,
    favoriteCategoryIds: [...profile.favoriteCategoryIds],
    agreeTerms: profile.termsAgreedAt !== null,
    agreePrivacy: profile.privacyAgreedAt !== null,
  };
}

function ProfileForm({
  profile,
  onboarding,
  onSaved,
}: {
  profile: MyProfile;
  onboarding: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const adapter = useDataAdapter();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [values, setValues] = useState<ProfileFormValues>(() => toFormValues(profile));
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const favoritesLabelId = useId();
  const favoritesHintId = useId();
  const restricted = profile.status !== 'active';

  const set = <K extends ProfileFormField>(field: K, value: ProfileFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const toggleFavorite = (id: CategoryId) => {
    const selected = values.favoriteCategoryIds.includes(id);
    if (!selected && values.favoriteCategoryIds.length >= PROFILE_LIMITS.favoriteCategoriesMax) return;
    set(
      'favoriteCategoryIds',
      selected ? values.favoriteCategoryIds.filter((item) => item !== id) : [...values.favoriteCategoryIds, id],
    );
  };

  const focus = (field: ProfileFormField) => focusFormField(formRef.current, field);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    const result = validateProfileForm(values, { onboarding });
    if (!result.ok) {
      flushSync(() => setErrors(result.errors));
      const first = PROFILE_FIELD_ORDER.find((field) => result.errors[field]);
      if (first) focus(first);
      return;
    }
    setSubmitting(true);
    try {
      await adapter.updateMyProfile(result.update);
      await refresh().catch(() => null);
      if (onboarding) {
        navigate(consumeReturnTo(), { replace: true });
        toast.show('설정을 마쳤어요. 이제 모임에 참가 신청할 수 있어요.', { tone: 'success' });
        return;
      }
      await onSaved().catch(() => {});
      toast.show('내 정보를 저장했어요.', { tone: 'success' });
    } catch (error) {
      const mapped = mapProfileServerError(error);
      if (mapped) {
        flushSync(() => setErrors({ [mapped.field]: mapped.message }));
        focus(mapped.field);
      } else {
        setFormError(getErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form ref={formRef} noValidate onSubmit={handleSubmit} data-testid="profile-form" aria-label={onboarding ? '처음 설정' : '내 정보'}>
      {restricted ? (
        <Notice tone="warning" className="mb-6">
          {profile.status === 'restricted'
            ? '이용이 제한된 계정이라 정보를 바꿀 수 없어요.'
            : '탈퇴 요청된 계정이라 정보를 바꿀 수 없어요.'}
        </Notice>
      ) : null}
      {formError ? (
        <Notice tone="danger" role="alert" title="저장하지 못했어요" className="mb-6">
          {formError}
        </Notice>
      ) : null}

      <div className="space-y-6">
        <TextField
          data-field="nickname"
          label="닉네임"
          value={values.nickname}
          onChange={(event) => set('nickname', event.target.value)}
          maxLength={PROFILE_LIMITS.nicknameMax}
          autoComplete="nickname"
          hint="다른 이용자에게 보이는 이름이에요. 실명 대신 닉네임을 써 주세요. 한글·영문·숫자·_·- 2~20자"
          error={errors.nickname}
          required
        />

        <Select
          data-field="regionCode"
          label="선호 권역 (선택)"
          value={values.regionCode}
          onChange={(event) => set('regionCode', event.target.value as RegionCode | '')}
          error={errors.regionCode}
        >
          <option value="">선택하지 않음</option>
          {REGIONS.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </Select>

        <div role="group" aria-labelledby={favoritesLabelId} aria-describedby={favoritesHintId} data-field="favoriteCategoryIds">
          <p id={favoritesLabelId} className="mb-2 text-sm font-bold text-ink">
            관심 장르 (선택)
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((category, index) => (
              <Chip
                key={category.id}
                data-focus-target={index === 0 ? true : undefined}
                selected={values.favoriteCategoryIds.includes(category.id)}
                onClick={() => toggleFavorite(category.id)}
              >
                {category.name}
              </Chip>
            ))}
          </div>
          <FieldMessages
            hint={`최대 ${PROFILE_LIMITS.favoriteCategoriesMax}개까지 고를 수 있어요.`}
            hintId={favoritesHintId}
            error={errors.favoriteCategoryIds}
          />
        </div>

        {onboarding ? null : (
          <Textarea
            data-field="bio"
            label="소개 (선택)"
            rows={3}
            value={values.bio}
            onChange={(event) => set('bio', event.target.value)}
            maxLength={PROFILE_LIMITS.bioMax}
            hint={`${charLength(values.bio.trim())}/${PROFILE_LIMITS.bioMax}자 · 연락처나 실명은 적지 마세요.`}
            error={errors.bio}
          />
        )}

        {onboarding ? (
          <fieldset className="space-y-1 border-t border-border pt-5">
            <legend className="sr-only">필수 동의</legend>
            <div className="flex flex-wrap items-center gap-x-2">
              <Checkbox
                data-field="agreeTerms"
                label="이용약관에 동의해요 (필수)"
                checked={values.agreeTerms}
                onChange={(event) => set('agreeTerms', event.target.checked)}
                error={errors.agreeTerms}
              />
              <Link to="/policies/terms" target="_blank" className="text-sm font-bold text-ink underline underline-offset-4">
                이용약관(초안) 보기
                {/* 새 탭으로 열려 입력 중인 최초 설정이 사라지지 않게 한다. 스크린리더에 알림(화면 표시는 그대로) */}
                <VisuallyHidden> (새 창에서 열림)</VisuallyHidden>
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-x-2">
              <Checkbox
                data-field="agreePrivacy"
                label="개인정보 수집·이용에 동의해요 (필수)"
                checked={values.agreePrivacy}
                onChange={(event) => set('agreePrivacy', event.target.checked)}
                error={errors.agreePrivacy}
              />
              <Link to="/policies/privacy" target="_blank" className="text-sm font-bold text-ink underline underline-offset-4">
                개인정보처리방침(초안) 보기
                <VisuallyHidden> (새 창에서 열림)</VisuallyHidden>
              </Link>
            </div>
            <p className="pt-1 text-sm text-muted">약관과 방침은 운영자·법률 검토 전 초안이에요.</p>
          </fieldset>
        ) : null}
      </div>

      <div className="mt-8">
        <Button type="submit" fullWidth loading={submitting} loadingLabel="저장하는 중" disabled={restricted}>
          {submitting ? '저장 중…' : onboarding ? '시작하기' : '저장하기'}
        </Button>
      </div>
    </form>
  );
}

/**
 * 관리자에게만 보이는 관리자 도구 링크(헤더·하단 내비에는 노출하지 않는다).
 * 링크를 숨기는 것은 사용성용이다 — /admin의 모든 데이터·동작은 서버가 is_admin()으로 다시 막는다.
 */
function AdminToolsSection() {
  return (
    <section aria-labelledby="admin-tools" className="mt-12 border-t border-border pt-7" data-testid="admin-tools-link">
      <h2 id="admin-tools" className="text-lg font-heavy text-ink">
        관리자 도구
      </h2>
      <p className="mt-1.5 text-sm text-text">신고 처리, 모임 숨김, 계정 제한, 공간·카테고리 관리를 할 수 있어요.</p>
      <ButtonLink to="/admin" variant="secondary" className="mt-4">
        관리자 도구 열기
      </ButtonLink>
    </section>
  );
}

/** 로그아웃 · 탈퇴 요청 */
function AccountSection() {
  const adapter = useDataAdapter();
  const { signOut } = useAuth();
  const handleSignOut = useSignOut();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const requestDeletion = async () => {
    await adapter.requestAccountDeletion();
    await signOut().catch(() => {});
    navigate(DELETION_REQUESTED_PATH, { replace: true });
  };

  return (
    <>
      <section aria-labelledby="account-session" className="mt-12 border-t border-border pt-7">
        <h2 id="account-session" className="text-lg font-heavy text-ink">
          로그인
        </h2>
        <p className="mt-1.5 text-sm text-text">이 기기에서 로그아웃해요.</p>
        <Button variant="secondary" className="mt-4" onClick={handleSignOut}>
          로그아웃
        </Button>
      </section>

      <section aria-labelledby="account-delete" className="mt-10 border-t border-border pt-7">
        <h2 id="account-delete" className="text-lg font-heavy text-ink">
          탈퇴 요청
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-text text-wrap-ko">
          탈퇴를 요청하면 예정된 신청과 주최 중인 예정 모임이 취소돼요. 계정 데이터 삭제는 운영자 확인 후 처리돼요.
        </p>
        <Button
          variant="danger"
          className="mt-4"
          onClick={() => {
            setConfirmed(false);
            setDeleteOpen(true);
          }}
          aria-haspopup="dialog"
        >
          탈퇴 요청하기
        </Button>
      </section>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="탈퇴를 요청할까요?"
        confirmLabel="탈퇴 요청하기"
        confirmLoadingLabel="탈퇴를 요청하는 중"
        cancelLabel="그대로 두기"
        tone="danger"
        onConfirm={requestDeletion}
        confirmDisabled={!confirmed}
      >
        <ul role="list" className="list-disc space-y-1.5 pl-5">
          <li>탈퇴 요청 시 시작 전인 참가 신청은 취소되고, 주최 중인 예정 모임은 취소돼요.</li>
          <li>닉네임은 &lsquo;탈퇴한 사용자&rsquo;로 바뀌고 소개·관심 장르는 지워져요.</li>
          <li>계정 데이터 삭제는 운영자 확인 후 처리돼요. 요청 후에는 이 기기에서 로그아웃돼요.</li>
          <li>
            보관되는 정보와 기간은{' '}
            <Link to="/policies/privacy" className="font-bold text-ink underline underline-offset-4">
              개인정보처리방침(초안)
            </Link>
            에서 확인할 수 있어요.
          </li>
        </ul>
        <Checkbox
          containerClassName="mt-4"
          label="위 내용을 확인했어요"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
      </ConfirmDialog>
    </>
  );
}
