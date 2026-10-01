-- Boavoz · trava de escopo (L1, conformidade da Meta)
-- Idempotente.

-- "Assuntos do negócio": o cliente amplia o nível flexível da trava (sobre o que o bot conversa).
alter table public.bots add column if not exists business_topics text;

-- Recusas da trava de escopo (WhatsApp e Instagram), separadas das perguntas sem resposta (que
-- indicam lacuna na base). nivel: fixo (a IA viraria o serviço: tarefa sem relação com o negócio
-- ou executar o serviço que o negócio vende) | flexivel (assunto distante do negócio).
-- O sinal de "fora do assunto" conta só as do nível fixo.
create table if not exists public.scope_refusals (
  id bigserial primary key,
  bot_id uuid not null references public.bots(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  level text not null check (level in ('fixo', 'flexivel')),
  request text,                         -- resumo curto do pedido recusado (até 300 caracteres)
  created_at timestamptz not null default now()
);
create index if not exists scope_refusals_bot_idx on public.scope_refusals (bot_id, created_at);
alter table public.scope_refusals enable row level security; -- interna por enquanto: sem policy
grant all on public.scope_refusals to service_role;
grant usage, select on sequence public.scope_refusals_id_seq to service_role;
