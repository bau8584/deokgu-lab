// auth-login.mjs — 전용 프로필에 사용자가 직접 로그인하도록 창을 띄운다.
// 세션은 profileDir 에 저장되어 이후 headless 캡처에서 재사용된다.
// 비밀번호는 사용자가 이 창에 직접 입력 — 스크립트는 값을 읽지 않는다.
// 실행: node scripts/auth-login.mjs <startUrl> <loginMarkerText>
import { chromium } from 'playwright';
import path from 'node:path';

const START = process.argv[2] || 'https://school-league.bau8584.workers.dev/';
const MARKER = process.argv[3] || '내가 관리하는 리그';
const profileDir = path.resolve('scripts/.cap-profile');

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: false,
  viewport: null,
  args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto(START, { waitUntil: 'domcontentloaded' }).catch(()=>{});
console.log('\n>>> 열린 크롬 창에서 구글 로그인 해주세요. 로그인 감지되면 자동으로 닫힙니다. (최대 8분 대기)\n');

try {
  await page.waitForSelector(`text=${MARKER}`, { timeout: 8 * 60 * 1000 });
  console.log('LOGIN_OK — 세션 저장됨:', profileDir);
} catch {
  console.log('LOGIN_TIMEOUT — 로그인이 감지되지 않았습니다. 다시 시도하세요.');
}
await page.waitForTimeout(1500);
await ctx.close();
