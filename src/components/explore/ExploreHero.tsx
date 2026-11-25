import { HeroArt } from './HeroArt';

/** 홈 상단 카피 + (데스크톱) 오른쪽 그림. 그림 왼쪽은 흰색 사선 마스크로 잘라낸다. */
export function ExploreHero() {
  return (
    <section
      aria-labelledby="explore-hero-title"
      className="relative flex overflow-hidden md:min-h-69 md:border-b md:border-border"
    >
      <div className="relative z-2 flex-[1.12] bg-surface pt-8 pb-4.25 md:pt-12 md:pr-5 md:pb-10.5">
        <p
          aria-hidden="true"
          className="text-eyebrow leading-tight font-bold tracking-eyebrow-sm text-muted md:tracking-eyebrow"
        >
          DAEJEON BOARDGAME CLUB
        </p>
        <h1
          id="explore-hero-title"
          className="mt-3.5 mb-1.75 text-hero-sm leading-hero font-extrabold tracking-hero-sm text-ink text-wrap-ko md:mt-6 md:mb-3.25 md:text-hero md:tracking-hero"
        >
          이번 주, 같이 한 판.
        </h1>
        <p className="text-sm-plus leading-relaxed text-muted text-wrap-ko md:text-base md:leading-normal md:tracking-tight">
          대전에서 보드게임 할 사람, 지금 바로 만나보세요.
        </p>
      </div>
      <div aria-hidden="true" className="relative hidden flex-1 overflow-hidden md:-mr-7 md:block" data-testid="hero-art">
        <div className="absolute -top-7.5 -bottom-7.5 -left-21.25 z-1 w-32.5 -skew-x-13 bg-surface" />
        <HeroArt />
      </div>
    </section>
  );
}
