export function onRequestGet() {
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
}
