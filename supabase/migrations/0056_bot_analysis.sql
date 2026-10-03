-- Boavoz · análise do bot (logo depois da L1). Um processo só (analisar_bot) por chatbot: lê o
-- agregado da classificação dos trechos (itens regulamentados e proibidos), as fontes e pergunta à
-- IA se a conversa com a IA é o produto e se o modelo de negócio é proibido. O resultado vai para
-- compliance_checks (interna; achados viram pendência no painel interno) e clients.profile (o que
-- a agência vê, só para consulta). Ver src/lib/bot-analysis.ts. Idempotente.

create table if not exists public.compliance_checks (
  id bigserial primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  bot_id uuid not null references public.bots(id) on delete cascade,
  kind text not null check (kind in ('bot_analysis', 'gate', 'off_topic', 'passthrough', 'prohibited', 'volume', 'meta_signal')),
  labels jsonb not null default '{}'::jsonb,
  score numeric,
  -- sem cifra até a leva S (como as outras colunas _enc); apagado em 30 dias
  summary_enc text,
  summary_expires_at timestamptz,
  rules_version text,
  -- hash do que foi analisado: sem mudança, a análise não roda de novo
  input_hash text,
  review_state text not null default 'none' check (review_state in ('none', 'pending', 'resolved')),
  -- só a autodeclaração segura o cliente; sinais internos (como esta análise) nunca
  holds_client boolean not null default false,
  due_at timestamptz,
  resolved_by text,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now()
);
create index if not exists compliance_checks_bot_idx on public.compliance_checks (bot_id, kind, created_at desc);
create index if not exists compliance_checks_pending_idx on public.compliance_checks (review_state, created_at) where review_state = 'pending';
create index if not exists compliance_checks_client_idx on public.compliance_checks (client_id);
alter table public.compliance_checks enable row level security;
revoke all on public.compliance_checks from anon, authenticated;
grant all on public.compliance_checks to service_role;
grant usage, select on sequence public.compliance_checks_id_seq to service_role;

-- o que a análise encontrou, por chatbot (a agência lê pela sessão, como o resto do cliente)
alter table public.clients add column if not exists profile jsonb;

-- gatilhos agrupados: cada mudança empurra a análise para daqui a ~10 minutos
alter table public.bots add column if not exists analysis_due_at timestamptz;
create index if not exists bots_analysis_due_idx on public.bots (analysis_due_at) where analysis_due_at is not null;

-- clientes já ativos: a análise roda também neles, e eles recebem um aviso único com o resultado
update public.bots set analysis_due_at = now()
where not is_demo and status = 'live' and analysis_due_at is null
  and not exists (select 1 from public.compliance_checks k where k.bot_id = bots.id and k.kind = 'bot_analysis');
update public.clients c set profile = coalesce(c.profile, '{}'::jsonb) || jsonb_build_object('aviso_pendente', true)
where exists (select 1 from public.bots b where b.client_id = c.id and not b.is_demo and b.status = 'live')
  and not coalesce((c.profile ->> 'aviso_pendente')::boolean, false)
  and c.profile ->> 'avisado_em' is null;

notify pgrst, 'reload schema';
