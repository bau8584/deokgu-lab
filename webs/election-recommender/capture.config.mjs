// election-recommender 캡처 설정
// 소유자 명시 허가된 데모: 관리자(비번 1234) 안쪽 + 후보 등록/추천 흐름 캡처.
// ⚠️ 개인정보: 관리자 요약 화면에 실제 학생명이 섞여 있어 홍길동(더미) 외 .cname 은 blur.
//   파괴적 조작(삭제/초기화/설정변경) 금지 — 보기·캡처만.
// 앱은 Google Apps Script iframe(userHtmlFrame) 안에서 동작 → 프레임 기반 캡처.
// 실행: node scripts/capture.mjs webs/election-recommender/capture.config.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://script.google.com/macros/s/AKfycbywbyPV-uCbZlnDbUKzPUznzTsYpsuoFpKqJBAvrmKtHmoqvxHnU766MhKFQb5GPBs/exec';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'shots');
const PAD = 16;
const FRAME_Y = 45;      // 파란 Google 배너(top page 상단 45px) 아래로만 자른다
const ADMIN_PW = process.env.ELECTION_ADMIN_PW || '1234'; // 소유자 데모 비번(공개 데모)

// --- iframe 헬퍼 (top page + userHtmlFrame 좌표 보정) ---
const F = (page) => page.frames().find(f => f.name() === 'userHtmlFrame');

const clipFor = async (page, sel) => {
  const frame = F(page);
  const b = await frame.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
  if (!b) throw new Error('no box: ' + sel);
  return {
    x: Math.max(0, b.x - PAD),
    y: Math.max(FRAME_Y, b.y + FRAME_Y - PAD),
    width: b.w + PAD * 2,
    height: b.h + PAD * 2,
  };
};

const click = (page, fn) => F(page).evaluate(fn);
const setVal = (page, id, v) => F(page).evaluate(([i, val]) => {
  const e = document.getElementById(i); if (!e) return;
  e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, v]);

// 관리자 로그인(요약 탭까지)
const adminLogin = async (page) => {
  await click(page, () => document.querySelector('.adminlink')?.click());
  await page.waitForTimeout(900);
};
const adminSubmit = async (page, pw) => {
  await setVal(page, 'a_pw', pw);
  await click(page, () => [...document.querySelectorAll('#screen-admin-login button')].find(x => /^로그인$/.test(x.innerText.trim()))?.click());
  await page.waitForTimeout(3500);
};

export default {
  url: URL,
  viewport: { width: 1440, height: 900 },
  out: OUT,
  padding: PAD,
  steps: [
    // 01 랜딩 (진입점)
    {
      name: '01-landing', wait: 1800,
      prepare: async (page) => {},
      clipFn: (page) => clipFor(page, '#screen-home'),
    },
    // 02 빈 후보등록 폼
    {
      name: '02-register-form', wait: 1800,
      prepare: async (page) => {
        await click(page, () => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '후보 등록하기')?.click());
        await page.waitForTimeout(700);
      },
      clipFn: (page) => clipFor(page, '#screen-register'),
    },
    // 03 관리자 로그인 화면(비번 입력 전)
    {
      name: '03-admin-login', wait: 1800,
      prepare: async (page) => { await adminLogin(page); },
      clipFn: (page) => clipFor(page, '#screen-admin-login'),
    },
    // 04 관리자 요약(집계) — 실명 blur(.cname 중 홍길동 제외)
    {
      name: '04-admin-dashboard', wait: 1800,
      prepare: async (page) => {
        await adminLogin(page);
        await adminSubmit(page, ADMIN_PW);
        await click(page, () => [...document.querySelectorAll('.adm-tab')].find(x => x.innerText.trim() === '요약')?.click());
        await page.waitForTimeout(2500);
        // 홍길동(더미) 외 실제 학생 정보 blur: 이름 + 반·번호(식별 가능한 준식별자)까지
        await F(page).evaluate(() => {
          const B = el => { el.style.filter = 'blur(8px)'; el.style.userSelect = 'none'; };
          // 이름 블러
          document.querySelectorAll('#screen-admin .cname').forEach(el => {
            if (el.innerText.trim() !== '홍길동') B(el);
          });
          // 학년·반·번호 텍스트(홍길동=6학년 1반 1번 은 제외)까지 블러
          const meta = /\d+\s*학년\s*\d+\s*반\s*\d+\s*번/;
          const walk = document.createTreeWalker(document.querySelector('#screen-admin'), NodeFilter.SHOW_ELEMENT);
          const hits = [];
          while (walk.nextNode()) {
            const el = walk.currentNode;
            if (el.children.length === 0 && meta.test(el.innerText || '')) {
              const t = el.innerText.replace(/\s/g, '');
              if (!/6학년1반1번/.test(t)) hits.push(el);
            }
          }
          hits.forEach(B);
        });
      },
      clipFn: (page) => clipFor(page, '#screen-admin'),
    },
    // 05 관리자 설정(목표 인원·직위·추천 제한) — 실명 없음, 안전
    {
      name: '05-admin-settings', wait: 1800,
      prepare: async (page) => {
        await adminLogin(page);
        await adminSubmit(page, ADMIN_PW);
        await click(page, () => [...document.querySelectorAll('.adm-tab')].find(x => x.innerText.trim() === '설정')?.click());
        await page.waitForTimeout(2000);
      },
      clipFn: (page) => clipFor(page, '#screen-admin'),
    },
    // 06 후보 등록 폼 — 홍길동 정보 입력됨(비번 칸은 값 넣되 캡처엔 점으로 보이도록 실 제출 안 함)
    {
      name: '06-candidate-register', wait: 1800,
      prepare: async (page) => {
        await click(page, () => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '후보 등록하기')?.click());
        await page.waitForTimeout(700);
        // 6학년 선택 → 반1 번호1 이름 홍길동
        await F(page).evaluate(() => {
          const g = document.getElementById('r_g');
          const opt = [...g.options].find(o => /6/.test(o.text));
          if (opt) { g.value = opt.value; g.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await page.waitForTimeout(500);
        await setVal(page, 'r_c', '1');
        await setVal(page, 'r_n', '1');
        await setVal(page, 'r_name', '홍길동');
        await setVal(page, 'r_code', '1234');
        await setVal(page, 'r_code2', '1234');
        await F(page).evaluate(() => { const c = document.getElementById('r_honest'); if (c && !c.checked) c.click(); });
        // 출마 직위 select 있으면 첫 실옵션 선택
        await F(page).evaluate(() => {
          const sel = [...document.querySelectorAll('#screen-register select')].find(s => s.id !== 'r_g');
          if (sel && sel.options.length > 1) { sel.selectedIndex = 1; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await page.waitForTimeout(400);
        // 비번 평문 노출 방지: r_code/r_code2 를 password 처럼 마스킹
        await F(page).evaluate(() => {
          ['r_code', 'r_code2'].forEach(id => { const e = document.getElementById(id); if (e) e.type = 'password'; });
        });
        // ⚠️ 제출하지 않음 — 홍길동은 이미 등록돼 있어 중복 방지
      },
      clipFn: (page) => clipFor(page, '#screen-register'),
    },
    // 07 추천 받는 화면 — 홍길동으로 로그인 → 대시보드 → 추천 받기(collect)
    {
      name: '07-recommend-screen', wait: 1800,
      prepare: async (page) => {
        await click(page, () => [...document.querySelectorAll('#screen-home button')].find(x => /^로그인$/.test(x.innerText.trim()))?.click());
        await page.waitForTimeout(800);
        await F(page).evaluate(() => {
          const g = document.getElementById('l_g');
          const opt = [...g.options].find(o => /6/.test(o.text));
          if (opt) { g.value = opt.value; g.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await setVal(page, 'l_c', '1');
        await setVal(page, 'l_name', '홍길동');
        await setVal(page, 'l_code', ADMIN_PW === '1234' ? '1234' : '1234');
        await click(page, () => document.getElementById('l_submit')?.click());
        await page.waitForTimeout(3000);
        await click(page, () => [...document.querySelectorAll('#screen-dash button')].find(x => /추천 받기/.test(x.innerText))?.click());
        await page.waitForTimeout(2200);
      },
      clipFn: (page) => clipFor(page, '#screen-collect'),
    },
  ],
};
