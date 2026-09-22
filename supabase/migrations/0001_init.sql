-- Atendia · esquema inicial
-- Rode no SQL Editor do Supabase (ou `supabase db push`). Idempotente onde possível.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Agências (uma por usuário na V1)
-- ---------------------------------------------------------------------------
create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid unique references auth.users(id) on delete cascade, -- null só na agência vitrine
  name text not null,
  slug text not null unique,
  logo_url text,
  brand_color text not null default '#1f4e3d',
  support_whatsapp text,
  custom_domain text,
  plan text not null default 'trial', -- trial | freelancer | agencia | escala | cancelado
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  stripe_customer_id text unique,
  stripe_subscription_id text,
  referral_code text not null unique default encode(gen_random_bytes(4), 'hex'),
  referred_by uuid references public.agencies(id),
  created_at timestamptz not null default now()
);

-- Agência "vitrine": dona das demos geradas por visitantes anônimos na landing page.
insert into public.agencies (name, slug, plan, brand_color)
values ('Atendia', 'atendia', 'escala', '#1f4e3d')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Chatbots
-- ---------------------------------------------------------------------------
create table if not exists public.bots (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null,                       -- nome do assistente (ex.: Sofia)
  client_name text not null,                -- nome do cliente final (ex.: Clínica Sorriso)
  client_site text,
  public_key text not null unique default encode(gen_random_bytes(12), 'hex'),
  is_demo boolean not null default false,
  demo_slug text unique,
  demo_views int not null default 0,
  status text not null default 'draft',     -- draft | training | live | error
  persona jsonb not null default '{}'::jsonb,      -- {tone, welcome, instructions, language}
  appearance jsonb not null default '{}'::jsonb,   -- {color, avatar_text, suggested_questions[]}
  lead_capture jsonb not null default '{"enabled":true,"notify_email":null,"notify_whatsapp":null}'::jsonb,
  price_cents int,                          -- quanto a agência cobra do cliente (só para o painel)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bots_agency_idx on public.bots(agency_id);

-- ---------------------------------------------------------------------------
-- Fontes de conhecimento e trechos vetorizados
-- ---------------------------------------------------------------------------
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  kind text not null,                        -- site | page | pdf | text | faq
  title text not null,
  url text,
  content text,                              -- texto bruto (para text/faq; para site/pdf fica o extraído)
  status text not null default 'pending',    -- pending | ready | error
  chunk_count int not null default 0,
  pages int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sources_bot_idx on public.sources(bot_id);

create table if not exists public.chunks (
  id bigserial primary key,
  bot_id uuid not null references public.bots(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  content text not null,
  embedding vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb   -- {url, title, page}
);
create index if not exists chunks_bot_idx on public.chunks(bot_id);
create index if not exists chunks_embedding_idx on public.chunks using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Conversas, mensagens, leads, perguntas sem resposta
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  visitor_id text,
  channel text not null default 'widget',    -- widget | demo | painel
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count int not null default 0,
  needs_human boolean not null default false
);
create index if not exists conversations_bot_idx on public.conversations(bot_id, last_message_at desc);

create table if not exists public.messages (
  id bigserial primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null,                        -- user | assistant
  content text not null,
  sources jsonb,                             -- [{title,url}] usados na resposta
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages(conversation_id, id);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  name text,
  phone text,
  email text,
  notes text,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists leads_bot_idx on public.leads(bot_id, created_at desc);

create table if not exists public.unanswered (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  question text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Uso mensal e afiliados
-- ---------------------------------------------------------------------------
create table if not exists public.usage (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  period text not null,                      -- '2026-09'
  conversations int not null default 0,
  primary key (agency_id, period)
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.agencies(id) on delete cascade,
  referred_id uuid not null unique references public.agencies(id) on delete cascade,
  status text not null default 'trial',      -- trial | paying | churned
  commission_cents int not null default 0,   -- acumulado a pagar
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------
create or replace function public.match_chunks(
  p_bot_id uuid,
  p_query vector(1536),
  p_count int default 6,
  p_min_similarity float default 0.15
) returns table (id bigint, content text, metadata jsonb, similarity float)
language sql stable as $$
  select c.id, c.content, c.metadata, 1 - (c.embedding <=> p_query) as similarity
  from public.chunks c
  where c.bot_id = p_bot_id
    and 1 - (c.embedding <=> p_query) > p_min_similarity
  order by c.embedding <=> p_query
  limit p_count;
$$;

create or replace function public.increment_usage(p_agency_id uuid, p_period text)
returns int language sql as $$
  insert into public.usage (agency_id, period, conversations)
  values (p_agency_id, p_period, 1)
  on conflict (agency_id, period) do update set conversations = public.usage.conversations + 1
  returning conversations;
$$;

create or replace function public.increment_demo_views(p_slug text)
returns void language sql as $$
  update public.bots set demo_views = demo_views + 1 where demo_slug = p_slug;
$$;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists bots_updated_at on public.bots;
create trigger bots_updated_at before update on public.bots for each row execute function public.set_updated_at();
drop trigger if exists sources_updated_at on public.sources;
create trigger sources_updated_at before update on public.sources for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: a agência só vê o que é dela. Rotas públicas (widget,
-- demo, chat) usam a service role no servidor e nunca expõem estas tabelas.
-- ---------------------------------------------------------------------------
alter table public.agencies enable row level security;
alter table public.bots enable row level security;
alter table public.sources enable row level security;
alter table public.chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.leads enable row level security;
alter table public.unanswered enable row level security;
alter table public.usage enable row level security;
alter table public.referrals enable row level security;

create or replace function public.my_agency_id() returns uuid language sql stable as $$
  select id from public.agencies where owner_id = auth.uid()
$$;

drop policy if exists agencies_owner on public.agencies;
create policy agencies_owner on public.agencies for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists bots_owner on public.bots;
create policy bots_owner on public.bots for all using (agency_id = public.my_agency_id()) with check (agency_id = public.my_agency_id());

drop policy if exists sources_owner on public.sources;
create policy sources_owner on public.sources for all
  using (bot_id in (select id from public.bots where agency_id = public.my_agency_id()))
  with check (bot_id in (select id from public.bots where agency_id = public.my_agency_id()));

drop policy if exists chunks_owner_read on public.chunks;
create policy chunks_owner_read on public.chunks for select
  using (bot_id in (select id from public.bots where agency_id = public.my_agency_id()));

drop policy if exists conversations_owner on public.conversations;
create policy conversations_owner on public.conversations for select
  using (bot_id in (select id from public.bots where agency_id = public.my_agency_id()));

drop policy if exists messages_owner on public.messages;
create policy messages_owner on public.messages for select
  using (conversation_id in (select c.id from public.conversations c join public.bots b on b.id = c.bot_id where b.agency_id = public.my_agency_id()));

drop policy if exists leads_owner on public.leads;
create policy leads_owner on public.leads for all
  using (bot_id in (select id from public.bots where agency_id = public.my_agency_id()))
  with check (bot_id in (select id from public.bots where agency_id = public.my_agency_id()));

drop policy if exists unanswered_owner on public.unanswered;
create policy unanswered_owner on public.unanswered for all
  using (bot_id in (select id from public.bots where agency_id = public.my_agency_id()))
  with check (bot_id in (select id from public.bots where agency_id = public.my_agency_id()));

drop policy if exists usage_owner on public.usage;
create policy usage_owner on public.usage for select using (agency_id = public.my_agency_id());

drop policy if exists referrals_owner on public.referrals;
create policy referrals_owner on public.referrals for select using (referrer_id = public.my_agency_id());

-- ---------------------------------------------------------------------------
-- Storage: bucket privado para PDFs e público para logos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('sources', 'sources', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('logos', 'logos', true) on conflict (id) do nothing;

drop policy if exists "logos públicos" on storage.objects;
create policy "logos públicos" on storage.objects for select using (bucket_id = 'logos');
drop policy if exists "agência envia logo" on storage.objects;
create policy "agência envia logo" on storage.objects for insert to authenticated with check (bucket_id = 'logos');
