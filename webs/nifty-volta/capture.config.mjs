// nifty-volta 캡처 설정 — 학교명 블러(개인정보)
// 실행: node scripts/capture.mjs webs/nifty-volta/capture.config.mjs
export default {
  url: 'https://bau8584.github.io/nifty-volta/',
  viewport: { width: 1440, height: 900 },
  padding: 16,
  blur: ['header h1'], // 학교명(청림초등학교) 블러 처리
  steps: [
    // 히어로 — 상단 헤더 + 탭 + 가이드 개요(수업상태/창고 카드)
    { name: '01-hero', selector: 'main',
      clip: { x: 120, y: 0, width: 1200, height: 760 } },
    // 가이드 탭 — 현재 수업 상태 + 창고/보관함 카드 영역
    { name: '02-guide', selector: '#panel-guide',
      prepare: async (p) => { await p.locator('#tab-guide').click(); await p.waitForTimeout(500); } },
    // 교구 지도 탭 — 2.5D 입체 보관지도 + 검색
    { name: '03-locator', selector: '#panel-locator',
      prepare: async (p) => { await p.locator('#tab-locator').click(); await p.waitForTimeout(700); } },
    // 행정 지원 탭 — 파손/정비 요청, 구매 희망, 코멘트 현황판
    { name: '04-admin', selector: '#panel-admin',
      prepare: async (p) => { await p.locator('#tab-admin').click(); await p.waitForTimeout(500); } },
  ],
};
