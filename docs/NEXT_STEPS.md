# 다음 할 일 — 출시 체크리스트

상태: 출시 전 마무리 반영 (2026-11-25 — 공개 Git 저장소 준비 완료, CI 워크플로 준비(푸시 전), 결정 항목 #11~#13 추가). Phase 5: 코드·문서 준비 완료, 실제 배포는 사용자 결정·외부 설정·승인 후. 관리자 권한의 계정 상태 문제는 마이그레이션 9로 결정·해결되어 결정 목록에서 뺐다

관련 문서: [ROADMAP](./ROADMAP.md) · [DEPLOYMENT](./DEPLOYMENT.md) · [OPERATIONS](./OPERATIONS.md) · [SECURITY](./SECURITY.md) · [TEST_PLAN](./TEST_PLAN.md)

아래 순서대로 진행한다. 개발은 이 항목 없이도 mock 모드로 계속할 수 있지만, 실제 로그인·데이터·배포는 1~2가 끝나야 가능하다.

## 1. 사용자 결정 필요

| # | 결정 | 막히는 것 | 참고 |
|---|---|---|---|
| 1 | **브랜드명·상표·도메인**(HANPAN은 가칭) | 운영 도메인, Redirect URL·Site URL 확정, OAuth 동의 화면 앱 이름·로고, 정책 문서의 사업자 정보, HSTS `includeSubDomains`·`preload` 여부 | [PRD §1](./PRD.md#1-개요), [SECURITY §7](./SECURITY.md#7-보안-헤더와-csp) |
| 2 | **운영 이메일** | 문의·이의제기·개인정보 요청 창구, OAuth 동의 화면 지원 이메일, 정책 화면의 "확정 전" 값, 사고 때 이용자 연락 | [OPERATIONS §1](./OPERATIONS.md#1-기본-원칙) |
| 3 | **정책 확정과 법률 검토**: 이용약관·개인정보처리방침·운영정책 초안, 만 14세 미만 이용, 보관 기간(감사 로그·신고·백업), 사고 시 통지·신고 의무 | 정책 공개, 출시 | [TERMS_DRAFT](./policies/TERMS_DRAFT.md), [PRIVACY_DRAFT](./policies/PRIVACY_DRAFT.md), [OPERATIONS §2·§9·§10](./OPERATIONS.md#2-운영-규정) |
| 4 | **히어로 사진 라이선스**(쓰지 않으면 현재 중립 SVG 유지) | 히어로 사진 교체 | [UI_SPEC §3.3](./UI_SPEC.md#33-시안-대비-의도적-차이), README "히어로 이미지 교체" |
| 5 | **입력·칩 테두리 대비**: `border` `#E5E8EB`는 흰 배경 1.23:1(WCAG 1.4.11 비텍스트 3:1 미달). 안: 입력란에만 진한 테두리 토큰(예: `#8B949E` 약 3.1:1), 또는 v3 그대로 유지(예외로 기록) | v3 모양 변경 여부 | [UI_SPEC §2.1·§3.3-B](./UI_SPEC.md#21-색상-tailwind-theme의-css-변수), `src/styles/contrast.test.ts` |
| 6 | **(Phase 5 발견) 보조 글자 hover 대비**: `muted` `#707781`이 `hover` `#FAFAFB` 위 4.33:1, `soft` 위 4.22:1(AA 4.5 미달). 데스크톱 목록 행에 마우스를 올린 동안의 일시·장소, 로그인 화면 개발용 계정 설명(개발 전용). 안: hover 배경을 더 옅게/없애기, hover 때 보조 글자를 `text`로, muted를 약간 진하게(예: `#6B727C` — 계산상 hover 4.66:1·soft 4.53:1·흰 배경 4.86:1) — 모두 모양이 바뀜 | v3 모양 변경 여부 | 같음 |
| 7 | **모임장의 외부 연락 수단 기재·참가비(회비·선입금) 정책** | 운영정책·약관 확정, 신고 기준 | [OPERATIONS §2.4](./OPERATIONS.md#24-상업적-권유스팸) |
| 8 | **글꼴 고정 방식**(아래 상세) — 정확한 버전 + SRI, 또는 자체 호스팅 | CSP에서 jsDelivr 제거 여부, 외부 의존 | 아래 "글꼴 결정" |
| 9 | **이 PC의 전역 `NODE_TLS_REJECT_UNAUTHORIZED=0` 제거 권장**: Node·npm의 TLS 인증서 검증이 꺼져 있어 중간자 공격에 취약하다(npm은 패키지 integrity로 내용은 확인하지만 다른 요청은 보호되지 않음). 회사 프록시 때문이면 `NODE_EXTRA_CA_CERTS`로 사내 인증서를 추가하는 방식 권장. 저장소 설정은 바꾸지 않았다 | 개발 환경 보안 | [SECURITY §12](./SECURITY.md#12-의존성) |
| 10 | 운영 설계 결정(출시 전 또는 직후): 신고 처리 목표 기간·이의제기 절차, 탈퇴 요청 없이 삭제된 계정의 미래 모임 처리, 카테고리 이름·순서 변경 화면, 모니터링 도구 도입 여부, 실제 공간 정보 수집·제보 경로 | 운영 | [OPERATIONS §3·§4·§7](./OPERATIONS.md#3-신고-처리-절차), [DB_SCHEMA §16](./DB_SCHEMA.md#16-미결-사항) |
| 11 | **저장소 라이선스**: 공개 저장소에 LICENSE 파일이 없다. LICENSE가 없으면 공개돼 있어도 기본적으로 저작권자가 모든 권리를 가진다(남이 보기는 해도 복제·수정·재배포할 권리는 없음). 안: 오픈소스 라이선스(MIT·Apache-2.0 등)를 붙인다 / 소스 공개만 하고 LICENSE 없이 둔다(권리 보유 문구를 README에 적을지) / 저장소를 비공개로 돌린다 | 외부 기여·재사용 허용 범위, 공개 유지 여부 | 저장소 루트(LICENSE 없음), 아래 #12와 함께 결정 |
| 12 | **디자인 시안 사진의 라이선스(공개 저장소에 이미 올라감)**: `hanpan_v3_design_lab.html`에 base64로 내장된 사진 4장(히어로 1장 — 보드게임 판 위의 손·말, 목록 썸네일 3장 — 칩·주사위, 카드, 타일 보드. 의뢰 메모에는 2장으로 적혀 있었으나 파일에는 서로 다른 JPEG 4개가 있음)과 그 시안을 찍은 `docs/screenshots/reference/lab-*.png` 6장. 출처·사용 권한을 확인하지 못했다(앱 화면에는 쓰지 않음 — README "히어로 이미지 교체"). 권한이 없거나 불분명하면 저장소에서 지워야 한다(사진을 뺀 시안으로 바꾸거나, 시안 파일·참고 스크린샷을 비공개 보관). **이미 푸시한 커밋(`6f4b396`) 기록에 남으므로** 새 커밋으로 지워도 과거 커밋·포크·캐시에서 볼 수 있다. 완전히 지우려면 기록을 다시 쓰고(`git filter-repo` 등) 강제 푸시해야 하며, 포크·복제본은 되돌릴 수 없다. `hanpan_v3_design_lab.html`은 루트 원본 문서라 이번 작업에서는 고치지 않았다 | 공개 유지, 저작권 위험 | README "히어로 이미지 교체", [UI_SPEC §3.3](./UI_SPEC.md#33-시안-대비-의도적-차이) |
| 13 | (선택) **Dependabot 도입 여부**(의존성 보안 경고·자동 업데이트 PR). 켜면 `.github/dependabot.yml`(npm·github-actions 주기)을 추가하고 PR마다 CI가 돈다. 파일은 만들지 않았다. 보안 경고(Dependabot alerts)만 저장소 설정에서 켜는 방법도 있다 | 의존성·actions 버전 갱신 방식 | [SECURITY §12](./SECURITY.md#12-의존성), README "CI" |

### 글꼴 결정 (#8)

현재: `index.html`이 SUIT Variable(SIL OFL 1.1)을 jsDelivr의 `gh/sun-typeface/SUIT@2/...`(메이저 버전 범위)로 불러온다. 범위 지정이라 내용이 우리 변경 없이 바뀔 수 있고, 그래서 SRI(integrity)를 걸 수 없다. CSP는 이 글꼴 때문에 `style-src`·`font-src`에 **jsDelivr의 SUIT 저장소 경로(`https://cdn.jsdelivr.net/gh/sun-typeface/`)만** 허용한다(호스트 전체가 아님). Phase 5에서는 외부 파일을 받지 않는다는 원칙에 따라 바꾸지 않았다.

| 안 | 할 일 | 장점 | 단점 |
|---|---|---|---|
| A. 정확한 버전 + SRI | `SUIT@<정확한 릴리스>`로 고정(`미확인:` 실제 태그 이름) → CSS의 sha384 해시를 계산해 `<link integrity="sha384-…" crossorigin="anonymous">` | 저장소에 바이너리 없음, CDN 캐시, CSS 변조 감지 | SRI는 CSS만 보호(CSS가 부르는 woff2에는 걸 수 없음 — 정확한 버전 경로라 내용 고정을 jsDelivr에 기대), 외부 의존(가용성·이용자 IP가 jsDelivr로 감 — 개인정보처리방침 고지 검토), CSP에 jsDelivr 유지, 해시 계산 때 파일을 한 번 받아야 함 |
| B. 자체 호스팅 | woff2와 라이선스 원문(OFL.txt)을 저장소에 넣고 `src/styles/index.css`에 `@font-face { font-family: 'SUIT Variable'; src: url(...) format('woff2'); font-weight: 100 900; font-display: swap; }` → Vite가 해시 이름으로 `/assets/`에 넣음(1년 캐시) → `index.html`의 jsDelivr 링크 삭제 → CSP `style-src 'self'`, `font-src 'self'`(`scripts/lib/security-headers.mjs`의 `FONT_CDN_SOURCE` 제거) | 외부 요청 0, CSP 단순, 버전이 저장소에 고정, 이용자 IP가 제3자로 가지 않음 | 저장소·배포 크기 증가(`미확인:` woff2 크기), 갱신을 직접 해야 함, OFL 조건(라이선스 동봉, 글꼴만 따로 판매 금지, 수정 시 이름 규칙 — `미확인:` 예약 글꼴 이름 지정 여부) 확인 |

- `font-display` 확인 방법: 개발자 도구 → Network → `SUIT-Variable.css` 응답 본문의 `@font-face`에 `font-display`가 있는지 본다(다른 출처 CSS라 스크립트로는 읽을 수 없다). 없으면 브라우저 기본(`auto` — 대개 짧은 시간 글자를 숨김). 자체 호스팅이면 `swap`을 직접 지정한다. 현재 값은 `미확인`(파일을 받지 않았음).
- 어느 안이든 바꾼 뒤 `npm run test:csp`(글꼴이 200으로 받아지는지·위반 0건)와 `npm run screenshots`로 확인한다.

## 2. 외부 설정 (사용자 수행)

순서와 화면별 값은 [DEPLOYMENT](./DEPLOYMENT.md)를 그대로 따른다. 1번 외에는 모두 `BLOCKED:`(아직 하지 않음).

1. ~~Git 원격 저장소 준비(Cloudflare Pages Git 연동용)~~ **완료**: 공개 GitHub 저장소 `Minani99/HANPAN`, 브랜치 `main`(첫 커밋 `6f4b396`). Pages Git 연동 때 이 저장소를 고른다. 공개 저장소라 #11·#12 결정이 필요하다.
   - **CI**: `.github/workflows/ci.yml` 준비 완료(아직 푸시하지 않음). 이 파일이 들어간 커밋을 `main`에 푸시하거나 `main` 대상 PR을 열면 GitHub Actions에서 실행된다(수동 실행도 가능). 비밀 값이 필요 없다. 첫 실행 때 확인할 것은 README "CI".
2. **개발용** Supabase 프로젝트 생성 → 마이그레이션 적용(seed 금지) → Auth URL(로컬·프리뷰 주소) → [DEPLOYMENT §3](./DEPLOYMENT.md#3-supabase-설정)
3. Google OAuth 클라이언트(개발 프로젝트 콜백) → Supabase Google provider → [§4](./DEPLOYMENT.md#4-google-oauth)
4. (선택) Kakao 앱 → 이메일 동의항목 요건 확인 → [§5](./DEPLOYMENT.md#5-kakao-oauth-선택)
5. 로컬에서 첫 연결 확인(PostgREST 오류 응답 모양, 로그인 왕복, 핵심 흐름, `npm run preview` 헤더) + **동시 신청 경쟁 테스트** → [§6](./DEPLOYMENT.md#6-첫-연결-확인-순서-개발용-프로젝트에서-먼저), [TEST_PLAN §4.1](./TEST_PLAN.md#41-동시-신청-경쟁-테스트-실행-절차-개발용-supabase). 결과를 CHANGELOG에 기록.
6. 첫 로그인 후 관리자 지정 → [§3.4](./DEPLOYMENT.md#34-최초-관리자-지정)
7. Cloudflare 계정 → Pages 프로젝트(빌드 `npm run build`, 출력 `dist`, Node `.nvmrc`) → Preview 환경 변수 = 개발 프로젝트 → [§7](./DEPLOYMENT.md#7-cloudflare-pages-설정)
8. 백업 절차 1회 시험(개발 프로젝트에 `pg_dump` → `pg_restore`) → [OPERATIONS §8](./OPERATIONS.md#8-백업)

## 3. 첫 프리뷰 배포 확인

[DEPLOYMENT §8](./DEPLOYMENT.md#8-첫-프리뷰-배포-확인)의 체크리스트 — **실제 배포 전까지 미확인인 동작**:

- [ ] 빌드 로그의 Node 버전(`.nvmrc` 24.18.0 지원 여부), `_headers` 생성 줄, `_redirects` 경고 없음
- [ ] SPA 딥링크: `/meetings/<id>`·`/venues/<id>` 직접 진입·새로고침, `/admin` 새로고침, 없는 경로 → 앱 404 화면
- [ ] `curl -sI`로 보안 헤더·CSP connect-src(개발 프로젝트 origin)·`/assets/*` 캐시 헤더
- [ ] 브라우저 콘솔 CSP 위반 0건(Google 로그인 왕복 포함), SUIT 글꼴 로드
- [ ] 프리뷰 주소의 `/auth/callback` 복귀(Redirect URLs — 와일드카드 대신 고정 프리뷰 별칭 권장)

## 4. 운영 배포

1. 1번 결정 중 출시를 막는 항목(#1 도메인 — 또는 `pages.dev`로 시작, #2 운영 이메일, #3 정책 검토) 처리.
2. **운영** Supabase 프로젝트를 2번과 같은 순서로 준비(Redirect URLs는 정확한 주소만, seed 금지), 운영 Google OAuth 클라이언트.
3. Pages Production 환경 변수 = 운영 프로젝트(프리뷰와 섞이지 않게).
4. [DEPLOYMENT §11 배포 전 체크리스트](./DEPLOYMENT.md#11-배포-전-체크리스트) 전부 체크 → **사용자 승인**.
5. 운영 배포 → [§9 배포 직후 스모크](./DEPLOYMENT.md#9-배포-직후-스모크-체크리스트-운영) → 문제 시 [§10 롤백](./DEPLOYMENT.md#10-롤백).
6. 사용자 정의 도메인 연결 시 Supabase Site URL·Redirect URLs, Google 승인된 도메인 갱신, HSTS 정책 결정.
7. 출시 후: 주 1회 [OPERATIONS §7](./OPERATIONS.md#7-모니터링-최소안) 점검, 정기 백업([§8](./OPERATIONS.md#8-백업)), 분기 관리자 목록 확인.

## 5. 개발 쪽 남은 일 (실제 연결 후)

1. 실제 Supabase에서 PostgREST 오류 응답·인자 직렬화·`table().insert/update` 응답(`Prefer: return=representation`)·제약 오류 메시지 형식 확인 → 다르면 `src/data/supabase/errors.ts`·어댑터 수정(`BLOCKED:`).
2. 마이그레이션 6의 `drop function` 후 PostgREST 스키마 캐시 갱신, 감사 트리거 실행 역할 확인(`BLOCKED:`).
3. 스크린리더(VoiceOver/NVDA)·실기기 Safari 점검(`미확인:` 장비).
4. 1번 #5·#6·#8 결정에 따른 수정(토큰·글꼴).
