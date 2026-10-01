-- Boavoz · lista de supressão e opt-out fixo (L1, conformidade da Meta)
-- Idempotente.

-- Quem pediu para não receber mensagens iniciadas pela empresa (modelos, campanhas, lembretes).
-- Só hash do contato (telefone canônico ou id do Instagram, com a chave de hash da plataforma),
-- sem conversa. Sem ligação com agência, bot ou contato: sobrevive a exclusões, transferência e
-- encerramento. Guardada 5 anos (nenhuma rotina apaga). Só sai quem der um novo opt-in por
-- conta própria (ex.: "Foi engano", ou "resume" nas preferências do WhatsApp).
create table if not exists public.suppressions (
  id bigserial primary key,
  contact_hash text not null,
  channel text not null,                  -- whatsapp | instagram
  scope text not null,                    -- 'waba:{id}' (número do negócio) ou 'bot:{id}'
  kind text not null,                     -- marketing | utility | all
  reason text not null,                   -- opt_out | user_preferences | meta_131050 | erasure
  source text not null,                   -- chat | meta | painel
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_source text
);
create index if not exists suppressions_lookup_idx on public.suppressions (contact_hash, channel, scope) where revoked_at is null;
alter table public.suppressions enable row level security; -- interna: sem policy, sem grant
grant all on public.suppressions to service_role;
grant usage, select on sequence public.suppressions_id_seq to service_role;

-- Categoria do modelo enviado, para o descadastro valer para a categoria do último modelo.
alter table public.messages add column if not exists template_category text;
