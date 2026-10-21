-- Chamados, parte 7d (21/10/2026): o aviso da resposta pelo WhatsApp. Quem abre o chamado com o
-- telefone pode marcar "Quero receber pelo WhatsApp o aviso de quando a equipe responder este
-- chamado" (texto fixo da versão chamado-whatsapp-1, em ticket-text.ts): a hora do aceite fica na
-- conversa, como prova. A resposta sai por um modelo de utilidade com o botão para acompanhar.

alter table public.conversations add column if not exists ticket_whatsapp_at timestamptz;
