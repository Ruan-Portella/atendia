-- Boavoz · Instagram: busca de DMs pela API de conversas (reserva quando o webhook não entrega,
-- ex.: app ainda não publicado). Guarda até onde já foi buscado.
-- Idempotente.

alter table public.instagram_channels
  add column if not exists last_synced_at timestamptz;

grant select (last_synced_at) on public.instagram_channels to authenticated;

notify pgrst, 'reload schema';
