-- Boavoz · um lead por contato em cada chatbot (15/10). O mesmo contato (achado pela conversa, pela
-- ficha do contato, pelo telefone ou pelo e-mail) não vira outro lead: o pedido novo entra no
-- histórico do lead que já existe. Ver src/lib/leads.ts (saveLead). Idempotente.
--
-- requests_enc: histórico dos pedidos (JSON com data, canal, conversa e o que a pessoa pediu),
--   cifrado com a chave do cliente, como o interesse (notes_enc fica com o pedido mais recente);
-- conversation_ids: as conversas em que o contato pediu algo (a tela da conversa e a exclusão
--   acham o lead por qualquer uma delas); conversation_id passa a ser a mais recente;
-- contact_id: a ficha do contato (WhatsApp, Instagram, site identificado), para achar o lead;
-- last_request_at: o pedido mais recente (ordem da lista e retenção); updated_at: última mudança
--   (GET /v1/leads?updated_since=).

alter table public.leads add column if not exists requests_enc text;
alter table public.leads add column if not exists conversation_ids uuid[] not null default '{}';
alter table public.leads add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.leads add column if not exists last_request_at timestamptz;
alter table public.leads add column if not exists updated_at timestamptz;

update public.leads set conversation_ids = array[conversation_id] where conversation_id is not null and conversation_ids = '{}';
update public.leads set last_request_at = created_at where last_request_at is null;
update public.leads set updated_at = created_at where updated_at is null;
update public.leads l set contact_id = c.contact_id
  from public.conversations c
  where l.contact_id is null and c.id = l.conversation_id and c.contact_id is not null;

alter table public.leads alter column last_request_at set default now();
alter table public.leads alter column last_request_at set not null;
alter table public.leads alter column updated_at set default now();
alter table public.leads alter column updated_at set not null;

create index if not exists leads_conversation_ids_idx on public.leads using gin (conversation_ids);
create index if not exists leads_contact_idx on public.leads (bot_id, contact_id) where contact_id is not null;
create index if not exists leads_last_request_idx on public.leads (bot_id, last_request_at desc);
create index if not exists leads_updated_idx on public.leads (updated_at);

notify pgrst, 'reload schema';
