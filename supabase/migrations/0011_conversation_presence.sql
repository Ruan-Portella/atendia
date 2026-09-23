-- Atendia · conversa continua depois do F5 + "visitante online"
-- Idempotente.

alter table public.conversations
  add column if not exists visitor_seen_at timestamptz; -- último sinal do widget aberto (a cada ~30 s)

notify pgrst, 'reload schema';
