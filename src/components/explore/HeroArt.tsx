/**
 * 히어로 오른쪽 그림.
 * - `public/images/hero.jpg`가 있으면(빌드 시 감지, vite.config.ts) 그 사진을 저채도로 보여준다.
 * - 없으면 보드게임 테이블을 연상시키는 회색조 추상 SVG를 그린다.
 *   (시안의 base64 사진은 출처·라이선스를 확인할 수 없어 사용하지 않는다.)
 */
const HERO_IMAGE_URL: string = __HERO_IMAGE_URL__;

const HEX = 'M0 -18 L15.6 -9 L15.6 9 L0 18 L-15.6 9 L-15.6 -9 Z';

function Pawn({ x, y, fill }: { x: number; y: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-9 14 C-9 4 -5 0 0 0 C5 0 9 4 9 14 Z" fill={fill} />
      <circle cx="0" cy="-5" r="6.5" fill={fill} />
    </g>
  );
}

function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 640 300"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      focusable="false"
      aria-hidden="true"
    >
      {/* 테이블 */}
      <rect width="640" height="300" fill="#e7eaed" />
      <g stroke="#dfe3e7" strokeWidth="2">
        <path d="M-20 64 L660 18" />
        <path d="M-20 168 L660 122" />
        <path d="M-20 272 L660 226" />
      </g>

      {/* 카드 더미 */}
      <g transform="rotate(9 150 70)">
        <rect x="122" y="30" width="54" height="76" rx="6" fill="#dde1e5" />
        <rect x="118" y="25" width="54" height="76" rx="6" fill="#fafafb" stroke="#cbd0d6" strokeWidth="1.5" />
        <rect x="127" y="34" width="36" height="58" rx="3" fill="none" stroke="#dde1e5" strokeWidth="1.5" />
      </g>

      {/* 게임 보드 */}
      <g transform="rotate(-7 330 150)">
        <rect x="192" y="56" width="280" height="190" rx="10" fill="#f3f4f6" stroke="#d3d8dd" strokeWidth="2" />
        <rect x="208" y="72" width="248" height="158" rx="4" fill="none" stroke="#e0e4e8" strokeWidth="1.5" />
        <g stroke="#e3e7ea" strokeWidth="1.2">
          <path d="M243 72v158M278 72v158M314 72v158M349 72v158M385 72v158M420 72v158" />
          <path d="M208 104h248M208 135h248M208 167h248M208 198h248" />
        </g>
        <g transform="translate(296 138)">
          <path d={HEX} fill="#cdd3d9" />
        </g>
        <g transform="translate(327.2 138)">
          <path d={HEX} fill="#d9dee3" />
        </g>
        <g transform="translate(311.6 165)">
          <path d={HEX} fill="#c3cad1" />
        </g>
        <g transform="translate(342.8 165)">
          <path d={HEX} fill="#d3d8dd" />
        </g>
        <Pawn x={398} y={104} fill="#9aa2ab" />
        <Pawn x={414} y={188} fill="#b1b8c0" />
        <Pawn x={246} y={196} fill="#a5adb5" />
      </g>

      {/* 토큰 */}
      <circle cx="486" cy="86" r="11" fill="#bcc3ca" />
      <circle cx="509" cy="102" r="11" fill="#cfd4d9" />
      <circle cx="530" cy="80" r="8.5" fill="#a9b1ba" />
      <circle cx="236" cy="268" r="9" fill="#c4cad0" />

      {/* 손패 카드 */}
      <g transform="translate(168 272)">
        <rect x="-26" y="-74" width="52" height="74" rx="6" fill="#f6f7f8" stroke="#cbd0d6" strokeWidth="1.5" transform="rotate(-20)" />
        <rect x="-26" y="-74" width="52" height="74" rx="6" fill="#f8f9fa" stroke="#cbd0d6" strokeWidth="1.5" transform="rotate(-6)" />
        <rect x="-26" y="-74" width="52" height="74" rx="6" fill="#fafafb" stroke="#cbd0d6" strokeWidth="1.5" transform="rotate(8)" />
        <path d="M14 -52 l7 9 -7 9 -7 -9 z" fill="#c3c9cf" transform="rotate(8)" />
      </g>

      {/* 주사위 */}
      <g transform="rotate(14 512 232)">
        <rect x="492" y="212" width="40" height="40" rx="8" fill="#f7f8f9" stroke="#b5bcc4" strokeWidth="1.5" />
        <g fill="#8e959e">
          <circle cx="502" cy="222" r="3" />
          <circle cx="512" cy="232" r="3" />
          <circle cx="522" cy="242" r="3" />
        </g>
      </g>
      <g transform="rotate(-10 563 204)">
        <rect x="546" y="187" width="34" height="34" rx="7" fill="#eef0f2" stroke="#b5bcc4" strokeWidth="1.5" />
        <g fill="#8e959e">
          <circle cx="555" cy="196" r="2.6" />
          <circle cx="571" cy="196" r="2.6" />
          <circle cx="555" cy="212" r="2.6" />
          <circle cx="571" cy="212" r="2.6" />
        </g>
      </g>

      {/* 컵 */}
      <rect x="596" y="58" width="22" height="12" rx="6" fill="#cfd4d9" />
      <circle cx="574" cy="64" r="32" fill="#d5dadf" />
      <circle cx="574" cy="64" r="25" fill="#c9cfd5" />
      <circle cx="574" cy="64" r="19" fill="#b4bbc3" />
    </svg>
  );
}

export function HeroArt() {
  if (HERO_IMAGE_URL) {
    return (
      <img
        src={HERO_IMAGE_URL}
        alt=""
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover saturate-62 contrast-96"
      />
    );
  }
  return <HeroIllustration />;
}
