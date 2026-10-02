-- Boavoz · tela única de aceite (L1): antes da primeira conexão de um canal da Meta, o próprio
-- negócio aceita os termos do canal e a Política de Uso Aceitável e responde a pergunta de
-- atividades (uma vez só, gravada no cliente). Ver src/lib/acceptance.ts. Idempotente.

-- Cada aceite: negócio (cliente da agência), canal, versão, quem e quando. Pelo painel já nasce
-- confirmado (membro logado); pelo link de conexão nasce pendente, preso ao token do link, e é
-- confirmado quando a Meta conclui a conexão (pendente sem conclusão em 7 dias é apagado).
create table if not exists public.business_acceptances (
  id bigserial primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  bot_id uuid references public.bots(id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  version text not null,
  via text not null check (via in ('painel', 'link')),
  status text not null default 'confirmed' check (status in ('pending', 'confirmed')),
  accepted_by_user uuid,                 -- membro logado (painel)
  accepted_by_name text,
  accepted_by_email text,
  declares_authority boolean not null default false,
  link_token_hash text,                  -- aceite pelo link, até a Meta concluir
  meta_account text,                     -- WABA ou conta do Instagram, na conclusão
  meta_business_id text,
  meta_verified_name text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists business_acceptances_client_idx on public.business_acceptances (client_id, channel, version) where status = 'confirmed';
create index if not exists business_acceptances_link_idx on public.business_acceptances (link_token_hash) where status = 'pending';
alter table public.business_acceptances enable row level security;
drop policy if exists "business_acceptances_agency_read" on public.business_acceptances;
create policy "business_acceptances_agency_read" on public.business_acceptances
  for select to authenticated using (agency_id = (select public.my_agency_id()));
grant select on public.business_acceptances to authenticated;
grant all on public.business_acceptances to service_role;
grant usage, select on sequence public.business_acceptances_id_seq to service_role;

-- Resposta da pergunta de atividades e estado de revisão do negócio. Tabela própria (e não
-- colunas em clients) para a agência só ler: quem muda o estado é a BoaVoz.
--   ativo               tudo "não", ou revisão aprovada
--   em_revisao          "sim" ou "não sei" em algum item (o canal funciona, com o portão ligado)
--   aguardando_revisao  "sim" em vender IA como produto: o WhatsApp só ativa depois da revisão
--   bloqueado           revisão recusou (não conecta WhatsApp nem Instagram)
create table if not exists public.business_compliance (
  client_id uuid primary key references public.clients(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  answers jsonb not null,
  answered_at timestamptz not null default now(),
  answered_by text,
  status text not null default 'ativo' check (status in ('ativo', 'em_revisao', 'aguardando_revisao', 'bloqueado')),
  review_due_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
);
create index if not exists business_compliance_review_idx on public.business_compliance (status) where status in ('em_revisao', 'aguardando_revisao');
alter table public.business_compliance enable row level security;
drop policy if exists "business_compliance_agency_read" on public.business_compliance;
create policy "business_compliance_agency_read" on public.business_compliance
  for select to authenticated using (agency_id = (select public.my_agency_id()));
grant select on public.business_compliance to authenticated;
grant all on public.business_compliance to service_role;
