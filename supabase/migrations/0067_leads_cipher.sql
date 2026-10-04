-- Leva S, parte 1b: cifra por campo do que ainda ia sem cifra.
-- Leads: telefone e interesse passam a ser gravados cifrados com a chave do cliente, em colunas
-- novas (phone_enc, notes_enc). Nome e e-mail ficam sem cifra, como na ficha do contato (busca).
-- As colunas antigas (phone, notes) só guardam o que veio antes da cifra: a recifra do histórico
-- move para as novas e zera as antigas; uma migração futura tira as duas.
-- Perguntas sem resposta, pedidos fora do assunto e a pergunta guardada do 18+ são cifrados na
-- própria coluna (o valor cifrado começa com "v2.").

alter table public.leads add column if not exists phone_enc text;
alter table public.leads add column if not exists notes_enc text;

-- o que falta recifrar (a recifra do histórico procura por aqui)
create index if not exists leads_plain_idx on public.leads (created_at) where phone is not null or notes is not null;
