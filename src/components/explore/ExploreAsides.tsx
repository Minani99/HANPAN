import { Link } from 'react-router';

interface AsideProps {
  eyebrow: string;
  title: string;
  body: string;
  to: string;
  linkLabel: string;
}

function Aside({ eyebrow, title, body, to, linkLabel }: AsideProps) {
  return (
    <div className="rounded-lg border border-border px-5 py-5 md:px-7 md:py-6.5">
      <p aria-hidden="true" className="text-eyebrow leading-tight font-extrabold tracking-label text-muted">
        {eyebrow}
      </p>
      <h2 className="mt-3 mb-2 text-lg leading-snug font-bold tracking-aside text-ink text-wrap-ko md:text-2xl">{title}</h2>
      <p className="text-sm leading-loose text-muted text-wrap-ko">{body}</p>
      <Link
        to={to}
        className="mt-2 inline-flex min-h-touch items-center gap-1 border-b border-ink text-sm font-bold text-ink transition-colors duration-150 hover:text-text"
      >
        {linkLabel}
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

/** 목록 아래 안내 2칸 (모임 만들기 / 공간 안내) */
export function ExploreAsides() {
  return (
    <section aria-label="더 둘러보기" className="mt-8.25 mb-8 grid gap-3 md:mt-13.5 md:mb-20 md:grid-cols-2 md:gap-5.5">
      <Aside
        eyebrow="HOST A GAME"
        title="함께할 사람을 찾고 있나요?"
        body="인원부터 일정까지. 길게 채팅할 필요 없이 한 번에 모임을 열어보세요."
        to="/meetings/new"
        linkLabel="모임 만들기"
      />
      <Aside
        eyebrow="FIND YOUR PLACE"
        title="게임할 공간도 한눈에."
        body="대전의 보드게임 카페와 파티룸 정보를 모으고 있어요."
        to="/venues"
        linkLabel="공간 안내 보기"
      />
    </section>
  );
}
