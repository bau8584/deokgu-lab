import { json, bad, clientIp, isRateLimited, verifyPw } from '../../../_lib/util.js';

// POST /api/comments/:id/delete {pw} -> {ok:boolean}
export async function onRequestPost({ request, env, params }) {
  let body; try { body = await request.json(); } catch { return bad('bad json'); }
  const pw = String(body.pw || '');
  const ip = clientIp(request);
  if (await isRateLimited(env.DB, ip, 'delete', 20, 60)) return bad('too many requests', 429);
  const row = await env.DB.prepare('select pw_hash from comments where id=?').bind(params.id).first();
  if (!row || !(await verifyPw(pw, row.pw_hash))) return json({ ok: false });
  await env.DB.prepare('delete from comments where id=?').bind(params.id).run();
  return json({ ok: true });
}
