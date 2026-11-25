/**
 * 개발 전용 예시 데이터 (HANPAN_DEV_SEED_MARKER).
 *
 * - 이 파일은 src/data/index.ts에서 개발/e2e 모드일 때만 동적 import 된다. 정적 import 금지.
 * - 프로덕션 빌드에 포함되지 않았는지 `npm run check:seed`가 검사한다 (scripts/seed-needles.json).
 * - 모든 제목은 '[예시]'로 시작하고, 닉네임·장소는 가상의 이름이다. 실존 매장명을 쓰지 않는다.
 * - 예시 공간(SEED_VENUES)은 가상의 이름·명백한 예시 주소('대전 서구 예시로 12 (가상 주소)')만 쓰고,
 *   링크는 null 또는 https://example.com/... 이다. 모임의 venueName과 같은 이름의 공간에 연결된다.
 * - 개발용 테스트 계정(로그인 화면에서 선택)과 예시 게스트도 여기서 만든다. 모든 닉네임은 '예시'로 시작한다.
 * - 참가 행은 모임의 인원 수(confirmed/pending/waitlist, 모임장 포함)와 정확히 맞게 생성한다(seed.test.ts가 검사).
 */
import { CATEGORIES } from '../../domain/categories';
import type { AttendanceStatus, Meeting, ParticipantStatus, RegionCode, VenueType } from '../types';
import { addDaysToDateKey, kstDateTimeToIso, toKstDateKey } from '../../lib/date';
import type {
  MockCategoryRecord,
  MockDb,
  MockMeetingRecord,
  MockParticipantRecord,
  MockProfileRecord,
  MockReportRecord,
  MockVenueRecord,
} from './records';

export type { MockMeetingRecord } from './records';

export const DEV_SEED_MARKER = 'HANPAN_DEV_SEED_MARKER';

/** 로그인 화면의 개발용 테스트 계정 id */
export const DEV_ACCOUNT_IDS = {
  /** 예시 모임을 주최하고 여러 상태의 신청 내역이 있는 일반 사용자 */
  hostA: 'dev-user-a',
  /** 신청 내역이 없는 일반 사용자 */
  userB: 'dev-user-b',
  /** 최초 설정(닉네임·약관 동의) 전 사용자 */
  newcomer: 'dev-user-new',
  /** 관리자 권한 계정 */
  admin: 'dev-user-admin',
} as const;

type Schedule = { day: number; time: string } | { hoursFromNow: number };

interface SeedSpec
  extends Omit<
    Meeting,
    'startAt' | 'endAt' | 'createdAt' | 'pendingCount' | 'waitlistCount' | 'notice' | 'venueNote' | 'cancelReason' | 'imageUrl' | 'venueId'
  > {
  schedule: Schedule;
  createdHoursAgo: number;
  pendingCount?: number;
  waitlistCount?: number;
  notice?: string | null;
  venueNote?: string | null;
  cancelReason?: string | null;
  hidden?: boolean;
  /** 개발용 테스트 계정의 참가 행 (seed 참가자 생성 시 먼저 넣는다) */
  devParticipants?: readonly DevParticipantSpec[];
  /** 취소된 모임에서 'meeting_cancelled'로 바뀐 게스트 수(테스트 계정 포함) */
  meetingCancelledGuests?: number;
}

interface DevParticipantSpec {
  userId: string;
  status: ParticipantStatus;
  attendance?: AttendanceStatus;
  message?: string | null;
}

const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

const SPECS: readonly SeedSpec[] = [
  {
    id: 'seed-meeting-01',
    hostId: 'seed-host-01',
    hostNickname: '예시모임장A',
    categoryId: 'party',
    gameName: '코드네임',
    title: '[예시] 퇴근하고 코드네임 한 판',
    description: '개발용 예시 모임입니다. 평일 저녁에 편하게 모여 코드네임을 해요.',
    schedule: { hoursFromNow: 3 },
    durationMinutes: 120,
    regionCode: 'dunsan_tanbang',
    venueName: '보드게임 카페 A',
    minParticipants: 4,
    maxParticipants: 6,
    confirmedCount: 2,
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 5,
  },
  {
    id: 'seed-meeting-02',
    hostId: 'seed-host-02',
    hostNickname: '예시모임장B',
    categoryId: 'deduction',
    gameName: '아발론',
    title: '[예시] 저녁에 아발론 같이 하실 분',
    description: '개발용 예시 모임입니다. 처음 오셔도 룰을 설명해 드려요.',
    schedule: { day: 1, time: '19:00' },
    durationMinutes: 150,
    regionCode: 'dunsan_tanbang',
    venueName: '보드게임 카페 B',
    minParticipants: 5,
    maxParticipants: 8,
    confirmedCount: 5,
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: true,
    status: 'open',
    createdHoursAgo: 30,
    devParticipants: [{ userId: DEV_ACCOUNT_IDS.hostA, status: 'confirmed' }],
  },
  {
    id: 'seed-meeting-03',
    hostId: 'seed-host-03',
    hostNickname: '예시모임장C',
    categoryId: 'strategy',
    gameName: '테라 미스티카',
    title: '[예시] 전략게임 진득하게 한 판',
    description: '개발용 예시 모임입니다. 4시간 정도 긴 전략 게임을 해요.',
    schedule: { day: 2, time: '13:00' },
    durationMinutes: 240,
    regionCode: 'gung_bongmyeong',
    venueName: '보드게임 카페 C',
    minParticipants: 3,
    maxParticipants: 4,
    confirmedCount: 4,
    waitlistCount: 1,
    skillLevel: 'experienced',
    approvalMode: 'manual',
    allowWaitlist: true,
    status: 'open',
    createdHoursAgo: 50,
    devParticipants: [
      { userId: DEV_ACCOUNT_IDS.hostA, status: 'waitlisted', message: '[예시] 자리가 나면 꼭 참여하고 싶어요.' },
    ],
  },
  {
    id: 'seed-meeting-04',
    hostId: 'seed-host-04',
    hostNickname: '예시모임장D',
    categoryId: 'murder_mystery',
    gameName: null,
    title: '[예시] 머더미스터리 한 자리 모집',
    description: '개발용 예시 모임입니다. 시나리오 스포일러 없이 진행해요.',
    schedule: { day: 2, time: '17:00' },
    durationMinutes: 180,
    regionCode: 'gwanjeo_gasuwon',
    venueName: '파티룸 D',
    minParticipants: 5,
    maxParticipants: 5,
    confirmedCount: 4,
    pendingCount: 1,
    skillLevel: 'anyone',
    approvalMode: 'manual',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 8,
  },
  {
    id: 'seed-meeting-05',
    hostId: 'seed-host-05',
    hostNickname: '예시모임장E',
    categoryId: 'mahjong_etc',
    gameName: '리치 마작',
    title: '[예시] 리치 마작 기초부터 같이 배워요',
    description: '개발용 예시 모임입니다. 점수 계산은 함께 확인하면서 진행해요.',
    schedule: { day: 3, time: '14:00' },
    durationMinutes: 180,
    regionCode: 'eunhaeng_daeheung',
    venueName: '보드게임 카페 E',
    minParticipants: 4,
    maxParticipants: 4,
    confirmedCount: 1,
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 2,
  },
  {
    id: 'seed-meeting-06',
    hostId: 'seed-host-06',
    hostNickname: '예시모임장F',
    categoryId: 'holdem_social',
    gameName: '텍사스 홀덤',
    title: '[예시] 칩만 쓰는 비금전 홀덤 친목 모임',
    description: '개발용 예시 모임입니다. 칩은 점수 표시용이며 돈이나 상품을 걸지 않아요.',
    notice: '현금·상금·경품을 걸지 않는 취미 모임입니다. 금전 거래를 제안하면 신고해 주세요.',
    schedule: { day: 3, time: '20:00' },
    durationMinutes: 150,
    regionCode: 'noeun_jijok',
    venueName: '보드게임 카페 F',
    minParticipants: 4,
    maxParticipants: 8,
    confirmedCount: 3,
    skillLevel: 'anyone',
    approvalMode: 'manual',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 20,
  },
  {
    // 35자 제목 + 30자 장소명 (긴 텍스트 줄바꿈 확인용)
    id: 'seed-meeting-07',
    hostId: 'seed-host-07',
    hostNickname: '예시모임장G',
    categoryId: 'party',
    gameName: '딕싯',
    title: '[예시] 퇴근 후 가볍게 즐기는 파티게임 모임, 초보도 환영해요',
    description: '개발용 예시 모임입니다. 긴 제목과 긴 장소명이 화면에서 어떻게 보이는지 확인하기 위한 데이터예요.',
    schedule: { day: 4, time: '15:00' },
    durationMinutes: 180,
    regionCode: 'dunsan_tanbang',
    venueName: '보드게임 카페 A 둔산점 2층 단체석 안쪽 넓은 테이블',
    minParticipants: 4,
    maxParticipants: 10,
    confirmedCount: 6,
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: true,
    status: 'open',
    createdHoursAgo: 1,
  },
  {
    // 장소 미정 + 최소 인원 미달
    id: 'seed-meeting-08',
    hostId: 'seed-host-08',
    hostNickname: '예시모임장H',
    categoryId: 'deduction',
    gameName: '마피아',
    title: '[예시] 장소는 함께 정하는 마피아 게임',
    description: '개발용 예시 모임입니다. 인원이 모이면 장소를 함께 정해요.',
    venueNote: '참가가 확정되면 인원에 맞춰 장소를 정해요.',
    schedule: { day: 4, time: '19:30' },
    durationMinutes: 120,
    regionCode: 'etc_daejeon',
    venueName: null,
    minParticipants: 6,
    maxParticipants: 10,
    confirmedCount: 3,
    skillLevel: 'anyone',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 12,
  },
  {
    // 모임장이 수동으로 모집 마감
    id: 'seed-meeting-09',
    hostId: 'seed-host-03',
    hostNickname: '예시모임장C',
    categoryId: 'strategy',
    gameName: '테라포밍 마스',
    title: '[예시] 테라포밍 마스 확장판 같이 해요',
    description: '개발용 예시 모임입니다. 모임장이 모집을 마감했어요.',
    schedule: { day: 5, time: '18:00' },
    durationMinutes: 240,
    regionCode: 'gung_bongmyeong',
    venueName: '보드게임 카페 C',
    minParticipants: 3,
    maxParticipants: 5,
    confirmedCount: 3,
    skillLevel: 'experienced',
    approvalMode: 'manual',
    allowWaitlist: false,
    status: 'closed',
    createdHoursAgo: 70,
    devParticipants: [{ userId: DEV_ACCOUNT_IDS.hostA, status: 'rejected' }],
  },
  {
    // 취소됨 → 목록에서 제외
    id: 'seed-meeting-10',
    hostId: 'seed-host-09',
    hostNickname: '예시모임장I',
    categoryId: 'party',
    gameName: '젠가',
    title: '[예시] 취소된 젠가 모임',
    description: '개발용 예시 모임입니다. 취소된 모임은 탐색 목록에 나오지 않아야 해요.',
    cancelReason: '모임장 사정으로 취소되었어요.',
    schedule: { day: 5, time: '14:00' },
    durationMinutes: 90,
    regionCode: 'eunhaeng_daeheung',
    venueName: '보드게임 카페 E',
    minParticipants: 3,
    maxParticipants: 6,
    // 취소된 모임은 모임장만 확정 상태로 남는다(DB 규칙: 카운트 1/0/0)
    confirmedCount: 1,
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'cancelled',
    createdHoursAgo: 40,
    devParticipants: [{ userId: DEV_ACCOUNT_IDS.hostA, status: 'meeting_cancelled' }],
    meetingCancelledGuests: 2,
  },
  {
    // 이미 끝난 모임 → 목록에서 제외
    id: 'seed-meeting-11',
    hostId: 'seed-host-02',
    hostNickname: '예시모임장B',
    categoryId: 'deduction',
    gameName: '마피아',
    title: '[예시] 이미 끝난 마피아 모임',
    description: '개발용 예시 모임입니다. 지난 모임은 탐색 목록에 나오지 않아야 해요.',
    schedule: { hoursFromNow: -26 },
    durationMinutes: 120,
    regionCode: 'dunsan_tanbang',
    venueName: '보드게임 카페 B',
    minParticipants: 5,
    maxParticipants: 8,
    confirmedCount: 7,
    skillLevel: 'anyone',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 120,
    devParticipants: [{ userId: DEV_ACCOUNT_IDS.hostA, status: 'confirmed', attendance: 'attended' }],
  },
  {
    // 이미 시작한 모임 → 목록에서 제외
    id: 'seed-meeting-12',
    hostId: DEV_ACCOUNT_IDS.hostA,
    hostNickname: '예시사용자A',
    categoryId: 'party',
    gameName: '할리갈리',
    title: '[예시] 지금 진행 중인 할리갈리 모임',
    description: '개발용 예시 모임입니다. 이미 시작한 모임은 탐색 목록에 나오지 않아야 해요.',
    schedule: { hoursFromNow: -1 },
    durationMinutes: 180,
    regionCode: 'gung_bongmyeong',
    venueName: '보드게임 카페 H',
    minParticipants: 3,
    maxParticipants: 6,
    confirmedCount: 4,
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 48,
  },
  {
    id: 'seed-meeting-13',
    hostId: DEV_ACCOUNT_IDS.hostA,
    hostNickname: '예시사용자A',
    categoryId: 'murder_mystery',
    gameName: null,
    title: '[예시] 머더미스터리 입문 시나리오',
    description: '개발용 예시 모임입니다. 처음 해보는 분을 위한 짧은 시나리오예요.',
    schedule: { day: 6, time: '13:00' },
    durationMinutes: 150,
    regionCode: 'noeun_jijok',
    venueName: '파티룸 G',
    minParticipants: 4,
    maxParticipants: 6,
    confirmedCount: 2,
    pendingCount: 2,
    skillLevel: 'beginner_welcome',
    approvalMode: 'manual',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 4,
  },
  {
    id: 'seed-meeting-14',
    hostId: 'seed-host-01',
    hostNickname: '예시모임장A',
    categoryId: 'strategy',
    gameName: '카탄',
    title: '[예시] 카탄 세 판 연속 리그전',
    description: '개발용 예시 모임입니다. 세 판의 점수를 합산해요.',
    schedule: { day: 6, time: '19:00' },
    durationMinutes: 210,
    regionCode: 'dunsan_tanbang',
    venueName: '보드게임 카페 A',
    minParticipants: 3,
    maxParticipants: 4,
    confirmedCount: 2,
    skillLevel: 'anyone',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 16,
  },
  {
    id: 'seed-meeting-15',
    hostId: 'seed-host-10',
    hostNickname: '예시모임장J',
    categoryId: 'party',
    gameName: '할리갈리',
    title: '[예시] 할리갈리 · 젠가 가볍게',
    description: '개발용 예시 모임입니다. 짧은 게임 위주로 여러 판 해요.',
    schedule: { day: 1, time: '20:00' },
    durationMinutes: 120,
    regionCode: 'gung_bongmyeong',
    venueName: '보드게임 카페 H',
    minParticipants: 3,
    maxParticipants: 6,
    confirmedCount: 3,
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 26,
  },
  {
    // 운영자가 숨긴 모임 → 목록·상세에서 제외
    id: 'seed-meeting-16',
    hostId: 'seed-host-11',
    hostNickname: '예시모임장K',
    categoryId: 'holdem_social',
    gameName: '텍사스 홀덤',
    title: '[예시] 운영 정책 위반으로 숨겨진 모임',
    description: '개발용 예시 모임입니다. 숨김 처리된 모임은 어디에도 노출되지 않아야 해요.',
    schedule: { day: 2, time: '21:00' },
    durationMinutes: 120,
    regionCode: 'noeun_jijok',
    venueName: '보드게임 카페 F',
    minParticipants: 4,
    maxParticipants: 8,
    confirmedCount: 2,
    skillLevel: 'anyone',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    createdHoursAgo: 6,
    hidden: true,
  },
];

/* ------------------------------------------------------------------ */
/* 예시 공간 (가상)                                                      */
/* ------------------------------------------------------------------ */

interface SeedVenueSpec {
  id: string;
  name: string;
  regionCode: RegionCode;
  venueType: VenueType;
  address: string;
  websiteUrl: string | null;
  bookingUrl: string | null;
  description: string;
  isPublic: boolean;
  /** 정보 확인일: 며칠 전(없으면 확인일 없음) */
  verifiedDaysAgo: number | null;
}

/**
 * 예시 공간. 이름은 SPECS의 venueName과 같고, 권역은 그 공간을 쓰는 모임의 권역과 같다(seed.test.ts가 검사).
 * 링크는 https://example.com/... 또는 null(실제 URL 금지).
 */
export const SEED_VENUES: readonly SeedVenueSpec[] = [
  {
    id: 'seed-venue-01',
    name: '보드게임 카페 A',
    regionCode: 'dunsan_tanbang',
    venueType: 'board_game_cafe',
    address: '대전 서구 예시로 12 (가상 주소)',
    websiteUrl: 'https://example.com/venues/a',
    bookingUrl: 'https://example.com/venues/a/booking',
    description: '[예시] 개발용 가상 공간이에요. 실제 매장 정보가 아니에요. 단체석이 있다고 가정한 예시 설명이에요.',
    isPublic: true,
    verifiedDaysAgo: 3,
  },
  {
    id: 'seed-venue-02',
    name: '보드게임 카페 B',
    regionCode: 'dunsan_tanbang',
    venueType: 'board_game_cafe',
    address: '대전 서구 예시대로 34 (가상 주소)',
    websiteUrl: 'https://example.com/venues/b',
    bookingUrl: null,
    description: '[예시] 개발용 가상 공간이에요. 실제 매장 정보가 아니에요.',
    isPublic: true,
    verifiedDaysAgo: 12,
  },
  {
    id: 'seed-venue-03',
    name: '보드게임 카페 C',
    regionCode: 'gung_bongmyeong',
    venueType: 'board_game_cafe',
    address: '대전 유성구 예시로 56 (가상 주소)',
    websiteUrl: null,
    bookingUrl: null,
    description: '[예시] 개발용 가상 공간이에요. 정보 확인일이 없는 경우를 보여 줘요.',
    isPublic: true,
    verifiedDaysAgo: null,
  },
  {
    id: 'seed-venue-04',
    name: '파티룸 D',
    regionCode: 'gwanjeo_gasuwon',
    venueType: 'party_room',
    address: '대전 서구 예시남로 78, 예시빌딩 2층 (가상 주소)',
    websiteUrl: null,
    bookingUrl: 'https://example.com/venues/d/booking',
    description: '[예시] 개발용 가상 파티룸이에요. 실제 공간 정보가 아니에요.',
    isPublic: true,
    verifiedDaysAgo: 20,
  },
  {
    id: 'seed-venue-05',
    name: '보드게임 카페 E',
    regionCode: 'eunhaeng_daeheung',
    venueType: 'board_game_cafe',
    address: '대전 중구 예시로 90 (가상 주소)',
    websiteUrl: 'https://example.com/venues/e',
    bookingUrl: null,
    description: '[예시] 개발용 가상 공간이에요. 실제 매장 정보가 아니에요.',
    isPublic: true,
    verifiedDaysAgo: 5,
  },
  {
    id: 'seed-venue-06',
    name: '보드게임 카페 F',
    regionCode: 'noeun_jijok',
    venueType: 'board_game_cafe',
    address: '대전 유성구 예시북로 11 (가상 주소)',
    websiteUrl: null,
    bookingUrl: null,
    description: '[예시] 개발용 가상 공간이에요. 실제 매장 정보가 아니에요.',
    isPublic: true,
    verifiedDaysAgo: 30,
  },
  {
    // 30자 공간명 + 긴 주소(줄바꿈 확인용)
    id: 'seed-venue-07',
    name: '보드게임 카페 A 둔산점 2층 단체석 안쪽 넓은 테이블',
    regionCode: 'dunsan_tanbang',
    venueType: 'board_game_cafe',
    address: '대전 서구 예시로 123번길 45, 예시빌딩 2층 단체석 안쪽 (긴 주소 줄바꿈 확인용 가상 주소)',
    websiteUrl: 'https://example.com/venues/a-long',
    bookingUrl: null,
    description: '[예시] 긴 이름과 긴 주소가 화면에서 어떻게 보이는지 확인하기 위한 가상 공간이에요.',
    isPublic: true,
    verifiedDaysAgo: 8,
  },
  {
    id: 'seed-venue-08',
    name: '보드게임 카페 H',
    regionCode: 'gung_bongmyeong',
    venueType: 'board_game_cafe',
    address: '대전 유성구 예시동로 22 (가상 주소)',
    websiteUrl: null,
    bookingUrl: null,
    description: '[예시] 개발용 가상 공간이에요. 실제 매장 정보가 아니에요.',
    isPublic: true,
    verifiedDaysAgo: 2,
  },
  {
    id: 'seed-venue-09',
    name: '파티룸 G',
    regionCode: 'noeun_jijok',
    venueType: 'party_room',
    address: '대전 유성구 예시서로 33 (가상 주소)',
    websiteUrl: 'https://example.com/venues/g',
    bookingUrl: 'https://example.com/venues/g/booking',
    description: '[예시] 개발용 가상 파티룸이에요. 실제 공간 정보가 아니에요.',
    isPublic: true,
    verifiedDaysAgo: 14,
  },
  {
    id: 'seed-venue-10',
    name: '모임 공간 I',
    regionCode: 'etc_daejeon',
    venueType: 'other',
    address: '대전 동구 예시로 7 (가상 주소)',
    websiteUrl: null,
    bookingUrl: null,
    description: '[예시] 카페·파티룸이 아닌 기타 유형의 가상 공간이에요.',
    isPublic: true,
    verifiedDaysAgo: 40,
  },
  {
    // 비공개 공간: 관리자 화면에서만 보인다
    id: 'seed-venue-11',
    name: '비공개 예시 공간 J',
    regionCode: 'dunsan_tanbang',
    venueType: 'party_room',
    address: '대전 서구 예시로 99 (가상 주소)',
    websiteUrl: null,
    bookingUrl: null,
    description: '[예시] 비공개 상태의 가상 공간이에요. 공개 화면에는 나오지 않아야 해요.',
    isPublic: false,
    verifiedDaysAgo: null,
  },
];

const SEED_VENUE_ID_BY_NAME = new Map(SEED_VENUES.map((venue) => [venue.name, venue.id]));

/** 예시 공간 레코드(기준 시각 now 기준 정보 확인일) */
export function createSeedVenues(now: Date): MockVenueRecord[] {
  const createdAt = new Date(now.getTime() - 60 * 24 * HOUR_MS).toISOString();
  return SEED_VENUES.map(({ verifiedDaysAgo, ...venue }) => ({
    ...venue,
    infoVerifiedAt: verifiedDaysAgo === null ? null : new Date(now.getTime() - verifiedDaysAgo * 24 * HOUR_MS).toISOString(),
    createdAt,
    updatedAt: createdAt,
    createdBy: DEV_ACCOUNT_IDS.admin,
  }));
}

/** 카테고리(전부 활성). 이름·정렬은 DB 기준 데이터와 같다 */
export function createSeedCategories(): MockCategoryRecord[] {
  return CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.id === 'holdem_social' ? '금전·경품을 걸지 않는 홀덤 모임만 열 수 있어요.' : '',
    sortOrder: category.sortOrder,
    isActive: true,
  }));
}

function resolveStart(schedule: Schedule, now: Date, todayKey: string): string {
  if ('hoursFromNow' in schedule) {
    const target = now.getTime() + schedule.hoursFromNow * HOUR_MS;
    // 30분 단위로 올림해 실제 모임처럼 정시/반 시각에 맞춘다.
    return new Date(Math.ceil(target / HALF_HOUR_MS) * HALF_HOUR_MS).toISOString();
  }
  return kstDateTimeToIso(addDaysToDateKey(todayKey, schedule.day), schedule.time);
}

/** 기준 시각(now)으로부터 앞으로 7일 안에 분포한 예시 모임을 만든다. 같은 now면 항상 같은 결과. */
export function createSeedMeetings(now: Date): MockMeetingRecord[] {
  const todayKey = toKstDateKey(now);
  const venueIdFor = (name: string): string => {
    const id = SEED_VENUE_ID_BY_NAME.get(name);
    if (!id) throw new Error(`seed: 예시 공간 목록에 없는 공간 이름입니다: ${name}`);
    return id;
  };

  return SPECS.map((spec) => {
    const {
      schedule,
      createdHoursAgo,
      hidden,
      devParticipants: _devParticipants,
      meetingCancelledGuests: _meetingCancelledGuests,
      ...rest
    } = spec;
    const startAt = resolveStart(schedule, now, todayKey);
    const endAt = new Date(Date.parse(startAt) + spec.durationMinutes * 60 * 1000).toISOString();
    const createdAt = new Date(now.getTime() - createdHoursAgo * HOUR_MS).toISOString();
    const record: MockMeetingRecord = {
      ...rest,
      notice: spec.notice ?? null,
      venueId: spec.venueName ? venueIdFor(spec.venueName) : null,
      venueNote: spec.venueNote ?? null,
      pendingCount: spec.pendingCount ?? 0,
      waitlistCount: spec.waitlistCount ?? 0,
      cancelReason: spec.cancelReason ?? null,
      imageUrl: null,
      startAt,
      endAt,
      createdAt,
    };
    if (spec.status === 'cancelled') {
      // 생성 1시간 뒤에 취소했다고 가정한다.
      record.cancelledAt = new Date(Date.parse(createdAt) + HOUR_MS).toISOString();
    }
    if (hidden) {
      record.hidden = true;
      record.hiddenReason = '[예시] 운영 정책 확인을 위해 숨김 처리했어요.';
    }
    return record;
  });
}

/* ------------------------------------------------------------------ */
/* 사용자(프로필)와 참가 신청                                            */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * HOUR_MS;

interface DevAccountSpec {
  id: string;
  nickname: string;
  description: string;
  onboarded: boolean;
  isAdmin?: boolean;
  regionCode?: MockProfileRecord['regionCode'];
  bio?: string;
  favoriteCategoryIds?: MockProfileRecord['favoriteCategoryIds'];
}

/** 로그인 화면에 보이는 개발용 테스트 계정. 실제 사용자가 아니다. */
const DEV_ACCOUNTS: readonly DevAccountSpec[] = [
  {
    id: DEV_ACCOUNT_IDS.hostA,
    nickname: '예시사용자A',
    description: '일반 사용자 · 예시 모임 주최·신청 내역 있음',
    onboarded: true,
    regionCode: 'dunsan_tanbang',
    bio: '[예시] 개발용 테스트 계정이에요.',
    favoriteCategoryIds: ['deduction', 'murder_mystery'],
  },
  {
    id: DEV_ACCOUNT_IDS.userB,
    nickname: '예시사용자B',
    description: '일반 사용자 · 신청 내역 없음',
    onboarded: true,
  },
  {
    id: DEV_ACCOUNT_IDS.newcomer,
    nickname: '예시신규사용자',
    description: '최초 설정(닉네임·약관 동의) 전 사용자',
    onboarded: false,
  },
  {
    id: DEV_ACCOUNT_IDS.admin,
    nickname: '예시관리계정',
    description: '관리자 권한 · 관리자 도구(/admin) 사용 가능',
    onboarded: true,
    isAdmin: true,
  },
];

const SEED_GUEST_COUNT = 10;

/** seed 모임의 게스트로만 쓰이는 예시 사용자 (로그인 불가) */
function seedGuestId(index: number): string {
  return `seed-guest-${String(index + 1).padStart(2, '0')}`;
}

const PENDING_MESSAGES: readonly (string | null)[] = [
  '[예시] 처음인데 참여해도 괜찮을까요?',
  null,
  '[예시] 30분 정도 늦을 수 있어요.',
];

function createSeedProfiles(now: Date, meetings: readonly MockMeetingRecord[]): MockProfileRecord[] {
  const agreedAt = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const base = (id: string, nickname: string): MockProfileRecord => ({
    id,
    nickname,
    regionCode: null,
    bio: '',
    favoriteCategoryIds: [],
    status: 'active',
    termsAgreedAt: agreedAt,
    privacyAgreedAt: agreedAt,
    deletionRequestedAt: null,
    isAdmin: false,
    createdAt: agreedAt,
  });

  const profiles = new Map<string, MockProfileRecord>();
  for (const account of DEV_ACCOUNTS) {
    profiles.set(account.id, {
      ...base(account.id, account.nickname),
      regionCode: account.regionCode ?? null,
      bio: account.bio ?? '',
      favoriteCategoryIds: [...(account.favoriteCategoryIds ?? [])],
      termsAgreedAt: account.onboarded ? agreedAt : null,
      privacyAgreedAt: account.onboarded ? agreedAt : null,
      isAdmin: account.isAdmin ?? false,
      devAccountDescription: account.description,
    });
  }
  for (const meeting of meetings) {
    // hostId가 null이면 모임장 계정이 삭제된 모임(프로필 없음)
    if (meeting.hostId && !profiles.has(meeting.hostId)) {
      profiles.set(meeting.hostId, base(meeting.hostId, meeting.hostNickname ?? meeting.hostId));
    }
  }
  for (let index = 0; index < SEED_GUEST_COUNT; index += 1) {
    const id = seedGuestId(index);
    profiles.set(id, base(id, `예시참가자${String(index + 1).padStart(2, '0')}`));
  }
  return [...profiles.values()];
}

/**
 * 모임의 인원 수(confirmed/pending/waitlist)와 정확히 맞는 참가 행을 만든다.
 * 모임장 1행(confirmed) → 테스트 계정 행 → 나머지는 예시 게스트로 채운다.
 */
function createRoster(meeting: MockMeetingRecord, spec: SeedSpec | undefined, now: Date): MockParticipantRecord[] {
  const nowMs = now.getTime();
  const createdMs = Date.parse(meeting.createdAt);
  const timeAt = (step: number) =>
    new Date(Math.min(createdMs + step * 10 * 60 * 1000, nowMs - 60 * 1000)).toISOString();
  const meetingNo = meeting.id.replace(/^seed-meeting-/, '');
  const rows: MockParticipantRecord[] = [];

  const push = (userId: string, status: ParticipantStatus, extra: Partial<MockParticipantRecord> = {}) => {
    const appliedAt = timeAt(rows.length);
    const decided = rows.length > 0 && status !== 'pending' && status !== 'waitlisted';
    rows.push({
      id: `seed-p-${meetingNo}-${String(rows.length + 1).padStart(2, '0')}`,
      meetingId: meeting.id,
      userId,
      role: userId === meeting.hostId ? 'host' : 'guest',
      status,
      attendance: 'unknown',
      message: null,
      appliedAt,
      decidedAt: decided ? appliedAt : null,
      confirmedAt: status === 'confirmed' || status === 'meeting_cancelled' ? appliedAt : null,
      cancelledAt: status === 'meeting_cancelled' ? (meeting.cancelledAt ?? appliedAt) : null,
      attendanceMarkedAt: null,
      ...extra,
    });
  };

  // 모임장 계정이 삭제된 모임은 모임장 참가 행도 없다(DB: profiles 삭제 시 cascade)
  if (meeting.hostId) push(meeting.hostId, 'confirmed');
  for (const dev of spec?.devParticipants ?? []) {
    const attendance = dev.attendance ?? 'unknown';
    push(dev.userId, dev.status, {
      message: dev.message ?? null,
      attendance,
      attendanceMarkedAt: attendance !== 'unknown' ? meeting.endAt : null,
    });
  }

  let guestIndex = 0;
  const nextGuest = () => {
    while (rows.some((row) => row.userId === seedGuestId(guestIndex))) guestIndex += 1;
    const id = seedGuestId(guestIndex);
    guestIndex += 1;
    return id;
  };
  const fill = (status: ParticipantStatus, target: number) => {
    let have = rows.filter((row) => row.status === status).length;
    let messageIndex = 0;
    while (have < target) {
      const message = status === 'pending' ? (PENDING_MESSAGES[messageIndex % PENDING_MESSAGES.length] ?? null) : null;
      messageIndex += 1;
      push(nextGuest(), status, { message });
      have += 1;
    }
  };

  fill('confirmed', meeting.confirmedCount);
  fill('pending', meeting.pendingCount);
  fill('waitlisted', meeting.waitlistCount);
  if (meeting.status === 'cancelled') fill('meeting_cancelled', spec?.meetingCancelledGuests ?? 0);
  return rows;
}

/**
 * 관리자 화면 확인용 예시 신고(예시 사용자가 접수). 본문은 '[예시]'로 시작한다.
 * 기준 모임(SPECS)이 없으면(테스트가 다른 모임을 넘긴 경우) 사용자 대상 신고만 남는다.
 */
function createSeedReports(now: Date, meetings: readonly MockMeetingRecord[]): MockReportRecord[] {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR_MS).toISOString();
  const has = (id: string) => meetings.some((meeting) => meeting.id === id);
  const reports: MockReportRecord[] = [];
  if (has('seed-meeting-06')) {
    reports.push({
      id: 'seed-report-01',
      reporterId: seedGuestId(0),
      targetType: 'meeting',
      targetMeetingId: 'seed-meeting-06',
      targetUserId: null,
      reason: 'gambling',
      body: '[예시] 칩을 현금으로 바꿔 준다는 이야기가 있었어요. 확인 부탁드려요.',
      status: 'received',
      adminNote: null,
      handledBy: null,
      handledAt: null,
      createdAt: at(2),
    });
  }
  reports.push({
    id: 'seed-report-02',
    reporterId: seedGuestId(1),
    targetType: 'user',
    targetMeetingId: null,
    targetUserId: 'seed-host-08',
    reason: 'no_show',
    body: '[예시] 확정 후 연락 없이 두 번 오지 않았어요.',
    status: 'reviewing',
    adminNote: '[예시] 출석 기록 확인 중',
    handledBy: null,
    handledAt: null,
    createdAt: at(30),
  });
  if (has('seed-meeting-07')) {
    reports.push({
      id: 'seed-report-03',
      reporterId: seedGuestId(2),
      targetType: 'meeting',
      targetMeetingId: 'seed-meeting-07',
      targetUserId: null,
      reason: 'spam',
      body: '',
      status: 'dismissed',
      adminNote: '[예시] 일반 모임으로 확인',
      handledBy: DEV_ACCOUNT_IDS.admin,
      handledAt: at(20),
      createdAt: at(50),
    });
  }
  return reports;
}

/**
 * 개발용 mock 저장소 초기 상태: 예시 모임 + 테스트 계정·예시 사용자 + 인원 수와 일치하는 참가 행
 * + 예시 공간·카테고리·신고. meetings를 넘기면 그 모임으로 만든다(테스트용). 같은 now면 항상 같은 결과.
 */
export function createSeedDb(now: Date, meetings: readonly MockMeetingRecord[] = createSeedMeetings(now)): MockDb {
  const specById = new Map(SPECS.map((spec) => [spec.id, spec]));
  const ownMeetings = meetings.map((meeting) => ({ ...meeting }));
  const profiles = createSeedProfiles(now, ownMeetings);
  return {
    meetings: ownMeetings,
    participants: ownMeetings.flatMap((meeting) => createRoster(meeting, specById.get(meeting.id), now)),
    profiles,
    venues: createSeedVenues(now),
    // 대상·신고자 프로필이 있는 신고만(테스트가 다른 모임을 넘긴 경우 대비)
    reports: createSeedReports(now, ownMeetings).filter(
      (report) =>
        profiles.some((profile) => profile.id === report.reporterId) &&
        (report.targetUserId === null || profiles.some((profile) => profile.id === report.targetUserId)),
    ),
    categories: createSeedCategories(),
    seq: 1,
  };
}
