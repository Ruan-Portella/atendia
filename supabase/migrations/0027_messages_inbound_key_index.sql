-- Boavoz · corrige o índice de messages.inbound_key (0026)
-- Idempotente.

-- O índice parcial (where inbound_key is not null) não serve ao "on conflict (inbound_key)" do
-- upsert: o Postgres recusa a gravação. Um índice único comum funciona igual para as linhas sem
-- chave (null nunca conflita com null) e aceita o on conflict.
drop index if exists public.messages_inbound_key_idx;
create unique index if not exists messages_inbound_key_uidx on public.messages (inbound_key);
