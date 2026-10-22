-- "Estou falando com…?" também no pareamento da P2 (21/10/2026): a conversa nova de quem foi
-- conectado pelo código pergunta se é a mesma pessoa antes de a IA e as ações usarem a conta
-- (ligado por padrão; a loja desliga na aba Roteiros, junto do "Lembrar o número").
alter table public.bots add column if not exists confirm_paired_person boolean not null default true;

-- a resposta desta conversa: a pessoa do vínculo (hash do id externo) e quando disse sim ou não
alter table public.conversation_identities
  add column if not exists pairing_hash text,
  add column if not exists pairing_ok_at timestamptz,
  add column if not exists pairing_no_at timestamptz;

notify pgrst, 'reload schema';
