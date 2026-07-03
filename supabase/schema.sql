-- 덕구랩 백엔드 스키마 (Supabase) — 좋아요·제안함·댓글
-- Supabase 프로젝트 생성 후 SQL Editor에 붙여넣어 실행.
-- 익명(anon) 키로 브라우저에서 직접 호출한다. RLS로 권한을 잠근다.

-- ── 좋아요 ──────────────────────────────────────────────
create table if not exists public.likes (
  item_id text primary key,
  count   int  not null default 0
);
alter table public.likes enable row level security;
-- 카운트는 누구나 읽기 OK
create policy "likes read"  on public.likes for select using (true);
-- 직접 쓰기는 막고, 증가는 아래 RPC로만
-- (increment_like 함수가 security definer로 안전하게 +1)

create or replace function public.increment_like(p_item_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  insert into public.likes(item_id, count) values (p_item_id, 1)
  on conflict (item_id) do update set count = public.likes.count + 1
  returning count into v_count;
  return v_count;
end; $$;
grant execute on function public.increment_like(text) to anon, authenticated;
-- ⚠️ 어뷰징: 프론트는 localStorage로 중복을 막지만, 서버 레이트리밋은
--   Edge Function(IP 기준) 또는 pg 확장으로 추후 보강 권장.

-- ── 제안함 (개선·문의) — insert-only ────────────────────
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  item_id    text,
  message    text not null check (char_length(message) between 1 and 2000),
  contact    text check (contact is null or char_length(contact) <= 200),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
-- 익명 insert만 허용, 읽기는 아무에게도 (소유자는 대시보드/서비스키로 조회)
create policy "feedback insert" on public.feedback for insert with check (true);
-- select 정책 없음 = anon 읽기 불가 (소유자만 대시보드에서 봄)

-- ── 댓글 — 공개 읽기 + 비번(4자리) 본인 수정/삭제 + 추천/비추천 ──
create extension if not exists pgcrypto;
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  item_id    text not null,
  name       text check (name is null or char_length(name) <= 40),
  message    text not null check (char_length(message) between 1 and 1000),
  pw_hash    text not null,
  up         int  not null default 0,
  down       int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;
create policy "comments read" on public.comments for select using (true);
-- ⚠️ pw_hash 노출 방지: 컬럼 단위로 select 권한 제한. insert/update/delete는 정책 없음(anon 불가) → 아래 RPC로만.
revoke select on public.comments from anon, authenticated;
grant  select (id, item_id, name, message, up, down, created_at) on public.comments to anon, authenticated;

-- 등록: 허니팟·비번·길이 검증 후 bcrypt 해시 저장, 새 행 반환(pw_hash 제외)
create or replace function public.add_comment(p_item_id text, p_name text, p_message text, p_pw text, p_hp text default '')
returns table(id uuid, item_id text, name text, message text, up int, down int, created_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_hp,'') <> '' then raise exception 'bot'; end if;               -- 허니팟: 채워졌으면 봇
  if p_pw !~ '^[0-9]{4}$' then raise exception 'pw must be 4 digits'; end if;
  if char_length(p_message) < 2 or char_length(p_message) > 1000 then raise exception 'bad message'; end if;
  return query
  insert into public.comments(item_id, name, message, pw_hash)
  values (p_item_id, nullif(p_name,''), p_message, crypt(p_pw, gen_salt('bf')))
  returning comments.id, comments.item_id, comments.name, comments.message, comments.up, comments.down, comments.created_at;
end; $$;

-- 수정: 비번 일치 시에만
create or replace function public.edit_comment(p_id uuid, p_pw text, p_message text)
returns boolean language plpgsql security definer set search_path=public as $$
declare ok boolean;
begin
  update public.comments set message=p_message
    where id=p_id and pw_hash = crypt(p_pw, pw_hash) returning true into ok;
  return coalesce(ok,false);
end; $$;

-- 삭제: 비번 일치 시에만
create or replace function public.delete_comment(p_id uuid, p_pw text)
returns boolean language plpgsql security definer set search_path=public as $$
declare ok boolean;
begin
  delete from public.comments where id=p_id and pw_hash = crypt(p_pw, pw_hash) returning true into ok;
  return coalesce(ok,false);
end; $$;

-- 추천/비추천 (+1). 중복은 프론트 localStorage로 방지
create or replace function public.vote_comment(p_id uuid, p_dir text)
returns table(up int, down int)
language plpgsql security definer set search_path=public as $$
begin
  if p_dir='up' then update public.comments set up=up+1 where id=p_id;
  elsif p_dir='down' then update public.comments set down=down+1 where id=p_id; end if;
  return query select c.up, c.down from public.comments c where c.id=p_id;
end; $$;

grant execute on function public.add_comment(text,text,text,text,text) to anon, authenticated;
grant execute on function public.edit_comment(uuid,text,text)     to anon, authenticated;
grant execute on function public.delete_comment(uuid,text)        to anon, authenticated;
grant execute on function public.vote_comment(uuid,text)          to anon, authenticated;
-- ※ 4자리 비번은 약하다(브루트포스). 학교 댓글 수준엔 충분하나, 필요 시 RPC에 시도제한 보강.

-- ── 스팸 방어 정리 ──────────────────────────────────────
-- 1) 길이 제한 = 위 check 제약 + add_comment 내부 검증.
-- 2) 허니팟 = add_comment(p_hp): 프론트 숨김칸이 채워지면 봇 → 거부. (프론트에서도 1차 차단)
-- 3) 최소 작성 간격 = 프론트 localStorage(assets/api.js의 canPost/markPost). 서버 강제는 아래 4)로.
-- 4) IP 레이트리밋(진짜 IP 기준) = Supabase Edge Function 필요. DB 함수는 실제 클라 IP를 못 봄.
--    예) Edge Function이 요청 헤더 x-forwarded-for로 IP를 읽어 rate_limit 테이블과 대조 후 add_comment 호출.
--    (백엔드 연결 2단계에서 추가 권장. 니치 트래픽이면 1~3만으로도 충분한 경우가 많음.)
-- create table if not exists public.rate_limit(ip text, at timestamptz default now());  -- Edge Function용(선택)

-- 연결 방법(프론트): index.html·게시글 <head>에 아래 한 줄만 추가하면 mock→실서버 전환
--   <script>window.DEOKGU_SUPABASE={url:'https://xxxx.supabase.co', key:'<anon key>'}</script>
--   (그 다음에 assets/api.js 로드)
