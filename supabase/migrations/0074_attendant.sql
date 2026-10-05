-- Boavoz · leva B1', parte 2a: atendimento com identidade.
--
-- messages: quem escreveu cada mensagem (author_type + author_id + author_display_name, cópia do
-- nome no momento do envio) e quantos caracteres do começo são anúncio (entrada do atendente,
-- aviso de IA ou "Voltei!"), para o painel marcar. A coluna author (texto livre) continua sendo
-- gravada e só sai num deploy posterior, depois da conferência.
-- conversations: um atendente por conversa (assigned_to_*); "Assumir" é UPDATE condicional e o
-- anúncio de entrada fica pendente até a primeira mensagem de quem assumiu.
-- client_members: nome de exibição e foto (o papel do portal vem na parte 2b).
-- Idempotente.

alter table public.messages add column if not exists author_type text;
alter table public.messages add column if not exists author_id uuid;
alter table public.messages add column if not exists author_display_name text;
alter table public.messages add column if not exists announce_chars smallint;
alter table public.messages drop constraint if exists messages_author_type_check;
alter table public.messages add constraint messages_author_type_check
  check (author_type is null or author_type in ('ai', 'system', 'agency_member', 'client_member', 'api', 'phone_app'));

-- mensagens antigas: o tipo pelo texto de hoje; o nome mostrado é o próprio texto
update public.messages set
  author_type = case
    when role = 'assistant' and author = 'sistema' then 'system'
    when role = 'assistant' then 'ai'
    when author in ('celular', 'instagram') then 'phone_app'
    when author is null or author = 'agência' then 'agency_member'
    else 'client_member'
  end,
  author_display_name = case when role = 'agent' then author end
where role <> 'user' and author_type is null;

alter table public.conversations add column if not exists assigned_to_type text;
alter table public.conversations add column if not exists assigned_to_id uuid;
alter table public.conversations add column if not exists assigned_to_name text;
alter table public.conversations add column if not exists assigned_at timestamptz;
alter table public.conversations add column if not exists announce_pending boolean not null default false;
alter table public.conversations drop constraint if exists conversations_assigned_to_type_check;
alter table public.conversations add constraint conversations_assigned_to_type_check
  check (assigned_to_type is null or assigned_to_type in ('agency_member', 'client_member'));

alter table public.client_members add column if not exists display_name text check (char_length(display_name) <= 40);
alter table public.client_members add column if not exists avatar_url text check (char_length(avatar_url) <= 400);

notify pgrst, 'reload schema';
