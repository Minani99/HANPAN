import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { PageContainer } from '../components/layout/PageContainer';
import { PageTitle } from '../components/layout/PageTitle';
import { MeetingListSkeleton } from '../components/meeting/MeetingList';
import { MeetingRow } from '../components/meeting/MeetingRow';
import { meetingParticipantsPath } from '../components/meeting/meetingText';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { ButtonLink } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Icon } from '../components/ui/Icon';
import { Tabs, tabId, tabPanelId } from '../components/ui/Tabs';
import { useDataAdapter } from '../data';
import type { Meeting, MyJoinedMeeting, ParticipantStatus } from '../data/types';
import { useAsyncData } from '../data/useAsyncData';
import {
  MY_MEETINGS_ROLES,
  MY_MEETINGS_ROLE_LABEL,
  MY_MEETINGS_TABS,
  MY_MEETINGS_TAB_LABEL,
  classifyHosted,
  classifyJoined,
  parseMyMeetingsRole,
  parseMyMeetingsTab,
  sortForTab,
  type MyMeetingsRole,
  type MyMeetingsTab,
} from '../domain/myMeetings';
import { ATTENDANCE_LABEL, PARTICIPANT_STATUS_LABEL } from '../domain/participation';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const TABS_ID = 'my-meetings';

const STATUS_TONE: Record<ParticipantStatus, BadgeTone> = {
  confirmed: 'success',
  pending: 'status',
  waitlisted: 'status',
  rejected: 'status',
  cancelled: 'status',
  meeting_cancelled: 'status',
};

const EMPTY_COPY: Record<MyMeetingsRole, Record<MyMeetingsTab, { title: string; description: string }>> = {
  applied: {
    upcoming: { title: '예정된 참가 모임이 없어요.', description: '가까운 날짜의 모임을 찾아 참가 신청해 보세요.' },
    waiting: { title: '승인이나 자리를 기다리는 신청이 없어요.', description: '승인제 모임이나 대기 신청은 여기에서 확인할 수 있어요.' },
    done: { title: '아직 참가를 마친 모임이 없어요.', description: '참가가 확정된 모임이 끝나면 여기에 모여요.' },
    cancelled: { title: '취소되거나 확정되지 않은 신청이 없어요.', description: '취소한 신청, 취소된 모임, 거절된 신청이 여기에 보여요.' },
  },
  hosted: {
    upcoming: { title: '예정된 내 모임이 없어요.', description: '함께할 사람을 찾고 있다면 모임을 열어 보세요.' },
    waiting: { title: '승인을 기다리는 신청이 없어요.', description: '승인제 모임에 신청이 들어오면 여기에서 확인할 수 있어요.' },
    done: { title: '아직 끝난 내 모임이 없어요.', description: '진행을 마친 모임이 여기에 모여요.' },
    cancelled: { title: '취소한 모임이 없어요.', description: '취소한 모임은 여기에서 다시 확인할 수 있어요.' },
  },
};

interface JoinedRowModel {
  key: string;
  entry: MyJoinedMeeting;
}

/** 숨김 등으로 모임 정보를 읽을 수 없는 참가 행 */
function HiddenMeetingRow({ status }: { status: ParticipantStatus }) {
  return (
    <li className="border-b border-border py-5" data-testid="hidden-meeting-row">
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
        <Badge tone={STATUS_TONE[status]}>{PARTICIPANT_STATUS_LABEL[status]}</Badge>
      </p>
      <p className="mt-2 text-base font-heavy text-ink">모임 정보를 볼 수 없어요</p>
      <p className="mt-1 text-sm text-muted text-wrap-ko">운영 정책에 따라 비공개 처리된 모임일 수 있어요.</p>
    </li>
  );
}

/** 내 모임 (`/my/meetings`, 로그인·최초 설정 필요) */
export function MyMeetingsPage() {
  useDocumentTitle('내 모임');
  const adapter = useDataAdapter();
  const { userKey } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = parseMyMeetingsRole(searchParams.get('role'));
  const tab = parseMyMeetingsTab(searchParams.get('tab'));

  const data = useAsyncData(`my-meetings:${userKey}`, async () => ({
    mine: await adapter.listMyMeetings(),
    loadedAt: new Date(),
  }));

  const select = (next: { role?: MyMeetingsRole; tab?: MyMeetingsTab }) => {
    const params = new URLSearchParams();
    const nextRole = next.role ?? role;
    const nextTab = next.tab ?? (next.role && next.role !== role ? 'upcoming' : tab);
    if (nextRole !== 'applied') params.set('role', nextRole);
    if (nextTab !== 'upcoming') params.set('tab', nextTab);
    setSearchParams(params, { replace: true, preventScrollReset: true });
  };

  const grouped = useMemo(() => {
    if (!data.data) return null;
    const { mine, loadedAt } = data.data;
    const joined: Record<MyMeetingsTab, JoinedRowModel[]> = { upcoming: [], waiting: [], done: [], cancelled: [] };
    for (const entry of mine.joined) {
      joined[classifyJoined(entry, loadedAt)].push({ key: entry.participation.id, entry });
    }
    const hosted: Record<MyMeetingsTab, Meeting[]> = { upcoming: [], waiting: [], done: [], cancelled: [] };
    for (const meeting of mine.hosted) {
      for (const item of classifyHosted(meeting, loadedAt)) hosted[item].push(meeting);
    }
    for (const key of MY_MEETINGS_TABS) {
      joined[key] = sortForTab(joined[key], key, (row) => row.entry.meeting?.startAt ?? null);
      hosted[key] = sortForTab(hosted[key], key, (meeting) => meeting.startAt);
    }
    return { joined, hosted, loadedAt };
  }, [data.data]);

  const counts = grouped
    ? MY_MEETINGS_TABS.reduce(
        (acc, key) => ({ ...acc, [key]: role === 'applied' ? grouped.joined[key].length : grouped.hosted[key].length }),
        {} as Record<MyMeetingsTab, number>,
      )
    : null;

  return (
    <PageContainer className="pt-2 pb-12 md:pt-4 md:pb-20">
      <PageTitle title="내 모임" />

      <Tabs
        label="내 모임 구분"
        idPrefix={TABS_ID}
        items={MY_MEETINGS_ROLES.map((value) => ({ value, label: MY_MEETINGS_ROLE_LABEL[value] }))}
        value={role}
        onChange={(value) => select({ role: value })}
      />

      <div role="tabpanel" id={tabPanelId(TABS_ID)} aria-labelledby={tabId(TABS_ID, role)} data-testid="my-meetings-panel">
        <div role="group" aria-label="신청 상태" className="scrollbar-none -mx-1.5 flex gap-2 overflow-x-auto px-1.5 pt-4 pb-2">
          {MY_MEETINGS_TABS.map((value) => (
            <Chip key={value} selected={tab === value} onClick={() => select({ tab: value })}>
              {MY_MEETINGS_TAB_LABEL[value]}
              {counts ? <span className={tab === value ? 'text-white/80' : 'text-muted'}>{counts[value]}</span> : null}
            </Chip>
          ))}
        </div>

        {data.status === 'loading' ? <MeetingListSkeleton count={3} label="내 모임을 불러오는 중이에요." /> : null}
        {data.status === 'error' ? <ErrorState title="내 모임을 불러오지 못했어요." onRetry={data.retry} /> : null}

        {grouped ? (
          <MyMeetingsList role={role} tab={tab} grouped={grouped} />
        ) : null}
      </div>
    </PageContainer>
  );
}

interface GroupedMeetings {
  joined: Record<MyMeetingsTab, JoinedRowModel[]>;
  hosted: Record<MyMeetingsTab, Meeting[]>;
  loadedAt: Date;
}

function MyMeetingsList({ role, tab, grouped }: { role: MyMeetingsRole; tab: MyMeetingsTab; grouped: GroupedMeetings }) {
  const empty = EMPTY_COPY[role][tab];
  const items = role === 'applied' ? grouped.joined[tab] : grouped.hosted[tab];
  if (items.length === 0) {
    return (
      <EmptyState
        title={empty.title}
        description={empty.description}
        actions={
          role === 'applied' ? (
            <ButtonLink to="/">모임 찾기</ButtonLink>
          ) : (
            <ButtonLink to="/meetings/new">모임 만들기</ButtonLink>
          )
        }
      />
    );
  }

  if (role === 'applied') {
    return (
      <ul role="list" aria-label={`${MY_MEETINGS_ROLE_LABEL.applied} · ${MY_MEETINGS_TAB_LABEL[tab]}`} data-testid="my-meeting-list">
        {grouped.joined[tab].map(({ key, entry }) => {
          const { meeting, participation } = entry;
          if (!meeting) return <HiddenMeetingRow key={key} status={participation.status} />;
          const attendance =
            tab === 'done' && participation.attendance !== 'unknown' ? ATTENDANCE_LABEL[participation.attendance] : null;
          return (
            <MeetingRow
              key={key}
              meeting={meeting}
              now={grouped.loadedAt}
              headingLevel={2}
              badges={
                <>
                  <Badge tone={STATUS_TONE[participation.status]} data-testid="my-status-badge">
                    {PARTICIPANT_STATUS_LABEL[participation.status]}
                  </Badge>
                  {attendance ? <Badge tone="status">출석: {attendance}</Badge> : null}
                </>
              }
            />
          );
        })}
      </ul>
    );
  }

  return (
    <ul role="list" aria-label={`${MY_MEETINGS_ROLE_LABEL.hosted} · ${MY_MEETINGS_TAB_LABEL[tab]}`} data-testid="my-meeting-list">
      {grouped.hosted[tab].map((meeting) => (
        <MeetingRow
          key={meeting.id}
          meeting={meeting}
          now={grouped.loadedAt}
          headingLevel={2}
          badges={
            <>
              <Badge tone="status">내가 연 모임</Badge>
              {meeting.pendingCount > 0 ? <Badge tone="warning">승인 대기 {meeting.pendingCount}명</Badge> : null}
              {meeting.isHidden ? <Badge tone="danger">숨김 처리됨</Badge> : null}
            </>
          }
          actions={
            <Link
              to={meetingParticipantsPath(meeting.id)}
              className="inline-flex min-h-touch items-center gap-1 text-sm font-bold text-ink underline-offset-4 hover:underline"
            >
              참가자 관리
              <Icon name="chevron-right" size="1em" />
            </Link>
          }
        />
      ))}
    </ul>
  );
}
