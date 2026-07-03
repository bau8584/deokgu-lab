import { json, bad, clientIp, isRateLimited, isHoneypot, len, uid, hashPw } from '../../_lib/util.js';

// GET /api/comments?item_id=x -> [{id,item_id,name,message,up,down,created_at}, ...] (최신순, pw_hash 제외)
export async function onRequestGet({ request, env }) {
  const itemId = new URL(request.url).searchParams.get('item_id');
  if (!itemId) return bad('item_id required');
  const rows = await env.DB.prepare(
    'select id, item_id, name, message, up, down, created_at from comments where item_id=? order by created_at desc'
  ).bind(itemId).all();
  return json(rows.results || []);
}

// POST /api/comments {item_id, name, message, pw, hp}
export async function onRequestPost({ request, env }) {
  let body; try { body = await request.json(); } catch { return bad('bad json'); }
  if (isHoneypot(body.hp)) return json({ id: uid(), up: 0, down: 0 }); // 봇 → 저장 안 하고 성공처럼 응답
  const itemId = String(body.item_id || '').trim();
  const msg = String(body.message || '').trim();
  const pw = String(body.pw || '');
  if (!itemId) return bad('item_id required');
  if (len(msg) < 2 || len(msg) > 1000) return bad('bad message');
  if (!/^[0-9]{4}$/.test(pw)) return bad('pw must be 4 digits');
  const name = body.name ? String(body.name).trim().slice(0, 40) : null;
  const ip = clientIp(request);
  if (await isRateLimited(env.DB, ip, 'comment', 10, 60)) return bad('too many requests', 429);
  const id = uid();
  const pwHash = await hashPw(pw);
  const now = Date.now();
  await env.DB.prepare(
    'insert into comments(id, item_id, name, message, pw_hash, up, down, created_at) values (?,?,?,?,?,0,0,?)'
  ).bind(id, itemId, name, msg, pwHash, now).run();
  return json({ id, item_id: itemId, name, message: msg, up: 0, down: 0, created_at: now });
}
