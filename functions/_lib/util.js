// 덕구랩 Functions 공용 헬퍼 — 비번 해시(Web Crypto), 레이트리밋, 검증
export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
export function bad(msg, status) { return json({ error: msg }, status || 400); }

// PBKDF2-SHA256 해시 — "salt:hashHex" 형태로 저장
async function pbkdf2(pw, saltBytes) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function hashPw(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hex = await pbkdf2(pw, salt);
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  return saltHex + ':' + hex;
}
export async function verifyPw(pw, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  const hex = await pbkdf2(pw, salt);
  if (hex.length !== hashHex.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// 같은 IP가 windowSec 안에 limit회 넘게 요청했으면 true(=차단)
export async function isRateLimited(db, ip, action, limit, windowSec) {
  const since = Date.now() - windowSec * 1000;
  const row = await db.prepare(
    'select count(*) as n from rate_hits where ip=? and action=? and at>?'
  ).bind(ip, action, since).first();
  if ((row && row.n) >= limit) return true;
  await db.prepare('insert into rate_hits(ip, action, at) values (?,?,?)').bind(ip, action, Date.now()).run();
  // 가끔 오래된 기록 청소(간단 확률적 청소, 별도 크론 없이)
  if (Math.random() < 0.05) {
    await db.prepare('delete from rate_hits where at < ?').bind(Date.now() - 24 * 3600 * 1000).run();
  }
  return false;
}

export function isHoneypot(v) { return !!(v && String(v).trim()); }
export function len(s) { return String(s || '').length; }
export const uid = () => crypto.randomUUID();
