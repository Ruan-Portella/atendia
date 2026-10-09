-- Boavoz · cabeçalhos personalizados e log das entregas dos webhooks (C pública, parte 1b).
--
-- webhooks.headers_enc: cabeçalhos extras (ex.: x-api-key do gateway do cliente), cifrados como
-- os segredos (secret-box); o painel nunca mostra os valores de novo e os logs guardam só os nomes.
-- webhook_deliveries.last_response_enc: o começo da resposta da última tentativa (até 1 KB),
-- cifrado, para o log de entregas no painel. Idempotente.

alter table public.webhooks add column if not exists headers_enc text;
alter table public.webhook_deliveries add column if not exists last_response_enc text;
create index if not exists webhook_deliveries_webhook_idx on public.webhook_deliveries (webhook_id, created_at desc);

notify pgrst, 'reload schema';
