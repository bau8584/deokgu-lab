// 스티커 시트 → 개별 이모티콘 크롭 + 배경 투명화 파이프라인
// 사용:
//   node sticker.js overlay <sheet.png> <out.png>           # 번호 오버레이(검증용)
//   node sticker.js final   <sheet.png> <outDir> <labels.json> <sigStore.json>
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ---------- 공통 파라미터 ----------
const TOL = 34;          // 배경색 허용 오차
const NOISE_MIN = 45;    // 이 면적 미만 컴포넌트는 노이즈로 무시
const MERGE_GAP = 20;    // 이 간격(px) 이내 컴포넌트는 한 덩어리(소품 병합)
const FIG_AREA = 14000;  // 덩어리 총면적 이상 → 이모티콘(피규어)로 인정
const FIG_H = 140;       // 덩어리 높이 이상 → 피규어 (긴 라벨 텍스트 배제)
const MARGIN = 8;        // 크롭 여백(투명 패딩)
const ROW_GAP = 170;     // 행 클러스터링 기준

function loadSheet(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return png;
}

function computeBgMask(png) {
  const { width: W, height: H, data } = png;
  const corner = (x0, y0) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y0 + 30; y++) for (let x = x0; x < x0 + 30; x++) {
      const i = (y * W + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    return [r / n, g / n, b / n];
  };
  const cs = [corner(0, 0), corner(W - 30, 0), corner(0, H - 30), corner(W - 30, H - 30)];
  const bg = [0, 1, 2].map(k => cs.reduce((s, c) => s + c[k], 0) / 4);
  const isBg = (i) => {
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    return dr * dr + dg * dg + db * db < TOL * TOL;
  };
  const mask = new Uint8Array(W * H);
  const stk = [];
  for (let x = 0; x < W; x++) { stk.push(x); stk.push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { stk.push(y * W); stk.push(y * W + W - 1); }
  while (stk.length) {
    const p = stk.pop();
    if (mask[p] || !isBg(p * 4)) continue;
    mask[p] = 1;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stk.push(p - 1); if (x < W - 1) stk.push(p + 1);
    if (y > 0) stk.push(p - W); if (y < H - 1) stk.push(p + W);
  }
  return { bg, mask };
}

function components(png, bgMask) {
  const { width: W, height: H } = png;
  const lab = new Int32Array(W * H);
  const st = new Int32Array(W * H);
  let next = 0; const comps = [];
  for (let p = 0; p < W * H; p++) {
    if (bgMask[p] || lab[p]) continue;
    next++; let sp = 0; st[sp++] = p; lab[p] = next;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
    while (sp) {
      const q = st[--sp]; const x = q % W, y = (q / W) | 0; area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (!bgMask[np] && !lab[np]) { lab[np] = next; st[sp++] = np; }
      }
    }
    comps.push({ id: next, minX, minY, maxX, maxY, area, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return { lab, comps };
}

function gap(a, b) {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.max(dx, dy);
}

// 컴포넌트 클러스터링
//  - 큰 고양이(core)끼리는 '거의 맞닿을 때(TOUCH)'만 병합 → 인접 이모티콘 분리 유지
//  - 작은 효과/소품은 '가장 가까운 core 하나'에만 부착 → 효과가 두 고양이를 잇는 오병합 방지
//  - core 아래쪽의 작은 덩어리(라벨 글자)는 부착하지 않음
const CORE_MIN = 30000; // 이 면적 이상이면 고양이 본체(core)
const TOUCH = 14;       // core끼리 병합 허용 간격(소품이 맞닿은 경우 포함)
function cluster(comps) {
  const big = comps.filter(c => c.area >= NOISE_MIN);
  const cores = [], smalls = [];
  for (const c of big) (c.area >= CORE_MIN ? cores : smalls).push(c);
  const parent = big.map((_, i) => i);
  const idx = new Map(big.map((c, i) => [c, i]));
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const uni = (a, b) => { parent[find(idx.get(a))] = find(idx.get(b)); };
  // core끼리: 맞닿은 경우만 병합(고양이+소품이 붙은 케이스)
  for (let i = 0; i < cores.length; i++) for (let j = i + 1; j < cores.length; j++)
    if (gap(cores[i], cores[j]) <= TOUCH) uni(cores[i], cores[j]);
  // 작은 것: 가장 가까운 core 하나에만 부착.
  // 단, '어떤 고양이든' 그 바로 아래(라벨영역)에 걸치는 덩어리는 라벨로 보고 부착하지 않음.
  // (이모티콘 자기 라벨 + 윗줄/아랫줄 라벨이 겹쳐 있는 시트에서 라벨 누출 방지)
  const LABEL_ZONE = 110;
  const isLabel = (s) => cores.some(c => {
    const horiz = !(s.maxX < c.minX || s.minX > c.maxX);
    return horiz && s.minY >= c.maxY - 8 && (s.minY - c.maxY) < LABEL_ZONE;
  });
  for (const s of smalls) {
    if (isLabel(s)) continue;
    let best = null, bestGap = MERGE_GAP + 1;
    for (const c of cores) { const g = gap(s, c); if (g < bestGap) { bestGap = g; best = c; } }
    if (best) uni(s, best);
  }
  const map = new Map();
  big.forEach((c, i) => {
    const r = find(i);
    if (!map.has(r)) map.set(r, { members: [], minX: 1e9, minY: 1e9, maxX: 0, maxY: 0, area: 0 });
    const cl = map.get(r);
    cl.members.push(c);
    cl.minX = Math.min(cl.minX, c.minX); cl.minY = Math.min(cl.minY, c.minY);
    cl.maxX = Math.max(cl.maxX, c.maxX); cl.maxY = Math.max(cl.maxY, c.maxY);
    cl.area += c.area;
  });
  let clusters = [...map.values()].filter(c => c.area >= FIG_AREA && (c.maxY - c.minY + 1) >= FIG_H);
  clusters.forEach(c => { c.cx = (c.minX + c.maxX) / 2; c.cy = (c.minY + c.maxY) / 2; });
  // 행 단위 정렬(위→아래, 좌→우)
  clusters.sort((a, b) => a.cy - b.cy);
  const rows = []; let cur = [];
  for (const c of clusters) {
    if (cur.length && Math.abs(c.cy - cur[cur.length - 1].cy) > ROW_GAP) { rows.push(cur); cur = []; }
    cur.push(c);
  }
  if (cur.length) rows.push(cur);
  const ordered = [];
  for (const r of rows) { r.sort((a, b) => a.cx - b.cx); ordered.push(...r); }
  return ordered;
}

// ---------- 미니 숫자 폰트(3x5) ----------
const FONT = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
};
function drawNum(png, cx, cy, text, S) {
  const { width: W, data } = png;
  const cw = 3 * S + S, tw = text.length * cw - S, th = 5 * S;
  let x0 = Math.round(cx - tw / 2), y0 = Math.round(cy - th / 2);
  // 배경 원형(대비)
  const R = Math.max(tw, th) / 2 + S * 2;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R * R) continue;
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (x < 0 || y < 0 || x >= W || y >= png.height) continue;
    const i = (y * W + x) * 4; data[i] = 242; data[i + 1] = 60; data[i + 2] = 60; data[i + 3] = 255;
  }
  for (let k = 0; k < text.length; k++) {
    const g = FONT[text[k]]; const gx = x0 + k * cw;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (g[r][c] !== '1') continue;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const x = gx + c * S + sx, y = y0 + r * S + sy;
        if (x < 0 || y < 0 || x >= W || y >= png.height) continue;
        const i = (y * W + x) * 4; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
      }
    }
  }
}

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

// 디프린지: 배경(투명)에 인접한 '밝기 L>=FRINGE_LUM' 가장자리 픽셀을 몇 픽셀만 벗겨냄.
// 크림 제거 후 남는 것은 '검은 윤곽선의 바깥 안티앨리어싱(중간 회색 L80~115)' → 이걸 제거하면
// 그 안쪽 진짜 어두운 윤곽선(L20~50 < FRINGE_LUM)에서 자동으로 멈춰 흰 rim이 사라진다.
// 패스를 제한해 연한 요소(도넛 침대·유령 등, 어두운 윤곽선이 없는)는 가장자리 2px만 축소.
const FRINGE_PASSES = 2, FRINGE_LUM = 72;
function defringe(png) {
  const { width: W, height: H, data } = png;
  for (let pass = 0; pass < FRINGE_PASSES; pass++) {
    const kill = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] === 0) continue;
      const edge = (x > 0 && !data[i - 4 + 3]) || (x < W - 1 && !data[i + 4 + 3]) ||
        (y > 0 && !data[i - W * 4 + 3]) || (y < H - 1 && !data[i + W * 4 + 3]);
      if (!edge) continue;
      const lum = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      if (lum >= FRINGE_LUM) kill.push(i);
    }
    if (!kill.length) break;
    for (const i of kill) data[i + 3] = 0;
  }
}

// 알파 블리드(RGB dilation): 투명 픽셀(alpha=0)의 RGB를 '가장 가까운 불투명 픽셀 색'으로 채움.
// 알파는 0 유지. 뷰어/브라우저가 축소 표시할 때 투명영역의 크림색이 가장자리에 번져
// 생기는 밝은 halo(=사용자가 본 현상)를 근본 차단. 표준 스티커/텍스처 처리 기법.
function bleed(png) {
  const { width: W, height: H, data } = png;
  const known = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let tail = 0;
  for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] > 0) { known[p] = 1; q[tail++] = p; }
  for (let head = 0; head < tail; head++) {
    const p = q[head], x = p % W, y = (p / W) | 0, si = p * 4;
    const push = (np) => { if (!known[np]) { known[np] = 1; data[np * 4] = data[si]; data[np * 4 + 1] = data[si + 1]; data[np * 4 + 2] = data[si + 2]; q[tail++] = np; } };
    if (x > 0) push(p - 1); if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W); if (y < H - 1) push(p + W);
  }
}

// 알파 페더링: 3x3 박스블러로 가장자리만 부드럽게(계단현상 제거). 투명 영역으로 번지지
// 않도록 원래 알파보다 커지지 않게 min 적용 → 흰 halo 재유입 없이 안쪽으로만 1px 완화.
function feather(png) {
  const { width: W, height: H, data } = png;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = data[i * 4 + 3];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      s += a[ny * W + nx]; c++;
    }
    const blur = (s / c) | 0, k = y * W + x;
    if (blur < a[k]) data[k * 4 + 3] = blur; // 소프트닝만(감소만)
  }
}

// 내용정렬 시그니처(중복 판정용): 멤버(알파) 타이트 bbox 기준 N×N 그레이스케일
// → 크롭 패딩/크기 차이에 강인. 같은그림<28, 다른그림(같은라벨)>99 로 분리됨.
function signature(png, bgMask, lab, cl) {
  const { width: W, data } = png; const N = 40;
  const mem = new Set(cl.members.map(m => m.id));
  let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
  for (const m of cl.members) { x0 = Math.min(x0, m.minX); y0 = Math.min(y0, m.minY); x1 = Math.max(x1, m.maxX); y1 = Math.max(y1, m.maxY); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1; const sig = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const sx = x0 + Math.floor(i * w / N), sy = y0 + Math.floor(j * h / N);
    const sp = sy * W + sx, si = sp * 4;
    sig[j * N + i] = (!bgMask[sp] && mem.has(lab[sp])) ? (data[si] * 0.3 + data[si + 1] * 0.59 + data[si + 2] * 0.11) : 255;
  }
  return sig;
}
const DEDUP_T = 30; // 이 거리 미만 → 같은 그림
// 같은 라벨인데 그림이 여러 종류인 것들(둘 다 보존): 모른체(얼굴/전신), 이불냥이(웅크림/새벽커피)
const MULTI = new Set(['모른체', '이불냥이']);
function sigDist(a, b) {
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s / a.length);
}

// ---------- 메인 ----------
const mode = process.argv[2];
const sheetFile = process.argv[3];
const png = loadSheet(sheetFile);
const { mask: bgMask } = computeBgMask(png);
const { lab, comps } = components(png, bgMask);
const clusters = cluster(comps);
const { width: W, height: H, data } = png;

if (mode === 'overlay') {
  const outFile = process.argv[4];
  // 다운스케일 + 번호
  const scale = 1000 / W;
  const OW = Math.round(W * scale), OH = Math.round(H * scale);
  const out = new PNG({ width: OW, height: OH });
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
    const sx = Math.min(W - 1, Math.round(x / scale)), sy = Math.min(H - 1, Math.round(y / scale));
    const si = (sy * W + sx) * 4, di = (y * OW + x) * 4;
    out.data[di] = data[si]; out.data[di + 1] = data[si + 1]; out.data[di + 2] = data[si + 2]; out.data[di + 3] = 255;
  }
  clusters.forEach((c, idx) => drawNum(out, c.cx * scale, c.cy * scale, String(idx + 1), 3));
  fs.writeFileSync(outFile, PNG.sync.write(out));
  console.log(`clusters: ${clusters.length}`);
  clusters.forEach((c, i) => console.log(`  #${i + 1} bbox=(${c.minX},${c.minY})-(${c.maxX},${c.maxY}) ${c.maxX - c.minX + 1}x${c.maxY - c.minY + 1} area=${c.area}`));
}

if (mode === 'verify') {
  const outFile = process.argv[4];
  const cell = 300, cols = 5, pad = 8, labelH = 95;
  const rows = Math.ceil(clusters.length / cols);
  const CW = cols * (cell + pad) + pad, CH = rows * (cell + pad) + pad;
  const sheet = new PNG({ width: CW, height: CH });
  for (let i = 0; i < CW * CH; i++) { sheet.data[i * 4] = 245; sheet.data[i * 4 + 1] = 245; sheet.data[i * 4 + 2] = 245; sheet.data[i * 4 + 3] = 255; }
  clusters.forEach((c, idx) => {
    const bx0 = Math.max(0, c.minX - 16), by0 = Math.max(0, c.minY - 16);
    const bx1 = Math.min(W - 1, c.maxX + 16), by1 = Math.min(H - 1, c.maxY + labelH); // 라벨 포함
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const scale = Math.min(cell / bw, cell / bh);
    const dw = Math.round(bw * scale), dh = Math.round(bh * scale);
    const ox = pad + (idx % cols) * (cell + pad) + ((cell - dw) >> 1);
    const oy = pad + ((idx / cols | 0)) * (cell + pad) + ((cell - dh) >> 1);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const sx = bx0 + Math.min(bw - 1, (x / scale) | 0), sy = by0 + Math.min(bh - 1, (y / scale) | 0);
      const si = (sy * W + sx) * 4, dX = ox + x, dY = oy + y; if (dX >= CW || dY >= CH) continue;
      const di = (dY * CW + dX) * 4; sheet.data[di] = data[si]; sheet.data[di + 1] = data[si + 1]; sheet.data[di + 2] = data[si + 2]; sheet.data[di + 3] = 255;
    }
    drawNum(sheet, pad + (idx % cols) * (cell + pad) + 24, pad + ((idx / cols | 0)) * (cell + pad) + 22, String(idx + 1), 5);
  });
  fs.writeFileSync(outFile, PNG.sync.write(sheet));
  console.log(`verify grid: ${clusters.length} cells`);
}

if (mode === 'final') {
  const outDir = process.argv[4];
  const labels = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));
  const sigStoreFile = process.argv[6];
  fs.mkdirSync(outDir, { recursive: true });
  let store = [];
  if (fs.existsSync(sigStoreFile)) store = JSON.parse(fs.readFileSync(sigStoreFile, 'utf8'));
  const usedNames = new Set(store.map(s => s.file));
  // 기존 폴더의 파일명도 예약(다른 배치 병합 시 덮어쓰기 방지 → 충돌은 -2 접미사)
  if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) if (f.endsWith('.png')) usedNames.add(f);
  if (clusters.length !== labels.length)
    console.log(`!! 경고: 검출 ${clusters.length}개 vs 라벨 ${labels.length}개 불일치`);

  const report = [];
  clusters.forEach((cl, idx) => {
    const rawLabel = labels[idx] || `unlabeled_${idx + 1}`;
    if (rawLabel === '__skip__') { report.push({ idx: idx + 1, label: rawLabel, status: 'skip(수동제외)' }); return; }
    const sig = signature(png, bgMask, lab, cl);
    // 중복 판정: 같은(정제)라벨이면 기본적으로 중복(첫 것만 유지).
    // 단, 한 라벨에 '진짜 다른 포즈'가 있는 경우(MULTI)만 시그니처로 구분해 둘 다 보존.
    const clean = sanitize(rawLabel);
    const dup = store.find(s => s.clean === clean && (!MULTI.has(clean) || sigDist(sig, Float64Array.from(s.sig)) < DEDUP_T));
    if (dup) { report.push({ idx: idx + 1, label: rawLabel, status: `dup→${dup.file}` }); return; }
    // 파일명 결정(충돌 시 -2,-3)
    let base = clean, name = base + '.png', n = 2;
    while (usedNames.has(name)) { name = `${base}-${n}.png`; n++; }
    usedNames.add(name);
    // 크롭(멤버 픽셀만 불투명, 배경/라벨/이웃 투명)
    // 프로필은 옆 소개 텍스트 배제 위해 '가장 큰 컴포넌트(고양이 본체)'만 사용
    let members = cl.members, bMinX = cl.minX, bMinY = cl.minY, bMaxX = cl.maxX, bMaxY = cl.maxY;
    if (clean === '뀨-프로필') {
      const bigC = members.reduce((a, b) => a.area >= b.area ? a : b);
      members = [bigC]; bMinX = bigC.minX; bMinY = bigC.minY; bMaxX = bigC.maxX; bMaxY = bigC.maxY;
    }
    const memberIds = new Set(members.map(m => m.id));
    const x0 = Math.max(0, bMinX - MARGIN), y0 = Math.max(0, bMinY - MARGIN);
    const x1 = Math.min(W - 1, bMaxX + MARGIN), y1 = Math.min(H - 1, bMaxY + MARGIN);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const outPng = new PNG({ width: w, height: h });
    // 멤버 컴포넌트에 속한 픽셀만 유지 → 라벨 글자/이웃 이모티콘/배경 모두 투명
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gsx = x0 + x, gsy = y0 + y, sp = gsy * W + gsx, si = sp * 4, di = (y * w + x) * 4;
      const keep = !bgMask[sp] && memberIds.has(lab[sp]);
      outPng.data[di] = data[si]; outPng.data[di + 1] = data[si + 1]; outPng.data[di + 2] = data[si + 2];
      outPng.data[di + 3] = keep ? 255 : 0;
    }
    defringe(outPng);
    feather(outPng);
    bleed(outPng);
    fs.writeFileSync(path.join(outDir, name), PNG.sync.write(outPng));
    store.push({ clean, file: name, sig: Array.from(sig) });
    report.push({ idx: idx + 1, label: rawLabel, status: `saved ${name}` });
  });
  fs.writeFileSync(sigStoreFile, JSON.stringify(store));
  report.forEach(r => console.log(`  #${r.idx} ${r.label} → ${r.status}`));
}
