-- Boavoz · identificação pelo roteiro (B2', parte 2c): a ação de um passo do roteiro devolve quem é
-- a pessoa (identity: external_id, nome e as contas). A conversa fica identificada e, com licença,
-- o número é lembrado (contact_links com source 'routine'); a conversa nova confirma a pessoa
-- ("Estou falando com Ana?"). Ver src/lib/routine-identity.ts. Idempotente.

-- de onde veio o vínculo: o pareamento (P2, código gerado pelo sistema da empresa) ou o roteiro
-- (número lembrado com a licença da pessoa, que confirma quem é a cada conversa nova)
alter table public.contact_links add column if not exists source text not null default 'pairing';
alter table public.contact_links drop constraint if exists contact_links_source_check;
alter table public.contact_links add constraint contact_links_source_check check (source in ('pairing', 'routine'));

-- identidade da conversa pelo roteiro. Fica fora das colunas do token e do pareamento
-- (identity_hash e context_hash prendem a conversa do site ao token). state_enc: quem é, as contas
-- e a escolhida, cifrados com a chave do cliente; vale 24 horas desde a identificação ou a
-- confirmação. consent: o pedido de licença para lembrar o número (due: falta perguntar; asked:
-- perguntado). check_enc: a pergunta "Estou falando com...?" em aberto e a mensagem que espera a
-- resposta; check_at: quando foi feita (uma vez por conversa).
create table if not exists public.conversation_identities (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  external_id_hash text,
  state_enc text,
  identified_at timestamptz,
  consent text check (consent in ('due', 'asked')),
  check_enc text,
  check_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists conversation_identities_contact_idx on public.conversation_identities (contact_id, external_id_hash) where contact_id is not null;
alter table public.conversation_identities enable row level security; -- interna: só service role
grant all on public.conversation_identities to service_role;

-- roteiro esperando a pessoa escolher a conta (identidade com mais de uma): o resultado da ação
-- que vale quando ela escolher
alter table public.routine_runs add column if not exists held_result text;

notify pgrst, 'reload schema';
