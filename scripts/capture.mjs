// capture.mjs — 설정 기반 캡처 엔진
// 실행: node scripts/capture.mjs webs/<app>/capture.config.mjs
//
// config 형식(default export):
// {
//   url, viewport?, out?,            // out 미지정 시 config 파일 폴더의 ./shots
//   padding?,                        // 요소 크롭 여백(px, 기본 16)
//   blur?: ['셀렉터', ...],          // 모든 컷에 공통 적용할 개인정보 블러
//   steps: [
//     { name:'01-foo', selector:'.box', prepare?:async(page)=>{}, blur?:[...],
//       fullPage?:false, clip?:{x,y,width,height}, hideBanner?:true }
//   ]
// }
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cfgPath = process.argv[2];
if (!cfgPath) { console.error('config 경로 필요'); process.exit(1); }
const cfg = (await import(pathToFileURL(path.resolve(cfgPath)).href)).default;
const OUT = cfg.out || path.join(path.dirname(path.resolve(cfgPath)), 'shots');
const PAD = cfg.padding ?? 16;

const applyBlur = async (page, selectors=[]) => {
  if (!selectors.length) return;
  await page.evaluate((sels) => {
    for (const s of sels) {
      document.querySelectorAll(s).forEach(el => {
        el.style.filter = 'blur(7px)';
        el.style.userSelect = 'none';
      });
    }
  }, selectors);
};

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: cfg.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const results = [];

  for (const step of cfg.steps) {
    try {
      await page.goto(step.url || cfg.url, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(step.wait ?? 800);
      if (step.prepare) await step.prepare(page);
      await page.waitForTimeout(step.afterWait ?? 400);
      await applyBlur(page, [...(cfg.blur||[]), ...(step.blur||[])]);

      const file = path.join(OUT, `${step.name}.png`);
      if (step.fullPage) {
        await page.screenshot({ path: file, fullPage: true });
      } else if (step.clipFn) {
        const clip = await step.clipFn(page);
        await page.screenshot({ path: file, clip });
      } else if (step.clip) {
        await page.screenshot({ path: file, clip: step.clip });
      } else if (step.selector) {
        const el = page.locator(step.selector).first();
        await el.scrollIntoViewIfNeeded();
        await el.waitFor({ state: 'visible', timeout: 8000 });
        const box = await el.boundingBox();
        if (!box) throw new Error('boundingBox 실패: ' + step.selector);
        await page.screenshot({ path: file, clip: {
          x: Math.max(0, box.x - PAD), y: Math.max(0, box.y - PAD),
          width: box.width + PAD*2, height: box.height + PAD*2,
        }});
      } else {
        await page.screenshot({ path: file });
      }
      console.log('✓', step.name);
      results.push({ name: step.name, ok: true });
    } catch (e) {
      console.log('✗', step.name, '—', e.message);
      results.push({ name: step.name, ok: false, error: e.message });
    }
  }
  await browser.close();
  const okc = results.filter(r=>r.ok).length;
  console.log(`\n완료 — ${okc}/${results.length}  →  ${OUT}`);
  if (okc < results.length) console.log('실패:', results.filter(r=>!r.ok).map(r=>r.name+': '+r.error).join(' | '));
};
run().catch(e => { console.error('실패:', e); process.exit(1); });
