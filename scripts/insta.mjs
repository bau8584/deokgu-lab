// insta.mjs — 인스타용 브랜드 카드 생성 (세로 1080x1350 + 정사각 1080x1080)
// node scripts/insta.mjs <config.mjs>
// config default export:
// { image, title, hook, badge?, out?, base? }  image=스크린샷 경로(브랜드 카드 안에 얹음)
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cfgPath = process.argv[2];
const cfg = (await import(pathToFileURL(path.resolve(cfgPath)).href)).default;
const dir = path.dirname(path.resolve(cfgPath));
const OUT = cfg.out || path.join(dir, 'shots-insta');
await mkdir(OUT, { recursive: true });

const b64 = async (p) => {
  const buf = await readFile(path.resolve(dir, p));
  return 'data:image/png;base64,' + buf.toString('base64');
};
const shot = await b64(cfg.image);
const logo = await b64(cfg.base || '../../assets/logo.png').catch(()=>null);

const html = (w, h, portrait) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&family=Gowun+Dodum&display=swap" rel="stylesheet">
<style>
  *{margin:0;box-sizing:border-box}
  body{width:${w}px;height:${h}px;background:#FFF7EC;font-family:'Gowun Dodum',sans-serif;color:#2E2A26;
       display:flex;flex-direction:column;padding:${portrait?70:56}px;overflow:hidden}
  .badge{align-self:flex-start;background:#F2A33C;color:#fff;font-family:'Gaegu',cursive;font-size:34px;
         border-radius:40px;padding:10px 30px;margin-bottom:26px}
  h1{font-family:'Gaegu',cursive;font-weight:700;font-size:${portrait?74:64}px;line-height:1.12;margin-bottom:22px}
  .hook{font-size:${portrait?38:34}px;line-height:1.5;color:#5c5148;margin-bottom:${portrait?40:30}px}
  .shot{flex:1;background:url('${shot}') center top/cover no-repeat;border-radius:28px;
        border:3px solid #EAD9BE;box-shadow:0 18px 50px rgba(199,122,44,.22)}
  .foot{display:flex;align-items:center;gap:16px;margin-top:34px}
  .foot img{height:64px}
  .foot .tl{font-family:'Gaegu',cursive;font-size:34px;color:#7A6A56}
  .dot{color:#3CC9A0}
</style></head><body>
  <div class="badge">${cfg.badge || '🛠 덕구랩'}</div>
  <h1>${cfg.title}</h1>
  <div class="hook">${cfg.hook}</div>
  <div class="shot"></div>
  <div class="foot">${logo?`<img src="${logo}">`:''}<span class="tl">덕구랩<span class="dot"> ·</span> 박덕구쌤 🐈</span></div>
</body></html>`;

const run = async () => {
  const browser = await chromium.launch();
  for (const [name, w, h, portrait] of [['insta-portrait',1080,1350,true],['insta-square',1080,1080,false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(html(w, h, portrait), { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await ctx.close();
    console.log('✓', name);
  }
  await browser.close();
  console.log('→', OUT);
};
run().catch(e => { console.error('실패:', e); process.exit(1); });
