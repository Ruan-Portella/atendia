-- Boavoz · aviso do momento (Lançamento, parte 3, 19/10/2026): um texto com validade, escrito pela
-- loja ou pela agência (instabilidade, manutenção, mudança de horário), que a IA usa quando o
-- contato pergunta. Vencido, some sozinho. Ver src/lib/moment-notice.ts. Idempotente.
alter table public.bots add column if not exists moment_notice text check (moment_notice is null or char_length(moment_notice) between 1 and 500);
alter table public.bots add column if not exists moment_notice_until timestamptz;
-- quem escreveu (e-mail da pessoa do portal ou "agência"), para o painel mostrar
alter table public.bots add column if not exists moment_notice_by text;

notify pgrst, 'reload schema';
