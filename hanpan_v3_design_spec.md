# HANPAN Design System v3 — 개발 기준

## 방향
- 서비스: 대전 지역 보드게임 모임 탐색 및 참가.
- 시각적 성격: 한국 로컬 커뮤니티 + 이벤트 탐색, 중립적인 편집 디자인.
- 기본 테마: 잉크 블랙 CTA. 화려한 포인트 컬러에 의존하지 않는다.
- 브랜드 색과 행동의 우선순위는 분리한다. 브랜드에는 색이 필요할 수 있지만 CTA는 명도·배치·문구로 우선순위를 만든다.
- 비교용 HTML 상단 Design Lab은 실제 제품에서는 제거.

## 토큰
| 이름 | 값 | 역할 |
|---|---|---|
| ink | `#191B1E` | 제목, 주요 행동, 선택 상태 |
| text | `#42464B` | 일반 본문 |
| muted | `#707781` | 보조 정보 |
| border | `#E5E8EB` | 구분선과 입력 테두리 |
| surface | `#FFFFFF` | 기본 바탕 |
| soft | `#F6F7F8` | 매우 옅은 면구분 |
| focus | `#486AA7` | 키보드 포커스, 장식용이 아님 |
| alternative navy | `#273348` | 대안 CTA 색상 |

### 색상 규칙
- 기본 CTA 1개만 강한 대비(잉크 블랙). 복수 행동이 나란히 있으면 보조 행동은 외곽선/텍스트.
- 카테고리별 강한 색 배경 금지. 장르 라벨은 `#F1F3F5`/`#4F5964` 사용.
- 마감: 중립 회색 배지와 비활성 CTA. 위험/오류는 별도 의미 색상 사용 가능(예: 접근 가능한 레드), 브랜드 컬러와 혼합하지 않음.
- 어두운 버튼의 hover는 명도를 조금 높이는 정도로 제한.

## 글꼴
- 기본: `SUIT Variable` (OFL-1.1). 공식 웹폰트: `https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2/fonts/variable/woff2/SUIT-Variable.css`.
- 폴백: `Apple SD Gothic Neo`, `Noto Sans CJK KR`, `sans-serif`.
- 로고 `HANPAN.`은 별도 영문 워드마크; 본문 UI 글꼴과 구분.
- 제목 30px mobile / 51px desktop 800, 페이지 섹션 21~22px 750, 모임 제목 15px mobile / 20px desktop 720~750.
- 기본 본문 15~16px, 부가 정보 12~14px, 보조 텍스트 12px 미만 금지. 실서비스 접근성 검수에서 상황별 조정.
- 한글 음수 자간은 지나치게 적용하지 않음. 제목은 -0.3~-1.5px 정도, 본문 기본 -0.01em.

## 버튼 사이즈
- Primary CTA 52px, padding inline 22px, 15px 700, radius 8px.
- Secondary 44~48px, 배경 흰색 + 1px 테두리.
- 필터 칩 최소 높이 42~44px, 폰트 12.5~13px, radius 8px.
- 아이콘 버튼 터치 영역 최소 44x44px.
- Disabled: 명도 차이와 명시적인 상태 문자; 색만으로 상태 전달 금지.
- Loading: 중복 신청 불가 상태, 명시적 피드백.
- Focus-visible은 3px 외곽선.

## 카드·정보
- 검색 화면은 카드 컨테이너 여러 겹 대신 구분선으로 목록 분리.
- 1줄: 장르/참가조건, 2줄: 게임·모임제목, 3줄: 시간, 4줄: 장소, 5줄: 참가 현황.
- 모바일(390px): 좌측 사진 약 86x96px, 우측 타이틀 15px, 메타 12px, 인원 13px. 작은 세 번째 칼럼을 없애 타이틀을 읽기 쉽게 한다.
- PC: 좌측 사진 183x105, 모임 정보, 인원 및 상태, 우측 이동 표시.
- 사진이 없는 모임은 임의의 생성 이미지 대신 일관된 카테고리용 플레이스홀더 사용.

## 레이아웃
- 전체 최대 폭 약 1190px, 데스크톱 좌우 여백 28px, 모바일 18px.
- 8px spacing grid 기반. 섹션 간 24~48px, 리스트 아이템 위아래 20~24px.
- 모바일 하단 내비게이션은 고정, 실제 콘텐츠가 가리지 않도록 safe area와 충분한 하단 여백 확보.

## QA 필수 테스트
- 뷰포트 320, 375, 390, 768, 1280, 1440px. 가로 오버플로 없음.
- 글자 크기 200%에서 핵심 버튼/정보 접근 가능.
- 색 대비 AA 검증, 포커스 키보드 이동, 모달 포커스 트랩/복귀, disabled 설명.
- 게임 제목 35자, 장소 30자, 모집 마감, 빈 목록, 에러, 로딩, 날짜 7일 스크롤.
- RSVP는 예시 데이터로만 동작하며 실제 로그인/예약/DB 연결 없음.

## 출처 (디자인 실무 참고)
- W3C WCAG 2.2 목표 크기 최소: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- Apple 버튼 터치 영역: https://developer.apple.com/design/human-interface-guidelines/buttons
- SUIT: https://github.com/sun-typeface/SUIT
