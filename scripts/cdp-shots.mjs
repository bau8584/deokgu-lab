// cdp-shots.mjs — 로그인된 Edge(포트 9222)에 붙어 리그 앱 캡처.
// Edge를 죽이지 않음. Playwright로 연 page만 close, 끝에 browser.close(그냥 연결끊김).
import { chromium } from 'playwright';
import fs from 'fs';

const CLUB = 'https://club-league.bau8584.workers.dev/class/b257be6a-0bf6-4aec-ab1e-b6d9b037233d';
const SCHOOL = 'https://school-league.bau8584.workers.dev/class/1abd4a1f-b163-4e6b-b03e-d0910bbbe0e1';
const CLUB_DIR = 'webs/club-league/shots';
const SCHOOL_DIR = 'webs/school-league/shots';
fs.mkdirSync(CLUB_DIR, { recursive: true });

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.setViewportSize({ width: 1440, height: 900 }).catch(()=>{});

const log = [];
const sleep = (ms)=>page.waitForTimeout(ms);

async function full(path){ await page.screenshot({ path }); log.push('OK '+path); }
async function clip(path, sel){
  try{
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await el.waitFor({ state:'visible', timeout:6000 });
    const b = await el.boundingBox();
    if(!b){ await full(path); return; }
    await page.screenshot({ path, clip:{ x:Math.max(0,b.x-16), y:Math.max(0,b.y-16), width:b.width+32, height:b.height+32 }});
    log.push('OK '+path);
  }catch(e){ log.push('CLIP-FAIL '+path+' :: '+sel+' :: '+e.message.split('\n')[0]); await full(path).catch(()=>{}); }
}
async function clickText(t, timeout=5000){
  try{ await page.getByText(t, {exact:false}).first().click({timeout}); await sleep(900); return true; }
  catch(e){ log.push('CLICK-FAIL '+t+' :: '+e.message.split('\n')[0]); return false; }
}

const target = process.argv[2] || 'club';
const URL = target==='school' ? SCHOOL : CLUB;
const DIR = target==='school' ? SCHOOL_DIR : CLUB_DIR;
fs.mkdirSync(DIR, { recursive: true });

await page.goto(URL, { waitUntil:'networkidle', timeout:45000 });
await sleep(3000);
await full(`${DIR}/_00-landing.png`);
// dump texts of clickable elements for selector discovery
const texts = await page.evaluate(()=>{
  const out=[];
  document.querySelectorAll('button,a,[role=tab],[role=button],nav *').forEach(e=>{
    const t=(e.innerText||'').trim().replace(/\s+/g,' ');
    if(t && t.length<40) out.push(t);
  });
  return [...new Set(out)];
});
console.log('CLICKABLES:', JSON.stringify(texts));

// crop helper: find element whose text starts with label (panel content area)
async function clipMain(path){
  // main content column to the right of the admin sidebar; fallback full
  const sel = 'main, [class*=panel], body';
  await full(path);
}

async function clickBtn(name){
  try{ await page.getByRole('button',{name}).first().click({timeout:5000}); await sleep(1200); return true; }
  catch(e){ log.push('BTN-FAIL '+name+' :: '+e.message.split('\n')[0]); return false; }
}

if(target==='school'){
  // header tab
  await page.getByRole('tab',{name:/교사 관리자/}).click({timeout:5000}).catch(()=>clickBtn(/교사 관리자/));
  await sleep(1200);
  await clickBtn(/학생 관리/);
  await full(`${DIR}/18-member.png`);
  await clickBtn(/시즌 관리/);
  await full(`${DIR}/20-season.png`);
  await clickBtn(/데이터 관리/);
  await full(`${DIR}/21-backup.png`);
  // theme picker
  await clickBtn(/테마/);
  await sleep(800);
  await full(`${DIR}/theme-picker.png`);
}

if(target==='club'){
  // handled after login check
}

console.log(JSON.stringify({ url: page.url(), title: await page.title() }));
console.log(log.join('\n'));
await page.close();
await browser.close();
