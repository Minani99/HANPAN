import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 색 대비(WCAG 2.x 상대 휘도) — src/styles/index.css의 @theme 색 토큰을 직접 읽어 계산한다.
 * 토큰 값이 바뀌면 이 테스트가 새 값으로 다시 계산한다. 기준에 못 미치는 쌍은 토큰을 바꾸지 않고
 * '알려진 예외'에 실제 비율과 함께 적는다(사용자 결정 필요 — docs/NEXT_STEPS.md, docs/UI_SPEC.md §2.1).
 * 예외의 비율이 바뀌거나 기준을 넘게 되면 실패해서 기록을 고치게 한다.
 */

const CSS = readFileSync(join(import.meta.dirname, 'index.css'), 'utf8');

function readThemeColors(css: string): Record<string, string> {
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const colors: Record<string, string> = {};
  for (const match of theme.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    colors[match[1]!] = match[2]!.toLowerCase();
  }
  return colors;
}

const COLORS = readThemeColors(CSS);

function token(name: string): string {
  const value = COLORS[name];
  if (!value) throw new Error(`index.css @theme에 --color-${name}(#rrggbb)가 없습니다`);
  return value;
}

/** WCAG 상대 휘도 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** [글자(또는 표시) 토큰, 배경 토큰, 최소 비율, 쓰는 곳] */
type Pair = readonly [string, string, number, string];

const TEXT = 4.5; // WCAG 1.4.3 본문 글자 AA
const NON_TEXT = 3; // WCAG 1.4.11 비텍스트(포커스 링 등)

const PAIRS: readonly Pair[] = [
  ['ink', 'surface', TEXT, '제목·버튼 글자'],
  ['ink', 'soft', TEXT, '옅은 면(상태 표시·안내) 위 제목'],
  ['ink', 'hover', TEXT, '목록 행 hover 위 제목'],
  ['text', 'surface', TEXT, '본문'],
  ['text', 'soft', TEXT, '안내(Notice info)·개발용 띠'],
  ['text', 'hover', TEXT, '목록 행 hover 위 본문'],
  ['muted', 'surface', TEXT, '보조 정보(일시·장소·도움말)'],
  ['genre-text', 'genre-bg', TEXT, '장르 라벨'],
  ['status-text', 'status-bg', TEXT, '중립 상태 배지'],
  ['disabled-text', 'disabled-bg', TEXT, '비활성 버튼'],
  ['danger', 'danger-soft', TEXT, '오류 안내 상자'],
  ['danger', 'surface', TEXT, '오류 문구·위험 동작 버튼'],
  ['success', 'success-soft', TEXT, '성공 안내 상자'],
  ['success', 'surface', TEXT, '성공 문구'],
  ['warning', 'warning-soft', TEXT, '주의 안내 상자'],
  ['warning', 'surface', TEXT, '주의 문구'],
  ['white', 'ink', TEXT, 'Primary 버튼·선택된 칩·토스트'],
  ['focus', 'surface', NON_TEXT, '포커스 링'],
];

/**
 * 알려진 예외(v3 토큰 결정 — 고치지 않음, 사용자 결정 필요). ratio는 소수 둘째 자리.
 * - muted on soft·hover: 목록 행(데스크톱) hover 때 보조 정보, 로그인 화면 개발용 계정 hover 설명. 평소(흰 배경)는 4.52:1로 통과.
 * - border on surface: 입력·칩 테두리(WCAG 1.4.11 비텍스트 3:1 미달). docs/UI_SPEC.md §3.3 추가 제안 B.
 */
const KNOWN: ReadonlyArray<{ pair: Pair; ratio: number }> = [
  { pair: ['muted', 'soft', TEXT, '보조 정보가 옅은 면 위에 올 때'], ratio: 4.22 },
  { pair: ['muted', 'hover', TEXT, '목록 행 hover(데스크톱) 위 보조 정보'], ratio: 4.33 },
  { pair: ['border', 'surface', NON_TEXT, '입력·칩 테두리'], ratio: 1.23 },
];

describe('색 대비 (src/styles/index.css 토큰)', () => {
  it('토큰을 읽었다(색 토큰 이름이 바뀌면 이 테스트를 고친다)', () => {
    for (const name of new Set([...PAIRS, ...KNOWN.map((entry) => entry.pair)].flatMap(([fg, bg]) => [fg, bg]))) {
      expect(token(name)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(token('ink')).toBe('#191b1e');
  });

  it.each(PAIRS.map((pair) => [`${pair[0]} / ${pair[1]} ≥ ${pair[2]}:1 (${pair[3]})`, pair] as const))('%s', (_label, pair) => {
    const [fg, bg, min] = pair;
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });

  it.each(KNOWN.map((entry) => [`알려진 예외 ${entry.pair[0]} / ${entry.pair[1]} = ${entry.ratio}:1 (기준 ${entry.pair[2]}:1)`, entry] as const))(
    '%s',
    (_label, { pair, ratio }) => {
      const [fg, bg, min] = pair;
      const actual = round2(contrastRatio(token(fg), token(bg)));
      // 값이 바뀌면 기록(이 표·docs)을 고친다. 기준을 넘게 되면 PAIRS로 옮긴다.
      expect(actual).toBe(ratio);
      expect(actual).toBeLessThan(min);
    },
  );

  it('계산식 확인: 검정/흰색 21:1, 같은 색 1:1, WCAG 예시 #767676/흰색 ≈ 4.54:1', () => {
    expect(round2(contrastRatio('#000000', '#ffffff'))).toBe(21);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
    expect(round2(contrastRatio('#767676', '#ffffff'))).toBe(4.54);
  });
});
