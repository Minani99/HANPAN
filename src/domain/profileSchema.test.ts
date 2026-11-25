import { describe, expect, it } from 'vitest';
import { isReservedNickname, normalizeNicknameForReservedCheck } from './limits';
import { PROFILE_FIELD_MESSAGES, validateProfileForm, type ProfileFormValues } from './profileSchema';

function values(overrides: Partial<ProfileFormValues> = {}): ProfileFormValues {
  return {
    nickname: '보드게임러',
    regionCode: '',
    bio: '',
    favoriteCategoryIds: [],
    agreeTerms: false,
    agreePrivacy: false,
    ...overrides,
  };
}

function nicknameError(nickname: string): string | undefined {
  const result = validateProfileForm(values({ nickname }), { onboarding: false });
  return result.ok ? undefined : result.errors.nickname;
}

describe('domain/profileSchema 닉네임 예약어 (DB _is_reserved_nickname과 같은 규칙)', () => {
  it('포함 금지: 관리자·운영자·운영진·운영팀·admin·hanpan (대소문자·공백·_·- 무시)', () => {
    for (const nickname of ['관리자김', '김관리자', '운영자3', '운영진', '운영진김', '운_영진', '운영팀장', 'ADMIN', 'superAdmin', 'HanPan', 'han_pan', 'han-pan01']) {
      expect(isReservedNickname(nickname), nickname).toBe(true);
      expect(nicknameError(nickname), nickname).toBe(PROFILE_FIELD_MESSAGES.nicknameReserved);
    }
  });

  it('완전 일치 금지: 한판·탈퇴한사용자 (일반 단어에 들어간 "한판"은 허용)', () => {
    for (const nickname of ['한판', '한_판', '한-판', '탈퇴한사용자', '탈퇴한_사용자']) {
      expect(isReservedNickname(nickname), nickname).toBe(true);
    }
    expect(isReservedNickname('탈퇴한 사용자')).toBe(true);
    for (const nickname of ['한판승부', '오늘도한판', '한판더', '탈퇴한사용자아님', '운영', '진운영']) {
      expect(isReservedNickname(nickname), nickname).toBe(false);
      expect(nicknameError(nickname), nickname).toBeUndefined();
    }
  });

  it('정규화: 소문자 + 공백·밑줄·하이픈 제거', () => {
    expect(normalizeNicknameForReservedCheck(' Han_Pan-1 ')).toBe('hanpan1');
  });

  it('형식 오류가 먼저다(공백 포함 닉네임은 형식 문구)', () => {
    expect(nicknameError('탈퇴한 사용자')).toBe(PROFILE_FIELD_MESSAGES.nicknameFormat);
    expect(nicknameError('가')).toBe(PROFILE_FIELD_MESSAGES.nicknameFormat);
  });

  it('최초 설정에서는 약관·개인정보 동의가 필요하다', () => {
    const result = validateProfileForm(values({ nickname: '한판승부' }), { onboarding: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['agreePrivacy', 'agreeTerms']);
    const ok = validateProfileForm(values({ nickname: '한판승부', agreeTerms: true, agreePrivacy: true }), { onboarding: true });
    expect(ok).toEqual({
      ok: true,
      update: { nickname: '한판승부', regionCode: null, bio: '', favoriteCategoryIds: [], agreeTerms: true, agreePrivacy: true },
    });
  });
});
