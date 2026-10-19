-- Boavoz · identificação pelo roteiro (B2'): a loja escolhe se o BoaVoz oferece lembrar o número
-- ("Lembrar este número" / "Não lembrar") depois da identificação. Ligado é o padrão. Desligado, o
-- BoaVoz não pergunta, não usa número já lembrado e esquece os lembrados deste chatbot (vínculos do
-- roteiro desfeitos, motivo remember_off). Ver src/lib/routine-identity.ts. Idempotente.

alter table public.bots add column if not exists offer_remember_number boolean not null default true;

notify pgrst, 'reload schema';
