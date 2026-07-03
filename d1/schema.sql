-- 덕구랩 백엔드 스키마 (Cloudflare D1, SQLite)
-- 배포 전 로컬: `npx wrangler d1 execute DB --local --file=d1/schema.sql`
-- 실배포:      `npx wrangler d1 execute DB --remote --file=d1/schema.sql`
-- 보안(비번 확인·허니팟·길이·레이트리밋)은 D1엔 RLS가 없어 전부 functions/api/*.js 에서 처리한다.

create table if not exists likes (
  item_id text primary key,
  count   integer not null default 0
);

create table if not exists feedback (
  id         text primary key,
  item_id    text,
  message    text not null,
  contact    text,
  created_at integer not null   -- epoch ms
);

create table if not exists comments (
  id         text primary key,
  item_id    text not null,
  name       text,
  message    text not null,
  pw_hash    text not null,     -- "salt:hashHex" (PBKDF2-SHA256, Web Crypto)
  up         integer not null default 0,
  down       integer not null default 0,
  created_at integer not null
);
create index if not exists idx_comments_item on comments(item_id);

-- IP 레이트리밋용 (functions에서 최근 N초 내 요청 수를 셈)
create table if not exists rate_hits (
  ip     text not null,
  action text not null,
  at     integer not null
);
create index if not exists idx_rate_ip_action_at on rate_hits(ip, action, at);
