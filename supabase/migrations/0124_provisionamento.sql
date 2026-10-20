-- Boavoz · API de provisionamento, primeira parte (D', parte 4a, 19/10/2026; spec, "API de
-- provisionamento").
--
-- clients.external_id e bots.external_id: o id do cliente (a loja) e do chatbot no sistema da
-- plataforma. Tornam POST /v1/clients (único por conta) e POST /v1/bots (único por cliente)
-- idempotentes: o provisionamento repetido depois de falhar no meio não cria um segundo cliente nem
-- um segundo chatbot. O envelope dos webhooks leva o external_id do cliente.
--
-- bots.fixed_display: o display do chatbot, o que a IA sabe da loja (nome, horário, endereço). É um
-- objeto plano como o contexto fixo, mas ao contrário dele vai para a IA (como um trecho fixo da
-- base) e não vai para as ações. Ver src/lib/bot-context.ts e src/lib/api-provisioning.ts.
-- Idempotente.

alter table public.clients add column if not exists external_id text;
alter table public.clients drop constraint if exists clients_external_id_check;
alter table public.clients add constraint clients_external_id_check check (external_id is null or length(external_id) between 1 and 120);
create unique index if not exists clients_external_idx on public.clients (agency_id, external_id) where external_id is not null;

alter table public.bots add column if not exists external_id text;
alter table public.bots drop constraint if exists bots_external_id_check;
alter table public.bots add constraint bots_external_id_check check (external_id is null or length(external_id) between 1 and 120);
create unique index if not exists bots_external_idx on public.bots (client_id, external_id) where external_id is not null;

alter table public.bots add column if not exists fixed_display jsonb;
alter table public.bots drop constraint if exists bots_fixed_display_check;
alter table public.bots add constraint bots_fixed_display_check check (fixed_display is null or (jsonb_typeof(fixed_display) = 'object' and fixed_display <> '{}'::jsonb and octet_length(fixed_display::text) <= 2048));
