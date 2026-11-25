import type { Region, RegionCode } from '../data/types';

/**
 * 대전 권역 기준값. 코드·이름·정렬값은 DB 기준 데이터(supabase/migrations/20261124000400_reference_data.sql)와 같다.
 * 추후 DB `regions`(또는 동등한 테이블)에서 내려오지만, 화면이 즉시 그려질 수 있도록 상수와 정렬 순서를 둔다.
 */
export const REGIONS: readonly Region[] = [
  { code: 'dunsan_tanbang', name: '둔산·탄방', sortOrder: 10 },
  { code: 'gung_bongmyeong', name: '궁동·봉명', sortOrder: 20 },
  { code: 'eunhaeng_daeheung', name: '은행·대흥', sortOrder: 30 },
  { code: 'noeun_jijok', name: '노은·지족', sortOrder: 40 },
  { code: 'gwanjeo_gasuwon', name: '관저·가수원', sortOrder: 50 },
  { code: 'etc_daejeon', name: '그 외 대전', sortOrder: 90 },
];

export const REGION_CODES: readonly RegionCode[] = REGIONS.map((region) => region.code);

const REGION_NAME = new Map<RegionCode, string>(REGIONS.map((r) => [r.code, r.name]));

export function isRegionCode(value: unknown): value is RegionCode {
  return typeof value === 'string' && REGION_NAME.has(value as RegionCode);
}

export function getRegionName(code: RegionCode): string {
  return REGION_NAME.get(code) ?? code;
}

export function sortRegions(regions: readonly Region[]): Region[] {
  return [...regions].sort((a, b) => a.sortOrder - b.sortOrder);
}
