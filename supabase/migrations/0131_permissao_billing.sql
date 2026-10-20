-- Boavoz · a permissão billing nas chaves de API (correção, 20/10/2026). A leva de preços (parte 7)
-- criou a permissão de cobrança no código, mas a lista do banco (0059) ficou sem ela: criar uma
-- chave com "cobrança" marcada falhava em api_keys_permissions_check. Um teste compara esta lista
-- com API_PERMISSIONS (src/lib/api-keys.ts). Idempotente.

alter table public.api_keys drop constraint if exists api_keys_permissions_check;
alter table public.api_keys add constraint api_keys_permissions_check
  check (permissions <@ array['messages', 'conversations', 'contacts', 'pairing', 'campaigns', 'sources', 'provisioning', 'members', 'billing']::text[]);
