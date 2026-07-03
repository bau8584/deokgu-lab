import { json, bad, clientIp, isRateLimited } from '../../../_lib/util.js';

// POST /api/comments/:id/vote {dir:'up'|'down'} -> {up,down}
// 클라이언트 중복 방지는 localStorage(프론트). 서버는 IP당 과다 투표만 레이트리밋으로 완화.
export async function onRequestPost({ request, env, params }) {
  let body; try { body = await request.json(); } catch { return bad('bad json'); }
  const dir = body.dir === 'down' ? 'down' : (body.dir === 'up' ? 'up' : null);
  if (!dir) return bad('bad dir');
  const ip = clientIp(request);
  if (await isRateLimited(env.DB, ip, 'vote', 30, 60)) return bad('too many requests', 429);
  await env.DB.prepare(`update comments set ${dir} = ${dir} + 1 where id=?`).bind(params.id).run();
  const row = await env.DB.prepare('select up, down from comments where id=?').bind(params.id).first();
  if (!row) return bad('not found', 404);
  return json(row);
}
