// score-board 캡처 설정 — 개인정보 없음
// 실행: node scripts/capture.mjs webs/score-board/capture.config.mjs

const openSettings = async (p) => { await p.locator('.gear').first().click(); await p.waitForTimeout(400); };
const closeSettings = async (p) => { await p.locator('.settings-modal-close').first().click(); await p.waitForTimeout(300); };
const setMode = async (p, name) => {
  await p.locator('.mode-switch').first().click();
  await p.waitForTimeout(300);
  await p.locator('.mode-item', { hasText: name }).first().click();
  await p.waitForTimeout(500);
};
// 팀 반쪽 탭 → +1 (side 0=왼쪽 빨강, 1=오른쪽 파랑)
const bump = async (p, side, n) => {
  const half = p.locator('.team-half').nth(side);
  for (let i = 0; i < n; i++) {
    await half.click({ position: { x: 200, y: 500 } });
    await p.waitForTimeout(120);
  }
};

export default {
  url: 'https://bau8584.github.io/score-board/',
  viewport: { width: 1280, height: 720 },
  padding: 0,
  steps: [
    // ── 기존 유지 컷 ──
    { name: '01-board', clip: { x: 0, y: 0, width: 1280, height: 720 } },
    { name: '02-settings', selector: '.settings-modal',
      prepare: async (p) => { await openSettings(p); } },
    { name: '03-mode', selector: '.mode-menu',
      prepare: async (p) => { await p.locator('.mode-switch').first().click(); await p.waitForTimeout(400); } },

    // ── 종목별 보드 컷 ──
    // 10 일반 점수판 — 빨강 3 / 파랑 1
    { name: '10-general', clip: { x: 0, y: 0, width: 1280, height: 720 },
      prepare: async (p) => { await setMode(p, '일반'); await bump(p, 0, 3); await bump(p, 1, 1); } },

    // 11 세트 카운터 켠 보드
    { name: '11-set', clip: { x: 0, y: 0, width: 1280, height: 720 },
      prepare: async (p) => {
        await setMode(p, '일반');
        await openSettings(p);
        const card = p.locator('.settings-card', { hasText: '일반 점수판' }).first();
        await card.locator('.toggle').nth(0).click(); // 세트 카운터
        await p.waitForTimeout(200);
        await closeSettings(p);
        await bump(p, 0, 2); await bump(p, 1, 1);
      } },

    // 12 타이머 사용 켠 보드
    { name: '12-timer', clip: { x: 0, y: 0, width: 1280, height: 720 },
      prepare: async (p) => {
        await setMode(p, '일반');
        await openSettings(p);
        const card = p.locator('.settings-card', { hasText: '일반 점수판' }).first();
        await card.locator('.toggle').nth(1).click(); // 타이머 사용
        await p.waitForTimeout(200);
        await closeSettings(p);
      } },

    // 13 야구 모드 — 선공 선택 후 스트라이크/볼/아웃 표시
    { name: '13-baseball', clip: { x: 0, y: 0, width: 1280, height: 720 },
      prepare: async (p) => {
        await setMode(p, '야구');
        await p.locator('.bb-pick-btn').first().click(); // 선공 팀 선택
        await p.waitForTimeout(500);
        // S 2, B 1, OUT 1 만들어 표시가 보이게
        const sChip = p.locator('.bb-chip-unit', { hasText: 'S' }).locator('.bb-chip').first();
        await sChip.click(); await p.waitForTimeout(150); await sChip.click(); await p.waitForTimeout(150);
        const bChip = p.locator('.bb-chip-unit', { hasText: 'B' }).locator('.bb-chip').first();
        await bChip.click(); await p.waitForTimeout(150);
        await p.locator('.bb-out-dots').first().click(); await p.waitForTimeout(200);
      } },

    // 14 발야구 선택한 보드
    { name: '14-footbaseball', clip: { x: 0, y: 0, width: 1280, height: 720 },
      prepare: async (p) => {
        await setMode(p, '야구');
        await openSettings(p);
        const card = p.locator('.settings-card', { hasText: '야구 점수판 표시 항목' }).first();
        await card.locator('button', { hasText: '발야구' }).first().click();
        await p.waitForTimeout(200);
        await closeSettings(p);
        // 진행 중 상태가 복원되면 선공 오버레이가 없을 수 있음 → 있으면 클릭
        if (await p.locator('.bb-pick-btn').count()) {
          await p.locator('.bb-pick-btn').first().click({ timeout: 3000 }).catch(() => {});
          await p.waitForTimeout(400);
        }
        // 점수 하나 올려 발야구 진행 화면이 되도록
        await bump(p, 0, 1);
      } },

    // 15 킨볼 보드 (3팀·목표점수 표시)
    { name: '15-kinball', clip: { x: 0, y: 0, width: 1280, height: 720 },
      prepare: async (p) => {
        await setMode(p, '킨볼');
        await p.waitForTimeout(400);
        // 각 팀 점수 몇 개 올려 pips가 채워지는 모습
        await p.locator('.kin-area').nth(0).locator('.kin-adj', { hasText: '+' }).click();
        await p.waitForTimeout(150);
        await p.locator('.kin-area').nth(1).locator('.kin-adj', { hasText: '+' }).click();
        await p.waitForTimeout(150);
      } },

    // ── 설정 모달 항목별 크롭 ──
    { name: '20-settings-general', selector: '.settings-card:has-text("일반 점수판")',
      prepare: async (p) => { await openSettings(p); } },
    { name: '21-settings-baseball', selector: '.settings-card:has-text("야구 점수판 표시 항목")',
      prepare: async (p) => { await openSettings(p); } },
    { name: '22-settings-theme', selector: '.settings-card:has-text("테마")',
      prepare: async (p) => { await openSettings(p); } },
  ],
};
