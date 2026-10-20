-- BoaVoz · Réguas, parte 1: as datas do contato que as réguas usam, vindas da planilha de contatos,
-- do painel ou da API.
--  - birthday: só o dia e o mês ("MM-DD"). O ano não é guardado: a régua do aniversário só precisa
--    do dia (o ano da data de nascimento serve só para o 18+, que fica na sua própria tabela).
--  - last_visit_at: a última visita ou compra que a loja registrou ("faz tempo que você não vem" e
--    o pós-atendimento; sem ela, as réguas usam a última mensagem do contato).
--  - appointment_at: o próximo horário marcado (o lembrete antes do horário).
-- Sem cifra, como o nome e o e-mail do contato: o painel busca e as réguas filtram por elas.
-- Idempotente.

alter table public.contacts
  add column if not exists birthday text check (birthday is null or birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  add column if not exists last_visit_at timestamptz,
  add column if not exists appointment_at timestamptz;

-- as réguas procuram por chatbot: o aniversário do dia e os horários que estão chegando
create index if not exists contacts_birthday_idx on public.contacts (bot_id, birthday) where birthday is not null;
create index if not exists contacts_appointment_idx on public.contacts (bot_id, appointment_at) where appointment_at is not null;

notify pgrst, 'reload schema';
