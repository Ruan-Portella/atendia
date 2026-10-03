-- Boavoz · recursos liberados por agência, sem deploy (L1): agencies.features substitui as listas
-- WHATSAPP_BETA_EMAILS e INSTAGRAM_BETA_EMAILS. O BoaVoz liga e desliga no backoffice, com
-- auditoria. A abertura geral de um canal fica em platform_flags (*_open_at): WhatsApp para os
-- planos pagos (o teste grátis segue na liberação manual), Instagram para todos. Ver
-- src/lib/features.ts. Idempotente.

alter table public.agencies add column if not exists features text[] not null default '{}';

alter table public.platform_flags add column if not exists whatsapp_open_at timestamptz;
alter table public.platform_flags add column if not exists instagram_open_at timestamptz;

-- quem já tem o canal conectado continua liberado (eram as contas da lista do beta)
update public.agencies a set features = a.features || array['whatsapp']
where not ('whatsapp' = any(a.features))
  and exists (select 1 from public.whatsapp_channels w join public.bots b on b.id = w.bot_id where b.agency_id = a.id);

update public.agencies a set features = a.features || array['instagram']
where not ('instagram' = any(a.features))
  and exists (select 1 from public.instagram_channels i join public.bots b on b.id = i.bot_id where b.agency_id = a.id);

notify pgrst, 'reload schema';
