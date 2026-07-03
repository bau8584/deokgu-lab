// explore.mjs — 앱 구조를 훑어 features/텍스트/개인정보 후보를 리포트 + 전체 스샷
// 실행: node scripts/explore.mjs <URL> <OUT_DIR>
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const URL = process.argv[2];
const OUT = process.argv[3] || './_explore';
if (!URL) { console.error('URL 필요'); process.exit(1); }

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => errors.push('goto: ' + e.message));
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const t = s => [...document.querySelectorAll(s)].map(e => (e.innerText || e.value || '').trim()).filter(Boolean).slice(0, 40);
    const hangul = /[가-힣]{2,4}/g;
    const bodyText = document.body.innerText.slice(0, 6000);
    // 개인정보 후보: 이름스러운 2~4자 한글이 반복되는 표/리스트
    const nameHits = (bodyText.match(hangul) || []).slice(0, 60);
    return {
      title: document.title,
      h: t('h1,h2,h3'),
      buttons: t('button,[role=button],a.btn,.tab,[class*=tab]'),
      navs: t('nav a, .nav a, [class*=menu] a'),
      inputs: [...document.querySelectorAll('input,select,textarea')].map(e => e.placeholder || e.name || e.type).filter(Boolean).slice(0, 30),
      tableCount: document.querySelectorAll('table').length,
      bodyText,
      nameHits,
    };
  }).catch(e => ({ error: e.message }));

  await page.screenshot({ path: path.join(OUT, 'full.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(OUT, 'explore.json'), JSON.stringify({ URL, ...info, pageErrors: errors }, null, 2));
  console.log('TITLE:', info.title);
  console.log('H:', (info.h||[]).join(' | '));
  console.log('BTN:', (info.buttons||[]).slice(0,20).join(' | '));
  console.log('INPUTS:', (info.inputs||[]).join(' | '));
  console.log('TABLES:', info.tableCount, ' NAME_HITS:', (info.nameHits||[]).slice(0,20).join(','));
  console.log('ERRORS:', errors.length);
  await browser.close();
};
run().catch(e => { console.error('실패:', e); process.exit(1); });
