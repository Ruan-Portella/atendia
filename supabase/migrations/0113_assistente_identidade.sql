-- Boavoz · avisos e assistente no WhatsApp (parte 2, 19/10/2026): o assistente da BoaVoz reconhece a
-- pessoa da equipe pelo número confirmado e responde sobre a conta dela. A identidade do WhatsApp
-- (o hash que a Meta manda com a checagem ligada) fica guardada na confirmação; se mudar (aparelho
-- novo ou número reciclado), o assistente para de reconhecer a pessoa e os avisos param até ela
-- confirmar de novo pelo painel. Idempotente.

alter table public.team_whatsapp add column if not exists identity_key_hash text;
alter table public.team_whatsapp add column if not exists identity_changed_at timestamptz;

notify pgrst, 'reload schema';
