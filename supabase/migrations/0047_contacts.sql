-- Boavoz · contatos (L1): a identidade do contato num lugar só, por chatbot e canal, achada por
-- hash com chave (telefone na forma canônica, BSUID do WhatsApp, id do Instagram), sem buscar o
-- telefone com e sem o 9. Ver src/lib/contacts.ts e src/lib/phone.ts. Idempotente.
--
-- As colunas _enc guardam o valor sem cifra até a leva S (como hoje nas conversas); a migração
-- da S cifra tudo de uma vez, e a leitura reconhece os dois formatos pelo cabeçalho.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  channel text not null check (channel in ('widget', 'whatsapp', 'instagram')),
  phone_hash text,              -- HMAC de canonicalPhone (WhatsApp)
  phone_enc text,               -- o wa_id que a Meta usa para responder
  wa_user_hash text,            -- HMAC do BSUID (id do usuário por portfólio, desde 04/2026)
  wa_user_enc text,
  ig_hash text,                 -- HMAC do id do Instagram (IGSID)
  ig_enc text,
  hash_key_version int not null default 1,
  name text,                    -- sem cifra: a tela promete busca por nome
  email text,
  tags text[] not null default '{}',
  first_inbound_at timestamptz, -- só mensagem do próprio contato recebida pelo canal ("já conversou")
  last_inbound_at timestamptz,  -- janela de 24 h da Meta
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contacts_phone_idx on public.contacts (bot_id, channel, phone_hash) where phone_hash is not null;
create unique index if not exists contacts_wa_user_idx on public.contacts (bot_id, channel, wa_user_hash) where wa_user_hash is not null;
create unique index if not exists contacts_ig_idx on public.contacts (bot_id, channel, ig_hash) where ig_hash is not null;
create index if not exists contacts_agency_idx on public.contacts (agency_id);

alter table public.contacts enable row level security;
drop policy if exists contacts_agency_read on public.contacts;
create policy contacts_agency_read on public.contacts for select to authenticated
  using (bot_id in (select id from public.bots where agency_id = (select public.my_agency_id())));
grant select on public.contacts to authenticated;
grant all on public.contacts to service_role;

-- a conversa aponta para o contato; wa_id e ig_id saem num deploy posterior
alter table public.conversations add column if not exists contact_id uuid references public.contacts(id) on delete set null;
create index if not exists conversations_contact_idx on public.conversations (contact_id, last_message_at desc) where contact_id is not null;

-- lead achado pelo telefone sem guardar o telefone em texto na busca
alter table public.leads add column if not exists phone_hash text;
create index if not exists leads_phone_hash_idx on public.leads (bot_id, phone_hash) where phone_hash is not null;

-- conferência da chave de hash: se CONTACT_HASH_KEY mudar, nenhum contato nem supressão é achado
alter table public.platform_flags add column if not exists hash_sentinel text;

-- restauração de backup: as fichas de contato apagadas a pedido também são apagadas de novo
create or replace function public.reapply_deletions()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; c int;
begin
  for r in select distinct table_name, row_id from public.deletion_log loop
    if r.table_name in ('conversations', 'leads', 'instagram_channels', 'whatsapp_channels', 'bots', 'clients', 'unanswered', 'contacts') then
      execute format('delete from public.%I where id::text = $1', r.table_name) using r.row_id;
      get diagnostics c = row_count;
      n := n + c;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.reapply_deletions() from public, anon, authenticated;
