-- Boavoz · WhatsApp em coexistência: o número continua no app WhatsApp Business do celular
-- Idempotente.

alter table public.whatsapp_channels
  add column if not exists coexistence boolean not null default false;

grant select (coexistence) on public.whatsapp_channels to authenticated;

notify pgrst, 'reload schema';
