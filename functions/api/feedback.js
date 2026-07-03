import { json, bad, clientIp, isRateLimited, isHoneypot, len, uid } from '../_lib/util.js';

// POST /api/feedback {item_id, message, contact, hp}
export async function onRequestPost({ request, env }) {
  let body; try { body = await request.json(); } catch { return bad('bad json'); }
  if (isHoneypot(body.hp)) return json({ ok: true }); // 봇 → 성공처럼 응답하고 조용히 버림
  const msg = String(body.message || '').trim();
  if (len(msg) < 3 || len(msg) > 2000) return bad('bad message');
  const contact = body.contact ? String(body.contact).trim().slice(0, 200) : null;
  const item = body.item_id ? String(body.item_id).slice(0, 100) : null;
  const ip = clientIp(request);
  if (await isRateLimited(env.DB, ip, 'feedback', 5, 60)) return bad('too many requests', 429);
  await env.DB.prepare(
    'insert into feedback(id, item_id, message, contact, created_at) values (?,?,?,?,?)'
  ).bind(uid(), item, msg, contact, Date.now()).run();
  return json({ ok: true });
}
