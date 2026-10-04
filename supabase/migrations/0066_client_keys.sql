-- Boavoz · cifra por campo (leva S): a chave de cada cliente, cifrada pela chave mestra da
-- plataforma. Tudo o que vem do contato daquele cliente é cifrado com ela na aplicação
-- (src/lib/keys.ts e src/lib/field-cipher.ts). Excluir o cliente apaga a chave (cascade): o que
-- ela cifrou fica ilegível, inclusive nas cópias. Transferir o cliente para outra agência não
-- mexe na chave. Só o service role lê. Idempotente.
create table if not exists public.client_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  key_enc text not null,
  created_at timestamptz not null default now()
);
create index if not exists client_keys_client_idx on public.client_keys (client_id, created_at);
alter table public.client_keys enable row level security;
grant all on public.client_keys to service_role;

-- A recifra do histórico acha o que ainda está sem cifra por este índice (fica vazio depois).
create index if not exists messages_plain_idx on public.messages (id) where content not like 'v2.%';

notify pgrst, 'reload schema';
