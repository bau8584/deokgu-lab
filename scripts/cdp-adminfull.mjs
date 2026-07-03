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
async function full(path){ await page.screenshot({ path }); log.push('OK '+path); }
async function menu(name){ // click left admin sidebar button by regex name
  try{ await page.getByRole('button',{name:new RegExp(name)}).first().click({timeout:5000}); await sleep(1300); return true; }
  catch(e){ log.push('MENU-FAIL '+name+' :: '+e.message.split('\n')[0]); return false; }
}
async function enterAdmin(){
  await page.goto(CLUB, { waitUntil:'networkidle', timeout:45000 });
  await sleep(2500);
  try{ await page.getByRole('tab',{name:/관리자/}).click({timeout:3000}); }
  catch{ await page.locator('nav >> text=관리자').first().click({timeout:3000}); }
  await sleep(1400);
}
// open an accordion by clicking the '열기' button in the row containing label, then crop that card
async function accordion(label, out){
  try{
    // find row (button/div) whose text has label, then the '열기' toggle near it
    const row = page.locator(`text=${label}`).first();
    await row.scrollIntoViewIfNeeded();
    // click the '열기' that is the closest following toggle
    const toggle = page.locator('button, [role=button]').filter({ hasText:'열기' });
    // choose the toggle in same card: use xpath ancestor approach
    const clicked = await page.evaluate((lbl)=>{
      const nodes=[...document.querySelectorAll('*')].filter(n=>n.children.length===0 && n.textContent.trim()===lbl);
      for(const n of nodes){
        let p=n; for(let i=0;i<6&&p;i++){ p=p.parentElement;
          if(!p) break;
          const t=[...p.querySelectorAll('button,[role=button]')].find(b=>b.textContent.trim()==='열기'||b.textContent.trim()==='닫기');
          if(t){ t.click(); return true; }
        }
      }
      return false;
    }, label);
    if(!clicked){ log.push('ACC-NOTOGGLE '+label); }
    await sleep(1000);
    await full(out);
  }catch(e){ log.push('ACC-FAIL '+label+' :: '+e.message.split('\n')[0]); await full(out).catch(()=>{}); }
}

const STEP = process.argv[2];
await enterAdmin();

if(STEP==='pages'){
  await full(`${DIR}/20-admin-global.png`);
  await menu('회원 관리'); await full(`${DIR}/21-member.png`);
  await menu('휴면 감점'); await full(`${DIR}/22-dormancy.png`);
  await menu('시즌 관리'); await full(`${DIR}/23-season.png`);
  await menu('데이터 관리'); await full(`${DIR}/24-backup.png`);
}
if(STEP==='acc'){
  // back on global settings
  await menu('리그 글로벌 설정');
  await accordion('보너스 점수 설정', `${DIR}/25-bonus.png`);
  await menu('리그 글로벌 설정');
  await accordion('페널티 설정', `${DIR}/26-penalty.png`);
  await menu('리그 글로벌 설정');
  await accordion('티어 세부 설정', `${DIR}/27-tier-settings.png`);
}
console.log(log.join('\n'));
await page.close();
await browser.close();
