-- Boavoz · portão: confirmação de 18+, conversa com item regulamentado e canal de venda (L1)
-- Idempotente.

-- Barreira de idade da Meta para mensagens (não é verificação legal de idade). A resposta vale
-- para as próximas conversas daquele bot. Contato por hash (telefone canônico ou IGSID).
-- status: sim | nao. origem: chat (botão) | empresa (token, API, planilha) | equipe.
-- "nao" sempre vence; o bot só pergunta de novo depois de 60 dias e se o contato pedir o item.
create table if not exists public.contact_ages (
  bot_id uuid not null references public.bots(id) on delete cascade,
  contact_hash text not null,
  status text not null check (status in ('sim', 'nao')),
  source text not null default 'chat',
  decided_at timestamptz not null default now(),
  primary key (bot_id, contact_hash)
);
alter table public.contact_ages enable row level security; -- interna: sem policy, sem grant
grant all on public.contact_ages to service_role;

-- Conversa com pedido de item regulamentado (vale enquanto a janela de 24 h estiver aberta), a
-- pergunta de 18+ em aberto (para responder a ela depois do "Sim") e quando foi feita.
alter table public.conversations add column if not exists regulated_at timestamptz;
alter table public.conversations add column if not exists age_asked_at timestamptz;
alter table public.conversations add column if not exists age_pending_question text;

-- Onde o contato finaliza o pedido de item regulamentado (nunca no chat do WhatsApp/Instagram):
-- {"site": "https://…", "phone": "(21) 3333-4444", "pickup": true, "app": "https://ifood…"}.
alter table public.bots add column if not exists regulated_channel jsonb;

-- Detecções do portão (verificações de conformidade): sem texto da conversa, só o que acusou.
create table if not exists public.gate_detections (
  id bigserial primary key,
  bot_id uuid not null references public.bots(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  stage text not null,            -- entrada | saida
  decision text not null,         -- proibido | proibido_misto | pede_18 | regulamentado | nao_18
  categories text[] not null default '{}',
  rules_version text not null,
  created_at timestamptz not null default now()
);
create index if not exists gate_detections_bot_idx on public.gate_detections (bot_id, created_at);
alter table public.gate_detections enable row level security;
grant all on public.gate_detections to service_role;
grant usage, select on sequence public.gate_detections_id_seq to service_role;
