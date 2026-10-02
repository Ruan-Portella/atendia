-- Boavoz · pausa da IA (backoffice, 3ª entrega): por agência e a chave geral da plataforma.
-- Pausada, a IA não responde: no WhatsApp e no Instagram a conversa entra no modo só humano
-- (mensagem guardada, pedido de atendente, aviso fixo uma vez); no site, o widget mostra o
-- formulário de contato. Idempotente.

alter table public.agencies add column if not exists ai_paused_at timestamptz;
alter table public.agencies add column if not exists ai_paused_reason text;

-- Uma linha só: a chave geral (emergência: a IA de todas as agências para de uma vez).
create table if not exists public.platform_flags (
  id int primary key default 1 check (id = 1),
  ai_paused_at timestamptz,
  ai_paused_reason text,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.platform_flags (id) values (1) on conflict (id) do nothing;
alter table public.platform_flags enable row level security; -- interna: sem policy
grant all on public.platform_flags to service_role;

-- Descadastros (SAIR/PARAR, preferências da Meta, exclusão) por canal, categoria e motivo:
-- ativos hoje, novos e desfeitos desde uma data. Só a contagem: o contato fica em hash.
create or replace function public.admin_suppression_counts(p_since timestamptz)
returns table (channel text, kind text, reason text, active bigint, created_since bigint, revoked_since bigint)
language sql stable
set search_path = public
as $$
  select s.channel, s.kind, s.reason,
    count(*) filter (where s.revoked_at is null),
    count(*) filter (where s.created_at >= p_since),
    count(*) filter (where s.revoked_at >= p_since)
  from public.suppressions s
  group by 1, 2, 3
  order by 4 desc;
$$;
revoke all on function public.admin_suppression_counts(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_suppression_counts(timestamptz) to service_role;

-- Pedidos de exclusão e registros apagados: listados no backoffice por data.
create index if not exists deletion_requests_created_idx on public.deletion_requests (created_at desc);
create index if not exists suppressions_created_idx on public.suppressions (created_at);
