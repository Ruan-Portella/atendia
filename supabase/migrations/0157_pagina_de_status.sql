-- Página de status (antes do lançamento; post do X de 18/10, trazido em 21/10/2026). A página pública
-- /status (e status.boavoz.com) mostra cada componente do BoaVoz com o estado de agora, o histórico de
-- 90 dias e os incidentes. O estado automático sai dos sinais que o BoaVoz já mede (a escrita no
-- banco, a fila da Meta, as mensagens que precisaram de outra tentativa e os envios recusados),
-- conferidos a cada 5 minutos no tique das campanhas; só muda depois de duas leituras iguais
-- (pending_*), para não piscar em público. Os incidentes são escritos pelo suporte no backoffice,
-- com as atualizações. Sem policy: a página lê pelo servidor. Idempotente.

create table if not exists public.status_current (
  component text primary key check (component in ('painel', 'chat', 'whatsapp', 'instagram', 'ia', 'api')),
  state text not null default 'operando' check (state in ('operando', 'instavel', 'fora')),
  since timestamptz not null default now(),
  reason text,
  pending_state text check (pending_state is null or pending_state in ('operando', 'instavel', 'fora')),
  pending_count int not null default 0,
  checked_at timestamptz
);
insert into public.status_current (component) values ('painel'), ('chat'), ('whatsapp'), ('instagram'), ('ia'), ('api')
on conflict (component) do nothing;

-- os minutos com problema de cada dia (a barra dos 90 dias); sai depois de 120 dias
create table if not exists public.status_daily (
  component text not null,
  day date not null,
  degraded_minutes int not null default 0,
  down_minutes int not null default 0,
  primary key (component, day)
);

create table if not exists public.status_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  level text not null check (level in ('instabilidade', 'fora', 'manutencao')),
  components text[] not null,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists status_incidents_recent_idx on public.status_incidents (started_at desc);

create table if not exists public.status_updates (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.status_incidents(id) on delete cascade,
  body text not null check (char_length(body) between 3 and 1000),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists status_updates_incident_idx on public.status_updates (incident_id, created_at);

alter table public.status_current enable row level security;
alter table public.status_daily enable row level security;
alter table public.status_incidents enable row level security;
alter table public.status_updates enable row level security;
revoke all on public.status_current, public.status_daily, public.status_incidents, public.status_updates from anon, authenticated;
grant all on public.status_current, public.status_daily, public.status_incidents, public.status_updates to service_role;

/* Soma os minutos do estado de um componente no dia de hoje (São Paulo). */
create or replace function public.add_status_minutes(p_component text, p_state text, p_minutes int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_state not in ('instavel', 'fora') then
    return;
  end if;
  insert into public.status_daily (component, day, degraded_minutes, down_minutes)
  values (p_component, (now() at time zone 'America/Sao_Paulo')::date, case when p_state = 'instavel' then p_minutes else 0 end, case when p_state = 'fora' then p_minutes else 0 end)
  on conflict (component, day) do update set
    degraded_minutes = public.status_daily.degraded_minutes + excluded.degraded_minutes,
    down_minutes = public.status_daily.down_minutes + excluded.down_minutes;
end $$;
revoke all on function public.add_status_minutes(text, text, int) from public, anon, authenticated;
grant execute on function public.add_status_minutes(text, text, int) to service_role;

notify pgrst, 'reload schema';
