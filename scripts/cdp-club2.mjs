import { chromium } from 'playwright';
import fs from 'fs';
const CLUB = 'https://club-league.bau8584.workers.dev/class/b257be6a-0bf6-4aec-ab1e-b6d9b037233d';
const DIR = 'webs/club-league/shots';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.setViewportSize({ width: 1440, height: 900 }).catch(()=>{});
const sleep = (ms)=>page.waitForTimeout(ms);
const log = [];
async function full(path){ await page.screenshot({ path }); log.push('OK(full) '+path); }
async function clickText(t){
  try{ await page.getByText(t, {exact:false}).first().click({timeout:5000}); await sleep(1100); return true; }
  catch(e){ log.push('CLICK-FAIL '+t+' :: '+e.message.split('\n')[0]); return false; }
}
async function dumpClickables(tag){
  const t = await page.evaluate(()=>{const o=[];document.querySelectorAll('button,a,[role=button],[role=tab]').forEach(e=>{const x=(e.innerText||'').trim().replace(/\s+/g,' ');if(x&&x.length<45)o.push(x);});return [...new Set(o)];});
  console.log(tag+':', JSON.stringify(t));
}
await page.goto(CLUB, { waitUntil:'networkidle', timeout:45000 });
await sleep(2500);
const STEP = process.argv[2];

if(STEP==='match'){
  await clickText('매치 추천'); await sleep(800);
  await clickText('갑돌이'); await sleep(1500);
  await full(`${DIR}/12-match.png`);
  await dumpClickables('AFTER-PICK');
}
if(STEP==='admin'){
  await clickText('관리자'); await sleep(1400);
  await dumpClickables('ADMIN-MENU');
  await full(`${DIR}/20-admin-global.png`);
}
console.log(JSON.stringify({url:page.url()}));
console.log(log.join('\n'));
await page.close();
await browser.close();
