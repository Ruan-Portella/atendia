-- Leva S, parte 2b: retenção nova (spec "Ciclo de vida dos dados").
-- Prazo efetivo de um chatbot: o do modo dados sensíveis (7 a 90 dias), senão o do cliente, senão
-- o da agência (6, 12 ou 24 meses). Demonstração sem conversão: 30 dias.
-- Agência: mudança de prazo sempre por retention_pending_months com efeito em
-- retention_effective_at (redução: 30 dias, com aviso, exportação e desfazer; aumento vale na
-- hora). O "Não apagar" (nulo) deixa de existir: a rotina diária agenda 12 meses com efeito em 30
-- dias e avisa a agência; o not null default 12 vem num deploy posterior, depois da última promoção.

alter table public.agencies add column if not exists retention_pending_months int
  check (retention_pending_months is null or retention_pending_months in (6, 12, 24));
alter table public.agencies add column if not exists retention_effective_at timestamptz;

-- o prazo só muda pelo servidor (a redução espera 30 dias): sai do que a sessão grava direto
revoke update (retention_months) on public.agencies from authenticated;

-- prazo próprio do cliente (nulo = o da agência)
alter table public.clients add column if not exists retention_months int
  check (retention_months is null or retention_months in (6, 12, 24));

-- modo dados sensíveis do chatbot: ligado pelo cliente; a análise do bot sugere em negócio de saúde
alter table public.bots add column if not exists sensitive_mode boolean not null default false;
alter table public.bots add column if not exists sensitive_mode_suggested_at timestamptz;
alter table public.bots add column if not exists sensitive_retention_days int not null default 30
  check (sensitive_retention_days between 7 and 90);

-- a retenção procura por chatbot e data
create index if not exists conversations_retention_idx on public.conversations (bot_id, last_message_at);
create index if not exists contacts_retention_idx on public.contacts (bot_id, created_at);
create index if not exists unanswered_retention_idx on public.unanswered (bot_id, created_at);
create index if not exists scope_refusals_retention_idx on public.scope_refusals (bot_id, created_at);

notify pgrst, 'reload schema';
