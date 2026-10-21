-- Caixa de entrada, parte 4 (21/10/2026): transferência, notas internas, respostas prontas, adiar
-- e o setor do roteiro (spec, Peça 11; Telas, seção 6).
-- Sem policy nas tabelas novas: só o servidor lê e escreve (o painel confere a permissão antes).

-- notas internas e o registro das transferências: só a equipe vê (nunca vão ao contato nem à IA).
-- O texto é da equipe e pode citar dados do contato: cifrado com a chave do cliente (body_enc).
create table if not exists public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  kind text not null default 'nota' check (kind in ('nota', 'transferencia')),
  author_type text not null check (author_type in ('agency_member', 'client_member')),
  author_id uuid not null,
  author_name text not null,
  body_enc text,
  -- transferência: para quem foi ("Carlos", "Financeiro", "Financeiro · com Carlos")
  target_label text,
  created_at timestamptz not null default now()
);
create index if not exists conversation_notes_conv_idx on public.conversation_notes (conversation_id, created_at);
alter table public.conversation_notes enable row level security;
revoke all on public.conversation_notes from anon, authenticated;
grant all on public.conversation_notes to service_role;

-- respostas prontas do negócio: valem para todos os chatbots do cliente ({nome} e {atendente} no texto)
create table if not exists public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists quick_replies_client_title_idx on public.quick_replies (client_id, lower(btrim(title)));
alter table public.quick_replies enable row level security;
revoke all on public.quick_replies from anon, authenticated;
grant all on public.quick_replies to service_role;

-- quem passou o atendimento: o anúncio de transferência sai na primeira mensagem de quem recebe
alter table public.conversations add column if not exists transfer_from_name text;

-- adiar: a conversa sai das filas até a data (fila Adiadas); volta antes se o contato escrever
-- (last_contact_at depois de snoozed_at)
alter table public.conversations add column if not exists snoozed_until timestamptz;
alter table public.conversations add column if not exists snoozed_at timestamptz;

-- o setor da equipe quando o roteiro passa a conversa, pelo nome (vale nos chatbots derivados de
-- um modelo, cada um com os setores do seu cliente); vazio, ou sem setor com esse nome: a triagem de sempre
alter table public.routines add column if not exists handoff_sector text check (handoff_sector is null or char_length(btrim(handoff_sector)) between 1 and 40);
