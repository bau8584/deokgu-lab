// cdp-club.mjs — 로그인된 Edge(9222)에 붙어 클럽 배드민턴 리그 캡처.
// Edge 안 죽임. 연 page만 close, 끝에 browser.close(연결만 끊김). 보기/캡처만.
import { chromium } from 'playwright';
import fs from 'fs';

const CLUB = 'https://club-league.bau8584.workers.dev/class/b257be6a-0bf6-4aec-ab1e-b6d9b037233d';
const DIR = 'webs/club-league/shots';
fs.mkdirSync(DIR, { recursive: true });

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.setViewportSize({ width: 1440, height: 900 }).catch(()=>{});
const sleep = (ms)=>page.waitForTimeout(ms);
const log = [];

async function full(path){ await page.screenshot({ path }); log.push('OK(full) '+path); }
async function clip(path, sel){
  try{
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await el.waitFor({ state:'visible', timeout:6000 });
    const b = await el.boundingBox();
    if(!b){ await full(path); return; }
    await page.screenshot({ path, clip:{ x:Math.max(0,b.x-16), y:Math.max(0,b.y-16), width:b.width+32, height:b.height+32 }});
    log.push('OK '+path);
  }catch(e){ log.push('CLIP-FAIL '+path+' :: '+e.message.split('\n')[0]); await full(path).catch(()=>{}); }
}
async function clickText(t){
  try{ await page.getByText(t, {exact:false}).first().click({timeout:5000}); await sleep(1000); return true; }
  catch(e){ log.push('CLICK-FAIL '+t+' :: '+e.message.split('\n')[0]); return false; }
}

const STEP = process.argv[2] || 'tabs';

await page.goto(CLUB, { waitUntil:'networkidle', timeout:45000 });
await sleep(2500);

if(STEP==='tabs'){
  // 티어 순위표
  await clickText('티어 순위표');
  await sleep(1200);
  await full(`${DIR}/10-tier.png`);
  // 경기 기록 입력
  await clickText('경기 기록 입력');
  await sleep(1000);
  await full(`${DIR}/11-record.png`);
  // 매치 추천
  await clickText('매치 추천');
  await sleep(1200);
  await full(`${DIR}/12-match.png`);
  // 오늘의 경기
  await clickText('오늘의 경기');
  await sleep(1200);
  await full(`${DIR}/13-today.png`);
  // 매치 추천 clickables for step2
  await clickText('매치 추천');
  await sleep(800);
  const mtxt = await page.evaluate(()=>{
    const out=[]; document.querySelectorAll('button,a,[role=button]').forEach(e=>{const t=(e.innerText||'').trim().replace(/\s+/g,' ');if(t&&t.length<40)out.push(t);});
    return [...new Set(out)];
  });
  console.log('MATCH-CLICKABLES:', JSON.stringify(mtxt));
}

console.log(JSON.stringify({ url: page.url(), title: await page.title() }));
console.log(log.join('\n'));
await page.close();
await browser.close();
