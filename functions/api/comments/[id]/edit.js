import { json, bad, clientIp, isRateLimited, len, verifyPw } from '../../../_lib/util.js';

// POST /api/comments/:id/edit {pw, message} -> {ok:boolean}
export async function onRequestPost({ request, env, params }) {
  let body; try { body = await request.json(); } catch { return bad('bad json'); }
  const msg = String(body.message || '').trim();
  const pw = String(body.pw || '');
  if (len(msg) < 2 || len(msg) > 1000) return bad('bad message');
  const ip = clientIp(request);
  if (await isRateLimited(env.DB, ip, 'edit', 20, 60)) return bad('too many requests', 429);
  const row = await env.DB.prepare('select pw_hash from comments where id=?').bind(params.id).first();
  if (!row || !(await verifyPw(pw, row.pw_hash))) return json({ ok: false });
  await env.DB.prepare('update comments set message=? where id=?').bind(msg, params.id).run();
  return json({ ok: true });
}
