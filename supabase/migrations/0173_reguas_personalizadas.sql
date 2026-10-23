-- Régua personalizada (23/10/2026, a leva depois do redesenho): o "+ Nova régua" da aba Réguas.
-- A régua nova escolhe a data que dispara (o aniversário, a última visita, o horário marcado ou
-- uma data nova com o nome que a agência der), quantos dias antes ou depois, a hora, a categoria
-- e, se quiser, uma etiqueta; o motor e as regras são os das 5 réguas prontas (0140).

-- as datas novas do contato: os campos que a agência cria, por chatbot (a régua aponta para um
-- deles). Sem policy: só o servidor lê e escreve (o painel confere a permissão antes). Sem
-- agency_id: a conta vem do chatbot (a transferência de cliente não precisa mexer aqui).
create table if not exists public.contact_date_fields (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  -- o nome da coluna na planilha e na API (renovacao_do_plano); não muda quando o rótulo muda
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (char_length(label) between 2 and 60),
  created_at timestamptz not null default now(),
  unique (bot_id, key)
);
alter table public.contact_date_fields enable row level security;

-- o valor de cada data nova no contato: { "renovacao_do_plano": "2027-03-10" }, sem cifra, como
-- as outras datas das réguas
alter table public.contacts add column if not exists custom_dates jsonb not null default '{}'::jsonb;

-- a régua personalizada: o tipo novo, várias por chatbot (as prontas continuam uma de cada)
alter table public.reguas drop constraint if exists reguas_kind_check;
alter table public.reguas add constraint reguas_kind_check check (kind in ('aniversario', 'sumido', 'pos_atendimento', 'lembrete', 'sem_resposta', 'personalizada'));
alter table public.reguas drop constraint if exists reguas_bot_id_kind_key;
create unique index if not exists reguas_bot_kind_key on public.reguas (bot_id, kind) where kind <> 'personalizada';

alter table public.reguas add column if not exists name text;
-- a data que dispara: o aniversário, a última visita, o horário marcado ou uma data nova
alter table public.reguas add column if not exists trigger text;
alter table public.reguas add column if not exists date_field_id uuid references public.contact_date_fields(id) on delete restrict;
-- a data nova vale uma vez ou todo ano (o dia e o mês)
alter table public.reguas add column if not exists repeat_yearly boolean not null default false;
-- dias antes (negativo) ou depois (positivo) da data; 0 é no dia. No horário marcado vale o
-- delay_value (horas antes), como no lembrete
alter table public.reguas add column if not exists offset_days int;
-- só para quem tem esta etiqueta (null: todos que têm a data)
alter table public.reguas add column if not exists tag text;
-- a categoria pedida à Meta (a das prontas vem do tipo)
alter table public.reguas add column if not exists category text;

alter table public.reguas drop constraint if exists reguas_trigger_check;
alter table public.reguas add constraint reguas_trigger_check check (trigger is null or trigger in ('aniversario', 'ultima_visita', 'horario', 'data'));
alter table public.reguas drop constraint if exists reguas_offset_days_check;
alter table public.reguas add constraint reguas_offset_days_check check (offset_days is null or offset_days between -365 and 365);
alter table public.reguas drop constraint if exists reguas_category_check;
alter table public.reguas add constraint reguas_category_check check (category is null or category in ('MARKETING', 'UTILITY'));
alter table public.reguas drop constraint if exists reguas_tag_check;
alter table public.reguas add constraint reguas_tag_check check (tag is null or char_length(tag) between 1 and 40);
alter table public.reguas drop constraint if exists reguas_personalizada_check;
alter table public.reguas add constraint reguas_personalizada_check check (
  kind <> 'personalizada'
  or (
    char_length(coalesce(name, '')) between 2 and 60
    and trigger is not null
    and category is not null
    and (trigger <> 'data' or date_field_id is not null)
    and (trigger = 'horario' or offset_days is not null)
  )
);
