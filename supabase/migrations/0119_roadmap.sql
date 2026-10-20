-- Boavoz · roadmap público com curtidas (Lançamento, parte 5, 19/10/2026): o que estamos fazendo e o
-- que vem por aí, em quatro colunas (Ideias, Vamos fazer, Fazendo, Pronto), sem datas nem detalhes
-- de como. Página aberta em /roadmap e no painel, onde quem tem conta curte (uma curtida por pessoa)
-- e manda sugestões, que nós moderamos no backoffice antes de virarem item. Tudo pela service role
-- (as telas conferem quem é). Ver src/lib/roadmap.ts. Idempotente.
create table if not exists public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  summary text check (summary is null or char_length(summary) <= 300),
  status text not null default 'ideia' check (status in ('ideia', 'vamos_fazer', 'fazendo', 'pronto')),
  -- mantido pelo gatilho das curtidas (a ordem das colunas Ideias e Vamos fazer)
  likes integer not null default 0,
  created_at timestamptz not null default now(),
  -- a ordem dentro de Fazendo e Pronto (não aparece: o roadmap não tem datas)
  status_changed_at timestamptz not null default now()
);
create index if not exists roadmap_items_status_idx on public.roadmap_items (status, likes desc);
alter table public.roadmap_items enable row level security; -- interna: só service role
grant all on public.roadmap_items to service_role;

create table if not exists public.roadmap_likes (
  item_id uuid not null references public.roadmap_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index if not exists roadmap_likes_user_idx on public.roadmap_likes (user_id);
alter table public.roadmap_likes enable row level security; -- interna: só service role
grant all on public.roadmap_likes to service_role;

create or replace function public.roadmap_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.roadmap_items set likes = likes + 1 where id = new.item_id;
  elsif tg_op = 'DELETE' then
    update public.roadmap_items set likes = greatest(0, likes - 1) where id = old.item_id;
  end if;
  return null;
end;
$$;
revoke all on function public.roadmap_likes_count() from public, anon, authenticated;
drop trigger if exists roadmap_likes_count on public.roadmap_likes;
create trigger roadmap_likes_count after insert or delete on public.roadmap_likes
  for each row execute function public.roadmap_likes_count();

-- sugestão de quem tem conta: nova até a moderação publicar (vira item em Ideias), juntar a um item
-- parecido (a pessoa ganha a curtida nele) ou recusar
create table if not exists public.roadmap_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  title text not null check (char_length(title) between 3 and 120),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'nova' check (status in ('nova', 'publicada', 'juntada', 'recusada')),
  item_id uuid references public.roadmap_items(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists roadmap_suggestions_status_idx on public.roadmap_suggestions (status, created_at desc);
create index if not exists roadmap_suggestions_user_idx on public.roadmap_suggestions (user_id, created_at desc);
alter table public.roadmap_suggestions enable row level security; -- interna: só service role
grant all on public.roadmap_suggestions to service_role;

notify pgrst, 'reload schema';
