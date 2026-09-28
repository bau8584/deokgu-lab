---
name: deokgu-capture
description: 앱 화면 스크린샷 캡처. URL을 주며 "스크린샷/캡처/화면 떠줘"라고 하면 이 스킬. 로그인 필요한 앱은 CDP 세션 재사용.
---

# 스크린샷 캡처 작업 지침

이 파일은 "특정 URL의 스크린샷을 뽑아줘 / 캡처해줘 / 화면 떠줘" 류의 요청을
받았을 때 **매번 동일하게** 따라야 할 절차다. 사용자가 일일이 세부 지시를 하지
않아도 아래 규칙대로 자동으로 수행한다.

## 트리거
사용자가 URL을 주며 "스크린샷 / 캡처 / 화면" 등을 언급하면 이 워크플로를 실행한다.

## 1. 출력 폴더 생성
- `shots/<슬러그>-<YYYY-MM-DD>/` 형식으로 새 폴더를 만든다.
- 슬러그: 앱 이름이 분명하면 그걸로, 아니면 URL 호스트에서 추출
  (예: `pe-scoreboard.pages.dev` → `pe-scoreboard`).
- 같은 날 같은 앱을 다시 찍으면 `-2`, `-3`을 붙여 **기존 폴더를 덮어쓰지 않는다.**

## 2. 환경 준비
- Playwright 미설치 시 설치한다: `npm i -D playwright && npx playwright install chromium`
- 캡처 스크립트는 `scripts/capture.mjs`로 저장해 재사용한다(있으면 재사용).
- 캡처는 node/Playwright로 한다. 이미지 블러는 Playwright(캡처 직전 CSS blur, 또는 정적 이미지엔 `scripts/_blur.mjs`)로 처리.

## 2-B. 로그인이 필요한 앱 캡처 — CDP 세션 재사용 (확정 방법)
Playwright 헤드리스는 구글 로그인 앱에 못 들어가고, Claude-in-Chrome 스샷은 repo로 파일 저장이 안 된다. **소유자가 이미 로그인해 둔 브라우저를 디버그 포트로 재사용**한다:
1. 브라우저 완전 종료(백그라운드 프로세스까지) 후 `msedge --remote-debugging-port=9222 --user-data-dir="<실제 User Data>" --restore-last-session`로 재시작(로그인·탭 유지). 최신 크롬/엣지는 `--user-data-dir`을 명시해야 디버그 포트가 열린다.
2. `chromium.connectOverCDP('http://localhost:9222')` → `contexts()[0].newPage()`로 캡처. 끝에 `browser.close()`는 연결만 끊김(브라우저 안 죽음).
3. **토큰 읽기·프로필 복사는 금지**(보안 분류기가 차단, 우회 안 함). 앱마다 Supabase 세션이 origin별로 달라 각각 로그인 필요.
- 도구: `scripts/cdp-cap.mjs`(연결·로그인 확인 패턴). 데모(가짜 이름) 리그·데이터 상태로 찍는다.

## 3. 캡처할 기능 파악 — 빠짐없이
- 이 저장소에 소스가 있으면 **먼저 코드를 읽는다.** 라우트·컴포넌트·주요
  인터랙션을 근거로 핵심 기능 목록을 만든다.
- 소스가 없으면 페이지 DOM과 주요 섹션을 탐색해 기능 블록을 식별한다.
- 모달·탭·토글처럼 **클릭해야 보이는 상태도 빠뜨리지 않는다.** 각 상태를 별도 컷으로.
- 캡처 전, "이 N개 화면을 찍을 예정"이라고 목록을 한 번 보여준 뒤 진행한다.

## 4. 캡처 규칙 — 요소 단위로 타이트하게 크롭
- 전체 화면(`page.screenshot`)이 아니라 **각 기능 UI 요소에 딱 맞게 크롭**한다.
- 기본은 `boundingBox` + `clip`으로 **여백 16px**만 두고 자른다(쓸데없는 부분 제거).
- `deviceScaleFactor: 2`로 선명하게 캡처한다.
- 뷰포트 기본값은 1440x900. 앱이 태블릿/모바일 중심이면 맞게 조정하고 사용자에게 알린다.
- 각 컷은 `networkidle` 대기 + 대상 요소 `visible` 대기 후 촬영한다.

핵심 코드 패턴(이 방식을 사용한다):
```js
const ctx = await browser.newContext({ viewport: { width:1440, height:900 }, deviceScaleFactor: 2 });
const el = page.locator(selector).first();
await el.scrollIntoViewIfNeeded();
await el.waitFor({ state: 'visible' });
const b = await el.boundingBox();
await page.screenshot({ path: file, clip: {
  x: Math.max(0, b.x-16), y: Math.max(0, b.y-16),
  width: b.width+32, height: b.height+32,
}});
```

## 5. 파일 정리 — 보기 좋게
- 파일명: `01-<기능명>.png`, `02-...` 처럼 **번호 + 영문 케밥케이스 기능명.**
- 폴더 안에 `README.md` 인덱스를 만든다. 각 파일에 대해
  파일명 / 한 줄 설명 / 미리보기(`![](파일명)`)를 표로 정리한다.
- 마지막에 캡처 장수, 폴더 경로, 누락 가능성이 있는 화면을 요약 보고한다.

## 6. 안전·예외 처리
- 로그인이 필요하면 진행 전에 사용자에게 입력 방법을 묻는다. **비밀번호를 코드에
  하드코딩하지 않는다.**
- 학생 이름 등 개인정보가 보이면 블러 처리 여부를 사용자에게 확인한다.
- 셀렉터를 못 찾은 기능은 조용히 건너뛰지 말고 **실패 목록으로 보고**한다.

## 기본값 요약
| 항목 | 값 |
|------|----|
| 뷰포트 | 1440 x 900 |
| 선명도 | deviceScaleFactor 2 |
| 크롭 여백 | 16px |
| 출력 폴더 | `shots/<슬러그>-<날짜>/` |
| 파일명 | `NN-기능명.png` |
