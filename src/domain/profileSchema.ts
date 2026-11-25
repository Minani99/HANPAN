import { z } from 'zod';
import { getErrorCode, isDataAdapterError } from '../data/adapter';
import type { CategoryId, ProfileUpdate, RegionCode } from '../data/types';
import { isCategoryId } from './categories';
import { NICKNAME_PATTERN, PROFILE_LIMITS as P, charLength, isReservedNickname } from './limits';
import { isRegionCode } from './regions';

/** 프로필·최초 설정 폼 (서버 update_my_profile과 같은 규칙, docs/DB_SCHEMA.md §9.12) */
export interface ProfileFormValues {
  nickname: string;
  regionCode: RegionCode | '';
  bio: string;
  favoriteCategoryIds: CategoryId[];
  agreeTerms: boolean;
  agreePrivacy: boolean;
}

export type ProfileFormField = keyof ProfileFormValues;
export type ProfileFormErrors = Partial<Record<ProfileFormField, string>>;

export const PROFILE_FIELD_MESSAGES = {
  nicknameFormat: `닉네임은 한글·영문·숫자·밑줄(_)·하이픈(-)으로 ${P.nicknameMin}~${P.nicknameMax}자로 써 주세요.`,
  nicknameReserved: '운영자나 서비스로 오해할 수 있는 닉네임은 쓸 수 없어요.',
  nicknameTaken: '이미 쓰고 있는 닉네임이에요.',
  regionCode: '선호 권역을 다시 골라 주세요.',
  bio: `소개는 ${P.bioMax}자까지 쓸 수 있어요.`,
  favoriteCategoryIds: `관심 장르는 ${P.favoriteCategoriesMax}개까지 고를 수 있어요.`,
  agreeTerms: '이용약관에 동의해야 시작할 수 있어요.',
  agreePrivacy: '개인정보 수집·이용에 동의해야 시작할 수 있어요.',
} as const;

const M = PROFILE_FIELD_MESSAGES;

export function createProfileFormSchema({ onboarding }: { onboarding: boolean }) {
  return z
    .object({
      nickname: z
        .string()
        .transform((value) => value.trim())
        .refine((value) => NICKNAME_PATTERN.test(value), { message: M.nicknameFormat, abort: true })
        .refine((value) => !isReservedNickname(value), { message: M.nicknameReserved }),
      regionCode: z.union([z.literal(''), z.custom<RegionCode>((value) => isRegionCode(value))], {
        message: M.regionCode,
      }),
      bio: z
        .string()
        .transform((value) => value.trim())
        .refine((value) => charLength(value) <= P.bioMax, { message: M.bio }),
      favoriteCategoryIds: z
        .array(z.custom<CategoryId>((value) => isCategoryId(value)))
        .refine((value) => new Set(value).size <= P.favoriteCategoriesMax, { message: M.favoriteCategoryIds }),
      agreeTerms: onboarding ? z.literal(true, { message: M.agreeTerms }) : z.boolean(),
      agreePrivacy: onboarding ? z.literal(true, { message: M.agreePrivacy }) : z.boolean(),
    })
    .transform((value): ProfileUpdate => {
      const update: ProfileUpdate = {
        nickname: value.nickname,
        regionCode: value.regionCode === '' ? null : value.regionCode,
        bio: value.bio,
        favoriteCategoryIds: [...new Set(value.favoriteCategoryIds)],
      };
      if (onboarding) {
        update.agreeTerms = true;
        update.agreePrivacy = true;
      }
      return update;
    });
}

export type ProfileFormResult = { ok: true; update: ProfileUpdate } | { ok: false; errors: ProfileFormErrors };

export function validateProfileForm(values: ProfileFormValues, options: { onboarding: boolean }): ProfileFormResult {
  const result = createProfileFormSchema(options).safeParse(values);
  if (result.success) return { ok: true, update: result.data };
  const errors: ProfileFormErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && field in values && !errors[field as ProfileFormField]) {
      errors[field as ProfileFormField] = issue.message;
    }
  }
  return { ok: false, errors };
}

export const PROFILE_FIELD_ORDER: readonly ProfileFormField[] = [
  'nickname',
  'regionCode',
  'favoriteCategoryIds',
  'bio',
  'agreeTerms',
  'agreePrivacy',
];

/** 서버 오류 → 필드 오류 (필드에 연결할 수 없으면 null) */
export function mapProfileServerError(error: unknown): { field: ProfileFormField; message: string } | null {
  const code = getErrorCode(error);
  if (code === 'NICKNAME_TAKEN') return { field: 'nickname', message: M.nicknameTaken };
  if (code !== 'VALIDATION_FAILED' || !isDataAdapterError(error)) return null;
  switch (error.detail) {
    case 'nickname':
      return { field: 'nickname', message: M.nicknameFormat };
    case 'region_code':
      return { field: 'regionCode', message: M.regionCode };
    case 'bio':
      return { field: 'bio', message: M.bio };
    case 'favorite_category_ids':
      return { field: 'favoriteCategoryIds', message: M.favoriteCategoryIds };
    default:
      return null;
  }
}
