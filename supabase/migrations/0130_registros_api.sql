-- Boavoz · registros da API e envios que falharam (D', parte 7, 20/10/2026; spec, linha 9 dos
-- próximos passos).
--
-- api_requests: uma linha por chamada à API pública com chave válida (a chave, o método, o caminho
-- sem o endereço do contato, o status, o código do erro, a duração e se foi a resposta guardada de
-- uma Idempotency-Key). Sem corpo e sem a query (podem ter dado de contato). Fica 30 dias; o painel
-- mostra em Integrações → Logs. Gravado depois da resposta (src/lib/api-v1.ts).
--
-- failed_messages: as mensagens do chatbot que não saíram num canal (o canal recusou ou a regra de
-- estado barrou), dos últimos dias, para a lista "Envios que falharam" da aba do canal. O conteúdo
-- vai cifrado: quem abre é a camada de mensagens (src/lib/messages.ts). Idempotente.

create table if not exists public.api_requests (
  id bigserial primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  method text not null,
  path text not null,
  status int not null,
  error_code text,
  duration_ms int,
  replayed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists api_requests_agency_idx on public.api_requests (agency_id, created_at desc);
create index if not exists api_requests_created_idx on public.api_requests (created_at);
alter table public.api_requests enable row level security;
revoke all on public.api_requests from anon, authenticated;
grant all on public.api_requests to service_role;
grant usage, select on sequence public.api_requests_id_seq to service_role;

-- as que falharam ficam num índice pequeno (são poucas perto do total)
create index if not exists messages_failed_idx on public.messages (conversation_id, created_at desc) where failed_at is not null or blocked_reason is not null;

create or replace function public.failed_messages(p_bot_ids uuid[], p_channel text, p_since timestamptz, p_limit int default 50)
returns table (id bigint, conversation_id uuid, bot_id uuid, created_at timestamptz, role text, content text, author_display_name text, author text, failed_at timestamptz, error_code text, blocked_reason text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.conversation_id, c.bot_id, m.created_at, m.role, m.content, m.author_display_name, m.author, m.failed_at, m.error_code, m.blocked_reason
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where c.bot_id = any(p_bot_ids)
    and c.channel = p_channel
    and m.created_at >= p_since
    and (m.failed_at is not null or m.blocked_reason is not null)
    and m.deleted_at is null
  order by m.created_at desc
  limit least(greatest(p_limit, 1), 200);
$$;
revoke all on function public.failed_messages(uuid[], text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.failed_messages(uuid[], text, timestamptz, int) to service_role;

notify pgrst, 'reload schema';
