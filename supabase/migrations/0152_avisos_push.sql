-- Avisos no celular e no computador (leva Memória e avisos no celular, parte 2, 21/10/2026; spec:
-- avisos push do painel no celular e no computador, por tipo de aviso). Web Push com as chaves
-- VAPID do BoaVoz: cada aparelho que ativa vira uma linha (o endereço do navegador e as chaves dele,
-- cifradas); a escolha dos tipos de aviso é da pessoa (push_prefs, sem escolha = todos ligados).
-- Sem policy: só o servidor lê e escreve.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_type text not null check (member_type in ('agency_member', 'client_member')),
  member_id uuid not null,
  endpoint text not null unique,
  keys_enc text not null,
  label text check (label is null or char_length(label) <= 80),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  failures int not null default 0
);
create index if not exists push_subscriptions_member_idx on public.push_subscriptions (member_type, member_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant all on public.push_subscriptions to service_role;

alter table public.agency_members add column if not exists push_prefs jsonb;
alter table public.client_members add column if not exists push_prefs jsonb;

-- quem sai da agência (ou da área do cliente) leva os aparelhos junto: nenhum aviso sobra para ela
create or replace function public.push_subscriptions_forget() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where member_type = tg_argv[0] and member_id = old.id;
  return null;
end $$;
drop trigger if exists agency_members_push_forget on public.agency_members;
create trigger agency_members_push_forget after delete on public.agency_members
  for each row execute function public.push_subscriptions_forget('agency_member');
drop trigger if exists agency_members_push_removed on public.agency_members;
create trigger agency_members_push_removed after update of removed_at on public.agency_members
  for each row when (new.removed_at is not null and old.removed_at is null) execute function public.push_subscriptions_forget('agency_member');
drop trigger if exists client_members_push_forget on public.client_members;
create trigger client_members_push_forget after delete on public.client_members
  for each row execute function public.push_subscriptions_forget('client_member');
