import { describe, expect, it } from 'vitest';
import { validateReportForm, REPORT_FIELD_MESSAGES } from './reports';
import {
  VENUE_FIELD_MESSAGES,
  emptyVenueFormValues,
  formatVerifiedDate,
  parseVenueQuery,
  serializeVenueQuery,
  validateVenueForm,
  type VenueFormValues,
} from './venues';

const NOW = new Date('2026-11-23T03:00:00Z'); // KST 11-23 12:00

function values(overrides: Partial<VenueFormValues> = {}): VenueFormValues {
  return {
    ...emptyVenueFormValues(),
    name: ' 보드게임 카페 ',
    regionCode: 'dunsan_tanbang',
    address: ' 대전 서구 예시로 1 ',
    venueType: 'board_game_cafe',
    ...overrides,
  };
}

describe('domain/venues', () => {
  it('정보 확인일: KST 날짜 YYYY.MM.DD, 없으면 "확인일 없음"', () => {
    expect(formatVerifiedDate('2026-11-19T15:00:00.000Z')).toBe('정보 확인일 2026.11.20');
    expect(formatVerifiedDate(null)).toBe('확인일 없음');
  });

  it('URL 쿼리: region·type만, 잘못된 값은 무시', () => {
    expect(parseVenueQuery(new URLSearchParams('region=noeun_jijok&type=party_room&x=1'))).toEqual({
      region: 'noeun_jijok',
      type: 'party_room',
    });
    expect(parseVenueQuery(new URLSearchParams('region=seoul&type=casino'))).toEqual({});
    expect(serializeVenueQuery({ type: 'other' }).toString()).toBe('type=other');
  });

  it('공간 폼: 공백 제거·https만·정보 확인일은 오늘 이전(KST 00:00으로 저장)', () => {
    const ok = validateVenueForm(values({ websiteUrl: ' https://example.com/a ', infoVerifiedOn: '2026-11-23' }), NOW);
    expect(ok).toEqual({
      ok: true,
      input: {
        name: '보드게임 카페',
        regionCode: 'dunsan_tanbang',
        address: '대전 서구 예시로 1',
        venueType: 'board_game_cafe',
        websiteUrl: 'https://example.com/a',
        bookingUrl: null,
        description: '',
        isPublic: false,
        infoVerifiedAt: '2026-11-22T15:00:00.000Z',
      },
    });
    const bad = validateVenueForm(
      values({
        name: '  ',
        websiteUrl: 'http://example.com',
        bookingUrl: 'javascript:alert(1)',
        infoVerifiedOn: '2026-11-24',
        regionCode: '',
        venueType: '',
        address: '가'.repeat(201),
      }),
      NOW,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toEqual({
        name: VENUE_FIELD_MESSAGES.name,
        regionCode: VENUE_FIELD_MESSAGES.regionCode,
        address: VENUE_FIELD_MESSAGES.address,
        venueType: VENUE_FIELD_MESSAGES.venueType,
        websiteUrl: VENUE_FIELD_MESSAGES.url,
        bookingUrl: VENUE_FIELD_MESSAGES.url,
        infoVerifiedOn: VENUE_FIELD_MESSAGES.infoVerifiedOn,
      });
    }
  });
});

describe('domain/reports 신고 폼', () => {
  it('사유 필수, 기타면 본문 필수, 본문 1000자(앞뒤 공백 제거 후)', () => {
    expect(validateReportForm({ reason: '', body: '' })).toEqual({ ok: false, errors: { reason: REPORT_FIELD_MESSAGES.reason } });
    expect(validateReportForm({ reason: 'other', body: '  ' })).toEqual({ ok: false, errors: { body: REPORT_FIELD_MESSAGES.bodyRequired } });
    expect(validateReportForm({ reason: 'spam', body: '가'.repeat(1001) })).toEqual({
      ok: false,
      errors: { body: REPORT_FIELD_MESSAGES.bodyTooLong },
    });
    expect(validateReportForm({ reason: 'spam', body: `  ${'가'.repeat(1000)}  ` })).toMatchObject({ ok: true });
    expect(validateReportForm({ reason: 'no_show', body: '  ' })).toEqual({ ok: true, reason: 'no_show', body: null });
    expect(validateReportForm({ reason: 'other', body: ' 설명 ' })).toEqual({ ok: true, reason: 'other', body: '설명' });
  });
});
