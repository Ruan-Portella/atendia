-- Memória do contato (leva Memória e avisos no celular, parte 1, 21/10/2026; spec: a IA lembra nome
-- e preferências de uma conversa para outra, só dentro do mesmo chatbot, desligada no modo dados
-- sensíveis, com prazo e apagamento pelo pedido do titular).
-- A memória fica na ficha do contato (já separada por chatbot), cifrada com a chave do cliente:
-- até 10 fatos curtos, tirados pela IA quando a conversa fica parada. Vale 180 dias desde a última
-- atualização (a tarefa diária apaga as vencidas); apagar a ficha apaga a memória junto.

alter table public.bots add column if not exists contact_memory boolean not null default false;
alter table public.contacts add column if not exists memory_enc text;
alter table public.contacts add column if not exists memory_updated_at timestamptz;
create index if not exists contacts_memory_idx on public.contacts (memory_updated_at) where memory_updated_at is not null;
-- quando a memória já leu esta conversa (só lê de novo se chegou mensagem depois)
alter table public.conversations add column if not exists memory_at timestamptz;
