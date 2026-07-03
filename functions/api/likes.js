import { json, bad, clientIp, isRateLimited } from '../_lib/util.js';

// GET /api/likes?ids=a,b,c -> {a:1,b:0,...}
export async function onRequestGet({ request, env }) {
  const ids = (new URL(request.url).searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return json({});
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`select item_id, count from likes where item_id in (${placeholders})`).bind(...ids).all();
  const out = {}; ids.forEach((id) => (out[id] = 0));
  (rows.results || []).forEach((r) => (out[r.item_id] = r.count));
  return json(out);
}

// POST /api/likes {item_id} -> {count} (원자적 +1)
export async function onRequestPost({ request, env }) {
  let body; try { body = await request.json(); } catch { return bad('bad json'); }
  const id = String(body.item_id || '').trim();
  if (!id || id.length > 100) return bad('bad item_id');
  const ip = clientIp(request);
  if (await isRateLimited(env.DB, ip, 'like', 30, 60)) return bad('too many requests', 429);
  await env.DB.prepare(
    'insert into likes(item_id, count) values (?,1) on conflict(item_id) do update set count = count + 1'
  ).bind(id).run();
  const row = await env.DB.prepare('select count from likes where item_id=?').bind(id).first();
  return json({ count: row ? row.count : 1 });
}
