-- Boavoz · WhatsApp: a Meta recusou mensagens por falta de forma de pagamento (erro 131042)
-- Idempotente.

alter table public.whatsapp_channels
  add column if not exists payment_issue_at timestamptz;

grant select (payment_issue_at) on public.whatsapp_channels to authenticated;

notify pgrst, 'reload schema';
