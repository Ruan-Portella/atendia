-- Boavoz · coexistência (L1, tela Conexão): o dono marca "já desliguei a saudação e a mensagem de
-- ausência do app" (registro, sem bloquear). Aparece no Diagnóstico do número. Idempotente.
alter table public.whatsapp_channels add column if not exists auto_replies_off_at timestamptz;

notify pgrst, 'reload schema';
