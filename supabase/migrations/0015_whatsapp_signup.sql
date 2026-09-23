-- Boavoz · WhatsApp pelo cadastro incorporado (Embedded Signup): cada número com o token do cliente
-- Idempotente.

alter table public.whatsapp_channels
  add column if not exists business_id text,
  add column if not exists access_token_enc text, -- token do cliente, cifrado (lib/secret-box.ts)
  add column if not exists pin_enc text;          -- PIN de 6 dígitos do registro do número, cifrado

-- O painel lê o canal com a sessão da agência (RLS), mas token e PIN nunca saem do servidor:
-- a leitura pelo usuário logado fica restrita às colunas públicas.
revoke select on public.whatsapp_channels from anon, authenticated;
grant select (id, bot_id, phone_number_id, waba_id, business_id, display_phone, verified_name, created_at)
  on public.whatsapp_channels to authenticated;

notify pgrst, 'reload schema';
