-- Boavoz · Integrações, C pública parte 5a: ações "executa" com Confirmar / Cancelar. Cada resumo
-- enviado ao contato aponta para um button_ref: os parâmetros ficam aqui (cifrados com a chave do
-- cliente) e o canal recebe só a referência opaca (id do botão). O call_id da chamada é o id do
-- button_ref; o clique consome a linha de forma atômica antes de chamar o endpoint. Ver
-- src/lib/button-refs.ts e src/lib/action-confirm.ts. Idempotente.

create table if not exists public.button_refs (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  -- pedido do titular apaga a conversa, e a referência vai junto
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  action_id uuid not null references public.actions(id) on delete cascade,
  -- confirm: Confirmar / Cancelar de uma "executa"; action: botão com ação (parte 5b)
  kind text not null default 'confirm' check (kind in ('confirm', 'action')),
  params_enc text not null,
  params_hash text not null,
  single_use boolean not null default true,
  -- open: esperando o clique; running: chamando o endpoint; done: concluída; uncertain: sem
  -- resposta a tempo (só "Tentar de novo" repete, com o mesmo call_id); failed: o endpoint
  -- recusou ou a conferência no clique falhou; canceled: Cancelar; superseded: uma nova venceu
  status text not null default 'open' check (status in ('open', 'running', 'done', 'uncertain', 'failed', 'canceled', 'superseded')),
  -- evento da fila que consumiu (o reprocesso do mesmo clique segue sem chamar de novo)
  used_key text,
  used_at timestamptz,
  first_call_at timestamptz,
  -- 24 horas para o clique; depois da primeira chamada, 24 horas para o "Tentar de novo"
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists button_refs_open_idx on public.button_refs (conversation_id, action_id) where status in ('open', 'uncertain');
create index if not exists button_refs_expires_idx on public.button_refs (expires_at);
alter table public.button_refs enable row level security;
revoke all on public.button_refs from anon, authenticated;
grant all on public.button_refs to service_role;

notify pgrst, 'reload schema';
