-- Boavoz · WhatsApp: número que perdeu o acesso (o cliente removeu o app ou a conta saiu)
-- Idempotente.

alter table public.whatsapp_channels
  add column if not exists disconnected_at timestamptz,
  add column if not exists disconnect_reason text;

-- o painel mostra o aviso de desconexão (as colunas de token e PIN continuam fora do alcance)
grant select (disconnected_at, disconnect_reason) on public.whatsapp_channels to authenticated;

notify pgrst, 'reload schema';
