// school-league 캡처 설정 — 공개 로비만(로그인 안쪽 스킵). 로비에 개인정보 없음.
export default {
  url: 'https://school-league.bau8584.workers.dev/',
  viewport: { width: 1440, height: 900 },
  padding: 24,
  steps: [
    // 01 로비 히어로 — 풀 뷰포트
    { name: '01-lobby', clip: { x: 0, y: 0, width: 1440, height: 900 },
      prepare: async (p) => { await p.waitForTimeout(800); } },
    // 02 소개 카드 — 요소 타이트 크롭(제목·소개문구·로그인 버튼)
    { name: '02-intro-card', selector: '.theme-card',
      prepare: async (p) => { await p.waitForTimeout(400); } },
  ],
};
