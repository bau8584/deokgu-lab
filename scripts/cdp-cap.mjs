// cdp-cap.mjs — 이미 로그인된 엣지(디버그 포트)에 붙어서 캡처.
// 재로그인·토큰읽기·프로필복사 없음. 사용자의 기존 세션을 그대로 사용.
// 사전: msedge --remote-debugging-port=9222 로 실행 중이어야 함.
// 실행: node scripts/cdp-cap.mjs <url> <outPng> [markerText]
import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://school-league.bau8584.workers.dev/';
const OUT = process.argv[3] || 'scripts/_cdp-test.png';
const MARKER = process.argv[4] || '';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.setViewportSize({ width: 1440, height: 900 }).catch(()=>{});
await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(2500);
let loggedIn = true;
if (MARKER) {
  loggedIn = await page.locator(`text=${MARKER}`).first().isVisible().catch(()=>false);
}
await page.screenshot({ path: OUT });
console.log(JSON.stringify({ url: page.url(), title: await page.title(), loggedIn, out: OUT }));
await page.close();
await browser.close();
