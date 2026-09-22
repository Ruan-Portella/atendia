-- Atendia · domínio próprio da agência (demos, portal do cliente e widget no domínio dela)
-- Idempotente.

alter table public.agencies
  add column if not exists custom_domain_verified_at timestamptz; -- quando o domínio passou a responder por nós

-- um domínio só pode ser de uma agência
update public.agencies set custom_domain = lower(trim(custom_domain)) where custom_domain is not null;
create unique index if not exists agencies_custom_domain_uidx on public.agencies(lower(custom_domain)) where custom_domain is not null;

notify pgrst, 'reload schema';
